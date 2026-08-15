import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getHarness, resetDb, type Harness } from '../helpers/harness';
import { createDataRoom, createFolder, makeUserAndLogin, uploadFile } from '../helpers/factories';

let h: Harness;
let cookie: string;
let roomId: string;

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

beforeEach(async () => {
  h = await getHarness();
  await resetDb(h.prisma);
  ({ cookie } = await makeUserAndLogin(h, { email: 'anna@harlanco.com', name: 'Anna Ruiz' }));
  roomId = (await createDataRoom(h, cookie, 'Project Meridian')).id;
});
afterAll(async () => h?.close());

// §2.1 — the TRASH node.
describe('TRASH node lifecycle (§2.1)', () => {
  it('does not exist before the first delete', async () => {
    expect(await h.prisma.node.count({ where: { type: 'TRASH' } })).toBe(0);

    const res = await h.api().get('/api/v1/trash').set('Cookie', cookie).expect(200);
    expect(res.body.node).toBeNull();
    expect(res.body.items).toEqual([]);
  });

  it('is created lazily on the first delete, exactly once', async () => {
    const a = await createFolder(h, cookie, roomId, 'A');
    const b = await createFolder(h, cookie, roomId, 'B');

    await h.api().delete(`/api/v1/nodes/${a.id}`).set('Cookie', cookie).expect(204);
    await h.api().delete(`/api/v1/nodes/${b.id}`).set('Cookie', cookie).expect(204);

    const trashNodes = await h.prisma.node.findMany({ where: { type: 'TRASH' } });
    expect(trashNodes).toHaveLength(1);
    expect(trashNodes[0].parentId).toBeNull();
    expect(trashNodes[0].path).toBe(`/${trashNodes[0].id}/`);
    expect(trashNodes[0].dataRoomId).toBe(trashNodes[0].id);
  });

  it('is never returned by GET /data-rooms (§2.1)', async () => {
    const folder = await createFolder(h, cookie, roomId, 'A');
    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    const res = await h.api().get('/api/v1/data-rooms').set('Cookie', cookie).expect(200);
    expect(res.body.items.map((n: { type: string }) => n.type)).toEqual(['DATAROOM']);
  });

  it('drops a deleted data room off the dashboard (§2.8)', async () => {
    const keep = await createDataRoom(h, cookie, 'Keep This Room');
    await h.api().delete(`/api/v1/nodes/${roomId}`).set('Cookie', cookie).expect(204);

    const res = await h.api().get('/api/v1/data-rooms').set('Cookie', cookie).expect(200);
    expect(res.body.items.map((n: { id: string }) => n.id)).toEqual([keep.id]);
  });

  it('gives each user their own trash', async () => {
    const other = await makeUserAndLogin(h, { email: 'other@example.test' });
    const otherRoom = await createDataRoom(h, other.cookie, 'Their Room');
    const otherFolder = await createFolder(h, other.cookie, otherRoom.id, 'X');
    const mine = await createFolder(h, cookie, roomId, 'A');

    await h.api().delete(`/api/v1/nodes/${mine.id}`).set('Cookie', cookie).expect(204);
    await h.api().delete(`/api/v1/nodes/${otherFolder.id}`).set('Cookie', other.cookie).expect(204);

    expect(await h.prisma.node.count({ where: { type: 'TRASH' } })).toBe(2);

    const res = await h.api().get('/api/v1/trash').set('Cookie', cookie).expect(200);
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(['A']);
  });
});

// §2.2 — delete is a move, not a destruction.
describe('DELETE /nodes/{id} moves to Trash (§2.2)', () => {
  it('keeps the row and re-parents it under TRASH', async () => {
    const folder = await createFolder(h, cookie, roomId, '02 Financials');
    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    const row = await h.prisma.node.findUniqueOrThrow({ where: { id: folder.id } });
    const trash = await h.prisma.node.findFirstOrThrow({ where: { type: 'TRASH' } });

    expect(row.parentId).toBe(trash.id);
    expect(row.path).toBe(`/${trash.id}/${folder.id}/`);
    expect(row.deletedAt).not.toBeNull();
    expect(row.previousParentId).toBe(roomId);
  });

  it('rewrites the whole subtree path (§2.2 step 2)', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    const nested = await createFolder(h, cookie, folder.id, 'N');
    const file = await uploadFile(h, cookie, nested.id, 'a.pdf');

    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    const trash = await h.prisma.node.findFirstOrThrow({ where: { type: 'TRASH' } });
    const fileRow = await h.prisma.node.findUniqueOrThrow({
      where: { id: file.complete.body.id },
    });
    expect(fileRow.path).toBe(`/${trash.id}/${folder.id}/${nested.id}/${fileRow.id}/`);
  });

  it('stamps deletedAt across the whole subtree (§2.1, §2.2 step 3)', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    const nested = await createFolder(h, cookie, folder.id, 'N');
    const file = await uploadFile(h, cookie, nested.id, 'a.pdf');

    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    // A file inside a deleted folder is deleted — the stamp says so locally,
    // without anyone having to know where the owner's Trash lives.
    for (const id of [folder.id, nested.id, file.complete.body.id]) {
      const row = await h.prisma.node.findUniqueOrThrow({ where: { id } });
      expect(row.deletedAt).not.toBeNull();
    }
  });

  it('marks only the subtree root as restorable (§2.1)', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    const nested = await createFolder(h, cookie, folder.id, 'N');

    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    // previousParentId is what separates the restorable unit from its passengers.
    const root = await h.prisma.node.findUniqueOrThrow({ where: { id: folder.id } });
    const passenger = await h.prisma.node.findUniqueOrThrow({ where: { id: nested.id } });
    expect(root.previousParentId).toBe(roomId);
    expect(root.previousName).toBe('F');
    expect(passenger.previousParentId).toBeNull();
    expect(passenger.previousName).toBeNull();
    expect(passenger.deletedFromLabel).toBeNull();
  });

  it('moves size and itemCount from the source room to TRASH (§2.2 step 4)', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    await uploadFile(h, cookie, folder.id, 'a.pdf', { bytes: Buffer.alloc(500, 1) });

    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    const room = await h.prisma.node.findUniqueOrThrow({ where: { id: roomId } });
    const trash = await h.prisma.node.findFirstOrThrow({ where: { type: 'TRASH' } });

    expect(room.size).toBe(0n);
    expect(room.itemCount).toBe(0);
    expect(trash.size).toBe(500n);
    expect(trash.itemCount).toBe(2); // the folder and its file
  });

  it('keeps storage objects until purge (§2.2 closing rule)', async () => {
    const { init, complete } = await uploadFile(h, cookie, roomId, 'a.pdf');
    await h.api().delete(`/api/v1/nodes/${complete.body.id}`).set('Cookie', cookie).expect(204);

    expect(h.storage.has(init.storageKey)).toBe(true);
    expect(await h.prisma.fileVersion.count()).toBe(1);
  });

  it('destroys every share in the deleted subtree (§2.2 step 5)', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    const file = await uploadFile(h, cookie, folder.id, 'a.pdf');

    const grantee = await makeUserAndLogin(h, { email: 'g@example.test' });
    await h
      .api()
      .post(`/api/v1/nodes/${folder.id}/shares/people`)
      .set('Cookie', cookie)
      .send({ emails: ['g@example.test'] })
      .expect(201);
    const link = await h
      .api()
      .post(`/api/v1/nodes/${file.complete.body.id}/shares/link`)
      .set('Cookie', cookie)
      .expect(201);

    await h.api().get(`/api/v1/nodes/${folder.id}`).set('Cookie', grantee.cookie).expect(200);

    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    // Access ends immediately, during the TTL window (001 §4.3.13).
    await h.api().get(`/api/v1/nodes/${folder.id}`).set('Cookie', grantee.cookie).expect(404);
    await h.api().get(`/api/v1/public/shares/${link.body.token}`).expect(404);

    // §2.2 step 5 — the rows are destroyed, not stamped with revokedAt.
    expect(await h.prisma.share.count()).toBe(0);
    expect(await h.prisma.shareGrant.count()).toBe(0);
  });

  it('refuses to delete for anyone but the owner (§2.2)', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    const grantee = await makeUserAndLogin(h, { email: 'g@example.test' });
    await h
      .api()
      .post(`/api/v1/nodes/${folder.id}/shares/people`)
      .set('Cookie', cookie)
      .send({ emails: ['g@example.test'] })
      .expect(201);

    // A grantee can read it but never delete it — no share confers write.
    await h.api().get(`/api/v1/nodes/${folder.id}`).set('Cookie', grantee.cookie).expect(200);
    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', grantee.cookie).expect(403);

    expect(await h.prisma.node.count({ where: { type: 'TRASH' } })).toBe(0);
  });
});

// §2.3 — collisions inside Trash are resolved silently.
describe('name collisions in Trash (§2.3)', () => {
  it('accepts two identically named files from different folders', async () => {
    const a = await createFolder(h, cookie, roomId, 'A');
    const b = await createFolder(h, cookie, roomId, 'B');
    const first = await uploadFile(h, cookie, a.id, 'Report.pdf');
    const second = await uploadFile(h, cookie, b.id, 'Report.pdf');

    await h.api().delete(`/api/v1/nodes/${first.complete.body.id}`).set('Cookie', cookie).expect(204);
    // No NAME_CONFLICT: the user did not choose this destination.
    await h.api().delete(`/api/v1/nodes/${second.complete.body.id}`).set('Cookie', cookie).expect(204);

    // §2.3 — the de-duplicated form stays in the database…
    const rows = await h.prisma.node.findMany({
      where: { deletedAt: { not: null }, previousParentId: { not: null } },
      orderBy: { name: 'asc' },
    });
    expect(rows.map((r) => r.name)).toEqual(['Report (1).pdf', 'Report.pdf']);

    // …and never reaches the user: both rows read as the name they gave it,
    // told apart by where each was deleted from (§2.5).
    const res = await h.api().get('/api/v1/trash').set('Cookie', cookie).expect(200);
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Report.pdf',
      'Report.pdf',
    ]);
    expect(res.body.items.map((i: { deletedFromLabel: string }) => i.deletedFromLabel).sort()).toEqual(
      ['Project Meridian / A', 'Project Meridian / B'],
    );
  });
});

// §2.7 — on-demand purging, the one action with no undo.
describe('DELETE /trash/{nodeId} (§2.7)', () => {
  it('permanently deletes one entry, its subtree, versions and storage objects', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    const nested = await createFolder(h, cookie, folder.id, 'N');
    const { init, complete } = await uploadFile(h, cookie, nested.id, 'a.pdf');
    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    await h.api().delete(`/api/v1/trash/${folder.id}`).set('Cookie', cookie).expect(204);

    expect(await h.prisma.node.findUnique({ where: { id: folder.id } })).toBeNull();
    expect(await h.prisma.node.findUnique({ where: { id: nested.id } })).toBeNull();
    expect(await h.prisma.node.findUnique({ where: { id: complete.body.id } })).toBeNull();
    expect(await h.prisma.fileVersion.count()).toBe(0);
    expect(h.storage.has(init.storageKey)).toBe(false);
  });

  it('decrements the TRASH rollups by what it removed', async () => {
    const gone = await createFolder(h, cookie, roomId, 'Gone');
    await uploadFile(h, cookie, gone.id, 'a.pdf', { bytes: Buffer.alloc(320, 1) });
    const kept = await createFolder(h, cookie, roomId, 'Kept');

    await h.api().delete(`/api/v1/nodes/${gone.id}`).set('Cookie', cookie).expect(204);
    await h.api().delete(`/api/v1/nodes/${kept.id}`).set('Cookie', cookie).expect(204);
    await h.api().delete(`/api/v1/trash/${gone.id}`).set('Cookie', cookie).expect(204);

    const trash = await h.prisma.node.findFirstOrThrow({ where: { type: 'TRASH' } });
    expect(trash.size).toBe(0n);
    expect(trash.itemCount).toBe(1); // only "Kept" remains
  });

  it('refuses anything that is not a live entry in the caller own trash', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    const nested = await createFolder(h, cookie, folder.id, 'N');

    // Not deleted at all.
    await h.api().delete(`/api/v1/trash/${folder.id}`).set('Cookie', cookie).expect(404);

    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    // A passenger inside a deleted folder is not its own entry (§2.6).
    await h.api().delete(`/api/v1/trash/${nested.id}`).set('Cookie', cookie).expect(404);

    // Someone else's trash is invisible.
    const other = await makeUserAndLogin(h);
    await h.api().delete(`/api/v1/trash/${folder.id}`).set('Cookie', other.cookie).expect(404);

    expect(await h.prisma.node.findUnique({ where: { id: folder.id } })).not.toBeNull();
  });
});

describe('DELETE /trash (§2.7)', () => {
  it('empties everything, with storage objects and rollups', async () => {
    const a = await createFolder(h, cookie, roomId, 'A');
    const first = await uploadFile(h, cookie, a.id, 'a.pdf', { bytes: Buffer.alloc(100, 1) });
    const b = await createFolder(h, cookie, roomId, 'B');
    const second = await uploadFile(h, cookie, b.id, 'b.pdf', { bytes: Buffer.alloc(200, 1) });

    await h.api().delete(`/api/v1/nodes/${a.id}`).set('Cookie', cookie).expect(204);
    await h.api().delete(`/api/v1/nodes/${b.id}`).set('Cookie', cookie).expect(204);

    await h.api().delete('/api/v1/trash').set('Cookie', cookie).expect(204);

    const res = await h.api().get('/api/v1/trash').set('Cookie', cookie).expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.node.size).toBe('0');
    expect(res.body.node.itemCount).toBe(0);
    expect(h.storage.has(first.init.storageKey)).toBe(false);
    expect(h.storage.has(second.init.storageKey)).toBe(false);
  });

  it('leaves live data completely alone', async () => {
    const keep = await createFolder(h, cookie, roomId, 'Keep');
    const drop = await createFolder(h, cookie, roomId, 'Drop');
    await h.api().delete(`/api/v1/nodes/${drop.id}`).set('Cookie', cookie).expect(204);

    await h.api().delete('/api/v1/trash').set('Cookie', cookie).expect(204);

    expect(await h.prisma.node.findUnique({ where: { id: keep.id } })).not.toBeNull();
    expect(await h.prisma.node.findUnique({ where: { id: roomId } })).not.toBeNull();
  });

  it('is a no-op on a trash that was never created', async () => {
    // Emptying nothing succeeded — there is nothing to report as missing.
    await h.api().delete('/api/v1/trash').set('Cookie', cookie).expect(204);
    expect(await h.prisma.node.count({ where: { type: 'TRASH' } })).toBe(0);
  });

  it('empties only the caller trash', async () => {
    const other = await makeUserAndLogin(h, { email: 'other@example.test' });
    const otherRoom = await createDataRoom(h, other.cookie, 'Theirs');
    const otherFolder = await createFolder(h, other.cookie, otherRoom.id, 'X');
    await h.api().delete(`/api/v1/nodes/${otherFolder.id}`).set('Cookie', other.cookie).expect(204);

    const mine = await createFolder(h, cookie, roomId, 'Mine');
    await h.api().delete(`/api/v1/nodes/${mine.id}`).set('Cookie', cookie).expect(204);

    await h.api().delete('/api/v1/trash').set('Cookie', cookie).expect(204);

    const theirs = await h.api().get('/api/v1/trash').set('Cookie', other.cookie).expect(200);
    expect(theirs.body.items.map((i: { name: string }) => i.name)).toEqual(['X']);
  });
});

// §2.4 — the origin trail survives its own ancestors.
describe('deletedFromLabel (§2.4)', () => {
  it('records the folder trail an item was deleted from', async () => {
    const financials = await createFolder(h, cookie, roomId, '02 Financials');
    const audited = await createFolder(h, cookie, financials.id, 'Audited Statements');
    const file = await uploadFile(h, cookie, audited.id, 'a.pdf');

    await h.api().delete(`/api/v1/nodes/${file.complete.body.id}`).set('Cookie', cookie).expect(204);

    const res = await h.api().get('/api/v1/trash').set('Cookie', cookie).expect(200);
    expect(res.body.items[0].deletedFromLabel).toBe(
      'Project Meridian / 02 Financials / Audited Statements',
    );
  });

  it('labels a deleted data room from the dashboard level', async () => {
    await h.api().delete(`/api/v1/nodes/${roomId}`).set('Cookie', cookie).expect(204);
    const res = await h.api().get('/api/v1/trash').set('Cookie', cookie).expect(200);
    expect(res.body.items[0].deletedFromLabel).toBe('Data rooms');
  });

  it('survives the origin folder being deleted afterwards', async () => {
    const folder = await createFolder(h, cookie, roomId, '02 Financials');
    const file = await uploadFile(h, cookie, folder.id, 'a.pdf');

    await h.api().delete(`/api/v1/nodes/${file.complete.body.id}`).set('Cookie', cookie).expect(204);
    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    const res = await h.api().get('/api/v1/trash').set('Cookie', cookie).expect(200);
    const fileRow = res.body.items.find((i: { name: string }) => i.name === 'a.pdf');
    expect(fileRow.deletedFromLabel).toBe('Project Meridian / 02 Financials');
  });
});

// §2.5 — reading the trash.
describe('GET /trash (§2.5)', () => {
  it('lists only top-level trashed items, newest first', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    await createFolder(h, cookie, folder.id, 'N');
    const loose = await createFolder(h, cookie, roomId, 'Loose');

    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);
    await new Promise((r) => setTimeout(r, 10));
    await h.api().delete(`/api/v1/nodes/${loose.id}`).set('Cookie', cookie).expect(204);

    const res = await h.api().get('/api/v1/trash').set('Cookie', cookie).expect(200);
    // "N" travelled inside "F" and is not a separate trash entry.
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(['Loose', 'F']);
  });

  it('reports the trash total size and item count', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    await uploadFile(h, cookie, folder.id, 'a.pdf', { bytes: Buffer.alloc(750, 1) });
    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    const res = await h.api().get('/api/v1/trash').set('Cookie', cookie).expect(200);
    expect(res.body.node.size).toBe('750');
    expect(res.body.node.itemCount).toBe(2);
  });

  it('requires a session', async () => {
    await h.api().get('/api/v1/trash').expect(401);
  });
});

// §2.6 — restore is the delete run backwards.
describe('POST /trash/{nodeId}/restore (§2.6)', () => {
  it('clears deletedAt across the whole restored subtree (§2.6 step 3)', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    const nested = await createFolder(h, cookie, folder.id, 'N');
    const file = await uploadFile(h, cookie, nested.id, 'a.pdf');

    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);
    await h.api().post(`/api/v1/trash/${folder.id}/restore`).set('Cookie', cookie).expect(200);

    for (const id of [folder.id, nested.id, file.complete.body.id]) {
      const row = await h.prisma.node.findUniqueOrThrow({ where: { id } });
      expect(row.deletedAt).toBeNull();
    }
    // And the whole branch is browsable again, not just its root.
    await h.api().get(`/api/v1/nodes/${nested.id}`).set('Cookie', cookie).expect(200);
    await h.api().get(`/api/v1/nodes/${file.complete.body.id}`).set('Cookie', cookie).expect(200);
  });

  it('puts the item back where it came from and clears the trash fields', async () => {
    const financials = await createFolder(h, cookie, roomId, '02 Financials');
    const file = await uploadFile(h, cookie, financials.id, 'a.pdf', {
      bytes: Buffer.alloc(300, 1),
    });
    const fileId = file.complete.body.id;

    await h.api().delete(`/api/v1/nodes/${fileId}`).set('Cookie', cookie).expect(204);
    await h.api().post(`/api/v1/trash/${fileId}/restore`).set('Cookie', cookie).expect(200);

    const row = await h.prisma.node.findUniqueOrThrow({ where: { id: fileId } });
    expect(row.parentId).toBe(financials.id);
    expect(row.path).toBe(`/${roomId}/${financials.id}/${fileId}/`);
    expect(row.deletedAt).toBeNull();
    expect(row.previousParentId).toBeNull();
    expect(row.deletedFromLabel).toBeNull();

    // Readable through the normal path again — §2.8 no longer applies to it.
    await h.api().get(`/api/v1/nodes/${fileId}`).set('Cookie', cookie).expect(200);
  });

  it('moves the rollups back out of TRASH (§2.6 step 4)', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    await uploadFile(h, cookie, folder.id, 'a.pdf', { bytes: Buffer.alloc(640, 1) });

    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);
    await h.api().post(`/api/v1/trash/${folder.id}/restore`).set('Cookie', cookie).expect(200);

    const room = await h.prisma.node.findUniqueOrThrow({ where: { id: roomId } });
    const trash = await h.prisma.node.findFirstOrThrow({ where: { type: 'TRASH' } });
    expect(room.size).toBe(640n);
    expect(room.itemCount).toBe(2);
    expect(trash.size).toBe(0n);
    expect(trash.itemCount).toBe(0);
  });

  it('restores the original name, not the de-duplicated one (§2.3, §2.6 step 2)', async () => {
    const a = await createFolder(h, cookie, roomId, 'A');
    const b = await createFolder(h, cookie, roomId, 'B');
    const first = await uploadFile(h, cookie, a.id, 'Report.pdf');
    const second = await uploadFile(h, cookie, b.id, 'Report.pdf');

    await h.api().delete(`/api/v1/nodes/${first.complete.body.id}`).set('Cookie', cookie).expect(204);
    await h.api().delete(`/api/v1/nodes/${second.complete.body.id}`).set('Cookie', cookie).expect(204);

    // The second one was silently suffixed on the way in — in the database only.
    const suffixed = await h.prisma.node.findUniqueOrThrow({
      where: { id: second.complete.body.id },
    });
    expect(suffixed.name).toBe('Report (1).pdf');

    await h
      .api()
      .post(`/api/v1/trash/${second.complete.body.id}/restore`)
      .set('Cookie', cookie)
      .expect(200);

    const restored = await h.prisma.node.findUniqueOrThrow({
      where: { id: second.complete.body.id },
    });
    expect(restored.name).toBe('Report.pdf');
    expect(restored.parentId).toBe(b.id);
  });

  it('does not bring sharing back (§2.6 step 5)', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    const grantee = await makeUserAndLogin(h, { email: 'g@example.test' });
    await h
      .api()
      .post(`/api/v1/nodes/${folder.id}/shares/people`)
      .set('Cookie', cookie)
      .send({ emails: ['g@example.test'] })
      .expect(201);

    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);
    await h.api().post(`/api/v1/trash/${folder.id}/restore`).set('Cookie', cookie).expect(200);

    // The owner has it back; the grantee does not.
    await h.api().get(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(200);
    await h.api().get(`/api/v1/nodes/${folder.id}`).set('Cookie', grantee.cookie).expect(404);
    expect(await h.prisma.share.count()).toBe(0);
  });

  it('refuses when the origin folder is itself trashed, and works once it is restored', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    const file = await uploadFile(h, cookie, folder.id, 'a.pdf');
    const fileId = file.complete.body.id;

    await h.api().delete(`/api/v1/nodes/${fileId}`).set('Cookie', cookie).expect(204);
    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    const blocked = await h
      .api()
      .post(`/api/v1/trash/${fileId}/restore`)
      .set('Cookie', cookie)
      .expect(409);
    expect(blocked.body.error.code).toBe('RESTORE_TARGET_MISSING');

    // Restoring outward-in unblocks the child.
    await h.api().post(`/api/v1/trash/${folder.id}/restore`).set('Cookie', cookie).expect(200);
    await h.api().post(`/api/v1/trash/${fileId}/restore`).set('Cookie', cookie).expect(200);

    const row = await h.prisma.node.findUniqueOrThrow({ where: { id: fileId } });
    expect(row.parentId).toBe(folder.id);
  });

  it('reports a NAME_CONFLICT when the original name was taken meanwhile (§6.4)', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    const original = await uploadFile(h, cookie, folder.id, 'Report.pdf');

    await h
      .api()
      .delete(`/api/v1/nodes/${original.complete.body.id}`)
      .set('Cookie', cookie)
      .expect(204);
    // A new file takes the freed name.
    await uploadFile(h, cookie, folder.id, 'Report.pdf');

    const conflict = await h
      .api()
      .post(`/api/v1/trash/${original.complete.body.id}/restore`)
      .set('Cookie', cookie)
      .expect(409);
    expect(conflict.body.error.code).toBe('NAME_CONFLICT');
    expect(conflict.body.error.details.suggestedName).toBe('Report (1).pdf');

    // The standard conflict protocol resolves it.
    const resolved = await h
      .api()
      .post(`/api/v1/trash/${original.complete.body.id}/restore`)
      .set('Cookie', cookie)
      .send({ onConflict: 'KEEP_BOTH' })
      .expect(200);
    expect(resolved.body.name).toBe('Report (1).pdf');
  });

  it('refuses to restore a descendant that travelled inside a deleted folder', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    const nested = await createFolder(h, cookie, folder.id, 'N');
    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    await h.api().post(`/api/v1/trash/${nested.id}/restore`).set('Cookie', cookie).expect(404);
  });

  it('is owner-only', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    const other = await makeUserAndLogin(h);
    await h.api().post(`/api/v1/trash/${folder.id}/restore`).set('Cookie', other.cookie).expect(404);
  });
});


// §2.8 — trashed nodes are invisible everywhere else.
describe('trashed nodes are invisible elsewhere (§2.8)', () => {
  it('404s on a direct read of a trashed node', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    await h.api().get(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(404);
    await h.api().get(`/api/v1/nodes/${folder.id}/children`).set('Cookie', cookie).expect(404);
  });

  it('404s on a descendant of a trashed folder, addressed directly (§2.8)', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    const nested = await createFolder(h, cookie, folder.id, 'N');
    const file = await uploadFile(h, cookie, nested.id, 'a.pdf');

    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    // Someone holding a deep link from before the delete gets nothing.
    await h.api().get(`/api/v1/nodes/${nested.id}`).set('Cookie', cookie).expect(404);
    await h.api().get(`/api/v1/nodes/${nested.id}/children`).set('Cookie', cookie).expect(404);
    await h.api().get(`/api/v1/nodes/${file.complete.body.id}`).set('Cookie', cookie).expect(404);
    await h
      .api()
      .get(`/api/v1/nodes/${file.complete.body.id}/content`)
      .set('Cookie', cookie)
      .expect(404);
  });

  it('drops trashed items out of the source folder listing', async () => {
    const keep = await createFolder(h, cookie, roomId, 'Keep');
    const drop = await createFolder(h, cookie, roomId, 'Drop');
    await h.api().delete(`/api/v1/nodes/${drop.id}`).set('Cookie', cookie).expect(204);

    const res = await h.api().get(`/api/v1/nodes/${roomId}/children`).set('Cookie', cookie).expect(200);
    expect(res.body.items.map((n: { id: string }) => n.id)).toEqual([keep.id]);
  });

  it('excludes trashed items from search', async () => {
    const folder = await createFolder(h, cookie, roomId, 'Schedule Folder');
    await uploadFile(h, cookie, folder.id, 'Schedule.pdf');
    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    const res = await h
      .api()
      .get(`/api/v1/nodes/${roomId}/search`)
      .query({ q: 'schedule' })
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.items).toEqual([]);
  });
});

// §2.7 — the TTL is what actually deletes.
describe('purgeExpiredTrash (§2.7)', () => {
  async function purge() {
    const { TrashService } = await import('../../src/application/trash.service');
    return h.app.get(TrashService).purgeExpired();
  }

  it('leaves items that are inside the TTL window alone', async () => {
    const { init, complete } = await uploadFile(h, cookie, roomId, 'a.pdf');
    await h.api().delete(`/api/v1/nodes/${complete.body.id}`).set('Cookie', cookie).expect(204);

    await purge();

    expect(await h.prisma.node.findUnique({ where: { id: complete.body.id } })).not.toBeNull();
    expect(h.storage.has(init.storageKey)).toBe(true);
  });

  it('hard-deletes items past the TTL, with their versions and storage objects', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    const { init, complete } = await uploadFile(h, cookie, folder.id, 'a.pdf');
    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    await h.prisma.node.update({
      where: { id: folder.id },
      data: { deletedAt: daysAgo(31) },
    });

    const purged = await purge();

    expect(purged).toBe(1);
    expect(await h.prisma.node.findUnique({ where: { id: folder.id } })).toBeNull();
    expect(await h.prisma.node.findUnique({ where: { id: complete.body.id } })).toBeNull();
    expect(await h.prisma.fileVersion.count()).toBe(0);
    expect(h.storage.has(init.storageKey)).toBe(false);
  });

  it('decrements the TRASH rollups by what it removed (§2.7)', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    await uploadFile(h, cookie, folder.id, 'a.pdf', { bytes: Buffer.alloc(400, 1) });
    const keep = await createFolder(h, cookie, roomId, 'Keep');

    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);
    await h.api().delete(`/api/v1/nodes/${keep.id}`).set('Cookie', cookie).expect(204);

    await h.prisma.node.update({ where: { id: folder.id }, data: { deletedAt: daysAgo(31) } });
    await purge();

    const trash = await h.prisma.node.findFirstOrThrow({ where: { type: 'TRASH' } });
    expect(trash.size).toBe(0n);
    expect(trash.itemCount).toBe(1); // only "Keep" remains
  });

  it('purges a subtree once, not once per stamped descendant (§2.7)', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    const nested = await createFolder(h, cookie, folder.id, 'N');
    await uploadFile(h, cookie, nested.id, 'a.pdf');

    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);
    // Descendants carry deletedAt too (§2.1) but are never their own candidates.
    await h.prisma.node.updateMany({
      where: { path: { contains: folder.id } },
      data: { deletedAt: daysAgo(31) },
    });

    expect(await purge()).toBe(1);
    expect(await h.prisma.node.findUnique({ where: { id: nested.id } })).toBeNull();
  });

  it('is idempotent — a second run finds nothing', async () => {
    const folder = await createFolder(h, cookie, roomId, 'F');
    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);
    await h.prisma.node.update({ where: { id: folder.id }, data: { deletedAt: daysAgo(31) } });

    expect(await purge()).toBe(1);
    expect(await purge()).toBe(0);
  });

  it('never touches live nodes', async () => {
    const live = await createFolder(h, cookie, roomId, 'Live');
    const dead = await createFolder(h, cookie, roomId, 'Dead');
    await h.api().delete(`/api/v1/nodes/${dead.id}`).set('Cookie', cookie).expect(204);
    await h.prisma.node.update({ where: { id: dead.id }, data: { deletedAt: daysAgo(60) } });

    await purge();

    expect(await h.prisma.node.findUnique({ where: { id: live.id } })).not.toBeNull();
    expect(await h.prisma.node.findUnique({ where: { id: roomId } })).not.toBeNull();
  });
});
