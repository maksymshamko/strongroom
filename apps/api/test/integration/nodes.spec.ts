import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getHarness, resetDb, type Harness } from '../helpers/harness';
import { createDataRoom, createFolder, makeUserAndLogin, uploadFile } from '../helpers/factories';

let h: Harness;
let cookie: string;

beforeEach(async () => {
  h = await getHarness();
  await resetDb(h.prisma);
  ({ cookie } = await makeUserAndLogin(h));
});
afterAll(async () => h?.close());

// §8.1 data rooms and nodes.
describe('POST /data-rooms (§8.1)', () => {
  it('creates a DATAROOM root with parentId null and a self-rooted path (§2.2)', async () => {
    const room = await createDataRoom(h, cookie, 'Project Meridian');
    const row = await h.prisma.node.findUniqueOrThrow({ where: { id: room.id } });

    expect(row.type).toBe('DATAROOM');
    expect(row.parentId).toBeNull();
    expect(row.path).toBe(`/${room.id}/`);
    expect(row.dataRoomId).toBe(room.id);
    expect(row.size).toBe(0n);
    expect(row.itemCount).toBe(0);
  });

  it('serializes size as a string (§4.1)', async () => {
    const room = await createDataRoom(h, cookie, 'Sizes');
    expect(typeof room).toBe('object');
    const res = await h.api().get(`/api/v1/nodes/${room.id}`).set('Cookie', cookie).expect(200);
    expect(res.body.node.size).toBe('0');
  });

  it('rejects an invalid name with VALIDATION_FAILED (§6.3)', async () => {
    const res = await h
      .api()
      .post('/api/v1/data-rooms')
      .set('Cookie', cookie)
      .send({ name: '   ' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('allows two data rooms with the same name (both have parentId null, §6.1 scope)', async () => {
    await createDataRoom(h, cookie, 'Duplicate');
    await h
      .api()
      .post('/api/v1/data-rooms')
      .set('Cookie', cookie)
      .send({ name: 'Duplicate' })
      .expect(201);
  });

  it('requires a session', async () => {
    await h.api().post('/api/v1/data-rooms').send({ name: 'Nope' }).expect(401);
  });
});

describe('POST /nodes/folders (§8.1, §6.3)', () => {
  it('creates a nested folder with the correct materialized path', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    const outer = await createFolder(h, cookie, room.id, '02 Financials');
    const inner = await createFolder(h, cookie, outer.id, 'Audited Statements');

    const row = await h.prisma.node.findUniqueOrThrow({ where: { id: inner.id } });
    expect(row.path).toBe(`/${room.id}/${outer.id}/${inner.id}/`);
    expect(row.dataRoomId).toBe(room.id);
  });

  it('increments itemCount on every ancestor (§2.3)', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    const outer = await createFolder(h, cookie, room.id, 'A');
    await createFolder(h, cookie, outer.id, 'B');

    const roomRow = await h.prisma.node.findUniqueOrThrow({ where: { id: room.id } });
    const outerRow = await h.prisma.node.findUniqueOrThrow({ where: { id: outer.id } });
    expect(roomRow.itemCount).toBe(2); // both descendants, at any depth
    expect(outerRow.itemCount).toBe(1);
  });

  it('bumps ancestor updatedAt (spec 001 §4.3.14, §2.3)', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    const before = await h.prisma.node.findUniqueOrThrow({ where: { id: room.id } });
    await new Promise((r) => setTimeout(r, 5));
    await createFolder(h, cookie, room.id, 'A');
    const after = await h.prisma.node.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it('rejects a folder under a FILE parent with INVALID_MOVE (§6.3)', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    const { complete } = await uploadFile(h, cookie, room.id, 'a.pdf');
    const res = await h
      .api()
      .post('/api/v1/nodes/folders')
      .set('Cookie', cookie)
      .send({ parentId: complete.body.id, name: 'nope' })
      .expect(409);
    expect(res.body.error.code).toBe('INVALID_MOVE');
  });

  it('rejects creation past MAX_DEPTH (§6.3)', async () => {
    const room = await createDataRoom(h, cookie, 'Deep');
    let parentId = room.id;
    for (let depth = 2; depth <= 32; depth++) {
      parentId = (await createFolder(h, cookie, parentId, `d${depth}`)).id;
    }
    const res = await h
      .api()
      .post('/api/v1/nodes/folders')
      .set('Cookie', cookie)
      .send({ parentId, name: 'too-deep' })
      .expect(409);
    expect(res.body.error.code).toBe('INVALID_MOVE');
  });
});

describe('GET /nodes/{id}/children (§4.3 pagination, §8.1)', () => {
  it('sorts folders before files regardless of sort key (§4.3)', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    await uploadFile(h, cookie, room.id, 'AAA.pdf');
    await createFolder(h, cookie, room.id, 'zzz-folder');

    const res = await h
      .api()
      .get(`/api/v1/nodes/${room.id}/children`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.items.map((n: { type: string }) => n.type)).toEqual(['FOLDER', 'FILE']);
  });

  it('paginates by cursor with no repeats and no gaps (§4.3)', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    for (let i = 0; i < 12; i++) {
      await createFolder(h, cookie, room.id, `folder-${String(i).padStart(2, '0')}`);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: { body: { items: { id: string }[]; nextCursor: string | null } } = await h
        .api()
        .get(`/api/v1/nodes/${room.id}/children`)
        .query({ limit: 5, ...(cursor ? { cursor } : {}) })
        .set('Cookie', cookie)
        .expect(200);
      seen.push(...res.body.items.map((n: { id: string }) => n.id));
      cursor = res.body.nextCursor;
    } while (cursor);

    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it('returns nextCursor null on the last page', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    await createFolder(h, cookie, room.id, 'only');
    const res = await h
      .api()
      .get(`/api/v1/nodes/${room.id}/children`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.nextCursor).toBeNull();
  });

  it('rejects limit above 100 (§4.3)', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    await h
      .api()
      .get(`/api/v1/nodes/${room.id}/children`)
      .query({ limit: 500 })
      .set('Cookie', cookie)
      .expect(400);
  });
});

describe('GET /nodes/{id} breadcrumb (§8.1, §5.5)', () => {
  it('returns the full root-first chain for the owner', async () => {
    const room = await createDataRoom(h, cookie, 'Project Meridian');
    const outer = await createFolder(h, cookie, room.id, '02 Financials');
    const inner = await createFolder(h, cookie, outer.id, 'Audited Statements');

    const res = await h.api().get(`/api/v1/nodes/${inner.id}`).set('Cookie', cookie).expect(200);
    expect(res.body.breadcrumb.map((s: { name: string }) => s.name)).toEqual([
      'Project Meridian',
      '02 Financials',
      'Audited Statements',
    ]);
  });
});

describe('PATCH /nodes/{id} rename (§8.1, §6.4)', () => {
  it('renames without touching the path or children', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    const folder = await createFolder(h, cookie, room.id, 'Old Name');
    const child = await createFolder(h, cookie, folder.id, 'Child');

    await h
      .api()
      .patch(`/api/v1/nodes/${folder.id}`)
      .set('Cookie', cookie)
      .send({ name: 'New Name' })
      .expect(200);

    const renamed = await h.prisma.node.findUniqueOrThrow({ where: { id: folder.id } });
    const childRow = await h.prisma.node.findUniqueOrThrow({ where: { id: child.id } });
    expect(renamed.name).toBe('New Name');
    expect(renamed.path).toBe(`/${room.id}/${folder.id}/`);
    expect(childRow.path).toBe(`/${room.id}/${folder.id}/${child.id}/`);
  });

  it('bumps ancestor updatedAt with a zero rollup delta (§2.3)', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    const folder = await createFolder(h, cookie, room.id, 'A');
    const before = await h.prisma.node.findUniqueOrThrow({ where: { id: room.id } });
    await new Promise((r) => setTimeout(r, 5));

    await h
      .api()
      .patch(`/api/v1/nodes/${folder.id}`)
      .set('Cookie', cookie)
      .send({ name: 'B' })
      .expect(200);

    const after = await h.prisma.node.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(after.itemCount).toBe(1);
    expect(after.size).toBe(0n);
  });
});

describe('POST /nodes/{id}/move (§8.1, §6.3)', () => {
  it('rewrites the path of the whole moved subtree (§2.2 rule 4)', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    const src = await createFolder(h, cookie, room.id, 'src');
    const dst = await createFolder(h, cookie, room.id, 'dst');
    const moved = await createFolder(h, cookie, src.id, 'moved');
    const grand = await createFolder(h, cookie, moved.id, 'grand');

    await h
      .api()
      .post(`/api/v1/nodes/${moved.id}/move`)
      .set('Cookie', cookie)
      .send({ parentId: dst.id })
      .expect(200);

    const movedRow = await h.prisma.node.findUniqueOrThrow({ where: { id: moved.id } });
    const grandRow = await h.prisma.node.findUniqueOrThrow({ where: { id: grand.id } });
    expect(movedRow.path).toBe(`/${room.id}/${dst.id}/${moved.id}/`);
    expect(grandRow.path).toBe(`/${room.id}/${dst.id}/${moved.id}/${grand.id}/`);
  });

  it('transfers size and itemCount from the source ancestors to the destination (§2.3)', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    const src = await createFolder(h, cookie, room.id, 'src');
    const dst = await createFolder(h, cookie, room.id, 'dst');
    const bytes = Buffer.alloc(1000, 1);
    await uploadFile(h, cookie, src.id, 'big.pdf', { bytes });

    await h
      .api()
      .post(`/api/v1/nodes/${src.id}/move`)
      .set('Cookie', cookie)
      .send({ parentId: dst.id })
      .expect(200);

    const dstRow = await h.prisma.node.findUniqueOrThrow({ where: { id: dst.id } });
    const roomRow = await h.prisma.node.findUniqueOrThrow({ where: { id: room.id } });
    expect(dstRow.size).toBe(1000n);
    expect(dstRow.itemCount).toBe(2); // src folder + its file
    expect(roomRow.size).toBe(1000n); // room total unchanged by an internal move
    expect(roomRow.itemCount).toBe(3);
  });

  it('refuses to move a node into itself (§6.3)', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    const folder = await createFolder(h, cookie, room.id, 'A');
    const res = await h
      .api()
      .post(`/api/v1/nodes/${folder.id}/move`)
      .set('Cookie', cookie)
      .send({ parentId: folder.id })
      .expect(409);
    expect(res.body.error.code).toBe('INVALID_MOVE');
  });

  it('refuses to move a node into its own descendant (§6.3)', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    const parent = await createFolder(h, cookie, room.id, 'A');
    const child = await createFolder(h, cookie, parent.id, 'B');
    const res = await h
      .api()
      .post(`/api/v1/nodes/${parent.id}/move`)
      .set('Cookie', cookie)
      .send({ parentId: child.id })
      .expect(409);
    expect(res.body.error.code).toBe('INVALID_MOVE');
  });

  it('refuses to move a DATAROOM (§6.3)', async () => {
    const a = await createDataRoom(h, cookie, 'A');
    const b = await createDataRoom(h, cookie, 'B');
    await h
      .api()
      .post(`/api/v1/nodes/${a.id}/move`)
      .set('Cookie', cookie)
      .send({ parentId: b.id })
      .expect(409);
  });

  it('refuses a cross-data-room move (§15 open question 2 — deferred, so forbidden)', async () => {
    const roomA = await createDataRoom(h, cookie, 'A');
    const roomB = await createDataRoom(h, cookie, 'B');
    const folder = await createFolder(h, cookie, roomA.id, 'F');
    const res = await h
      .api()
      .post(`/api/v1/nodes/${folder.id}/move`)
      .set('Cookie', cookie)
      .send({ parentId: roomB.id })
      .expect(409);
    expect(res.body.error.code).toBe('INVALID_MOVE');
  });

  it('refuses a move that would exceed MAX_DEPTH for a deep subtree (§6.3)', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    // Build a 4-deep subtree under `src`, then a 30-deep chain under `dst`.
    const src = await createFolder(h, cookie, room.id, 'src');
    let tip = src.id;
    for (let i = 0; i < 3; i++) tip = (await createFolder(h, cookie, tip, `s${i}`)).id;

    let deep = (await createFolder(h, cookie, room.id, 'dst')).id;
    for (let i = 0; i < 29; i++) deep = (await createFolder(h, cookie, deep, `d${i}`)).id;

    const res = await h
      .api()
      .post(`/api/v1/nodes/${src.id}/move`)
      .set('Cookie', cookie)
      .send({ parentId: deep })
      .expect(409);
    expect(res.body.error.code).toBe('INVALID_MOVE');
  });
});

describe('DELETE /nodes/{id} (§8.1; superseded by spec 003 §2.2)', () => {
  it('removes the subtree from its source ancestors rollups (§2.3)', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    const folder = await createFolder(h, cookie, room.id, 'F');
    const nested = await createFolder(h, cookie, folder.id, 'N');
    await uploadFile(h, cookie, nested.id, 'a.pdf', { bytes: Buffer.alloc(500, 1) });

    await h.api().delete(`/api/v1/nodes/${folder.id}`).set('Cookie', cookie).expect(204);

    const roomRow = await h.prisma.node.findUniqueOrThrow({ where: { id: room.id } });
    expect(roomRow.itemCount).toBe(0);
    expect(roomRow.size).toBe(0n);
  });

  // Spec 003 §2.2 replaced hard delete with a move into Trash; storage objects
  // now survive until the TTL purge (003 §2.6, covered in trash.spec.ts).
  it('keeps the node and its storage object, moving it to Trash instead', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    const { init, complete } = await uploadFile(h, cookie, room.id, 'a.pdf');

    await h.api().delete(`/api/v1/nodes/${complete.body.id}`).set('Cookie', cookie).expect(204);

    const row = await h.prisma.node.findUniqueOrThrow({ where: { id: complete.body.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(h.storage.has(init.storageKey)).toBe(true);
  });

  it('refuses to delete a node the caller does not own (§5.4)', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    const other = await makeUserAndLogin(h);
    await h.api().delete(`/api/v1/nodes/${room.id}`).set('Cookie', other.cookie).expect(404);
  });
});

describe('GET /nodes/{id}/delete-preview (§8.1)', () => {
  it('reports subtree counts and size for the delete dialog', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    const folder = await createFolder(h, cookie, room.id, 'F');
    await createFolder(h, cookie, folder.id, 'N');
    await uploadFile(h, cookie, folder.id, 'a.pdf', { bytes: Buffer.alloc(700, 1) });

    const res = await h
      .api()
      .get(`/api/v1/nodes/${folder.id}/delete-preview`)
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body).toMatchObject({
      nodeId: folder.id,
      name: 'F',
      type: 'FOLDER',
      contents: { files: 1, folders: 1, size: '700' },
    });
    expect(res.body.shareImpact).toEqual({
      peopleCount: 0,
      activeLinkCount: 0,
      people: [],
    });
  });

  // A file's subtree is the file itself, which the counting query excludes —
  // the dialog used to offer "0 files · 0 folders · 0 B" for a document that
  // plainly weighs something, reading as if nothing would be lost.
  it('reports a file\'s own size rather than an empty subtree', async () => {
    const room = await createDataRoom(h, cookie, 'Room');
    const { complete } = await uploadFile(h, cookie, room.id, 'Contract.pdf', {
      bytes: Buffer.alloc(900, 1),
    });

    const res = await h
      .api()
      .get(`/api/v1/nodes/${complete.body.id}/delete-preview`)
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body).toMatchObject({
      name: 'Contract.pdf',
      type: 'FILE',
      contents: { files: 1, folders: 0, size: '900' },
    });
  });
});

// §2.3 — the incremental path must agree with a full recompute.
describe('rollup consistency (§2.3)', () => {
  it('incremental rollups equal a full recompute after a mixed workload', async () => {
    const { recomputeRollups } = await import('../../src/infra/prisma/recompute-rollups');
    const room = await createDataRoom(h, cookie, 'Room');
    const a = await createFolder(h, cookie, room.id, 'a');
    const b = await createFolder(h, cookie, room.id, 'b');
    await uploadFile(h, cookie, a.id, 'one.pdf', { bytes: Buffer.alloc(100, 1) });
    await uploadFile(h, cookie, a.id, 'two.pdf', { bytes: Buffer.alloc(250, 1) });
    await uploadFile(h, cookie, b.id, 'three.pdf', { bytes: Buffer.alloc(50, 1) });
    await h
      .api()
      .post(`/api/v1/nodes/${a.id}/move`)
      .set('Cookie', cookie)
      .send({ parentId: b.id })
      .expect(200);
    await h.api().delete(`/api/v1/nodes/${b.id}`).set('Cookie', cookie).expect(204);

    const before = await h.prisma.node.findMany({ select: { id: true, size: true, itemCount: true } });
    await recomputeRollups(h.prisma);
    const after = await h.prisma.node.findMany({ select: { id: true, size: true, itemCount: true } });

    expect(after).toEqual(before);
  });
});
