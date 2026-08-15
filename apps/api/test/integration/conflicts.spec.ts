import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getHarness, resetDb, type Harness } from '../helpers/harness';
import { createDataRoom, createFolder, makeUserAndLogin, uploadFile } from '../helpers/factories';

let h: Harness;
let cookie: string;
let roomId: string;

beforeEach(async () => {
  h = await getHarness();
  await resetDb(h.prisma);
  ({ cookie } = await makeUserAndLogin(h));
  roomId = (await createDataRoom(h, cookie, 'Room')).id;
});
afterAll(async () => h?.close());

// §6.4 conflict protocol — one mechanism, three triggers.
describe('conflict detection without onConflict (§6.4)', () => {
  it('upload: 409 NAME_CONFLICT carrying the suggested name and nothing written', async () => {
    await uploadFile(h, cookie, roomId, 'Report.pdf');
    const { complete } = await uploadFile(h, cookie, roomId, 'Report.pdf');

    expect(complete.status).toBe(409);
    expect(complete.body.error.code).toBe('NAME_CONFLICT');
    expect(complete.body.error.details).toMatchObject({
      suggestedName: 'Report (1).pdf',
      conflictingNodeType: 'FILE',
      versioningAvailable: true,
    });
    expect(await h.prisma.node.count({ where: { parentId: roomId } })).toBe(1);
  });

  it('rename: 409 NAME_CONFLICT and the node keeps its old name', async () => {
    await uploadFile(h, cookie, roomId, 'A.pdf');
    const b = await uploadFile(h, cookie, roomId, 'B.pdf');

    const res = await h
      .api()
      .patch(`/api/v1/nodes/${b.complete.body.id}`)
      .set('Cookie', cookie)
      .send({ name: 'A.pdf' })
      .expect(409);

    expect(res.body.error.details.suggestedName).toBe('A (1).pdf');
    const row = await h.prisma.node.findUniqueOrThrow({ where: { id: b.complete.body.id } });
    expect(row.name).toBe('B.pdf');
  });

  it('move: 409 NAME_CONFLICT and the node stays in its source folder', async () => {
    const src = await createFolder(h, cookie, roomId, 'src');
    const dst = await createFolder(h, cookie, roomId, 'dst');
    await uploadFile(h, cookie, dst.id, 'Same.pdf');
    const moving = await uploadFile(h, cookie, src.id, 'Same.pdf');

    const res = await h
      .api()
      .post(`/api/v1/nodes/${moving.complete.body.id}/move`)
      .set('Cookie', cookie)
      .send({ parentId: dst.id })
      .expect(409);

    expect(res.body.error.code).toBe('NAME_CONFLICT');
    const row = await h.prisma.node.findUniqueOrThrow({ where: { id: moving.complete.body.id } });
    expect(row.parentId).toBe(src.id);
  });

  it('detects a folder-vs-file conflict but offers no versioning (§6.1)', async () => {
    await createFolder(h, cookie, roomId, 'Ambiguous');
    const { complete } = await uploadFile(h, cookie, roomId, 'Ambiguous');

    expect(complete.status).toBe(409);
    expect(complete.body.error.details).toMatchObject({
      conflictingNodeType: 'FOLDER',
      versioningAvailable: false,
    });
  });

  it('rejects NEW_VERSION on a non-FILE pair with VALIDATION_FAILED (§6.4)', async () => {
    await createFolder(h, cookie, roomId, 'Ambiguous');
    const { complete } = await uploadFile(h, cookie, roomId, 'Ambiguous', {
      onConflict: 'NEW_VERSION',
    });
    expect(complete.status).toBe(400);
    expect(complete.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('KEEP_BOTH (§6.4)', () => {
  it('upload: creates a new node under the suffixed name, leaving the original alone', async () => {
    const first = await uploadFile(h, cookie, roomId, 'Report.pdf');
    const second = await uploadFile(h, cookie, roomId, 'Report.pdf', { onConflict: 'KEEP_BOTH' });

    expect(second.complete.status).toBe(201);
    expect(second.complete.body.name).toBe('Report (1).pdf');
    const original = await h.prisma.node.findUniqueOrThrow({
      where: { id: first.complete.body.id },
    });
    expect(original.name).toBe('Report.pdf');
  });

  it('rename: the node being renamed takes the suffixed name (§6.4 note)', async () => {
    await uploadFile(h, cookie, roomId, 'A.pdf');
    const b = await uploadFile(h, cookie, roomId, 'B.pdf');

    const res = await h
      .api()
      .patch(`/api/v1/nodes/${b.complete.body.id}`)
      .set('Cookie', cookie)
      .send({ name: 'A.pdf', onConflict: 'KEEP_BOTH' })
      .expect(200);

    expect(res.body.name).toBe('A (1).pdf');
    expect(await h.prisma.node.count({ where: { parentId: roomId } })).toBe(2);
  });

  it('move: the moving node takes the suffixed name in the destination', async () => {
    const src = await createFolder(h, cookie, roomId, 'src');
    const dst = await createFolder(h, cookie, roomId, 'dst');
    await uploadFile(h, cookie, dst.id, 'Same.pdf');
    const moving = await uploadFile(h, cookie, src.id, 'Same.pdf');

    const res = await h
      .api()
      .post(`/api/v1/nodes/${moving.complete.body.id}/move`)
      .set('Cookie', cookie)
      .send({ parentId: dst.id, onConflict: 'KEEP_BOTH' })
      .expect(200);

    expect(res.body.name).toBe('Same (1).pdf');
    expect(res.body.parentId).toBe(dst.id);
  });
});

describe('NEW_VERSION (§6.4)', () => {
  it('upload: adds v2 to the existing node and creates no second node', async () => {
    const first = await uploadFile(h, cookie, roomId, 'Report.pdf', {
      bytes: Buffer.alloc(100, 1),
    });
    const second = await uploadFile(h, cookie, roomId, 'Report.pdf', {
      bytes: Buffer.alloc(300, 2),
      onConflict: 'NEW_VERSION',
    });

    expect(second.complete.status).toBe(201);
    expect(second.complete.body.id).toBe(first.complete.body.id);

    const versions = await h.prisma.fileVersion.findMany({
      where: { nodeId: first.complete.body.id },
      orderBy: { versionNumber: 'asc' },
    });
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2]);
    expect(await h.prisma.node.count({ where: { parentId: roomId } })).toBe(1);
  });

  it('upload: node size follows the latest version only (§2.3)', async () => {
    const first = await uploadFile(h, cookie, roomId, 'R.pdf', { bytes: Buffer.alloc(100, 1) });
    await uploadFile(h, cookie, roomId, 'R.pdf', {
      bytes: Buffer.alloc(300, 2),
      onConflict: 'NEW_VERSION',
    });

    const node = await h.prisma.node.findUniqueOrThrow({ where: { id: first.complete.body.id } });
    const room = await h.prisma.node.findUniqueOrThrow({ where: { id: roomId } });
    expect(node.size).toBe(300n);
    expect(room.size).toBe(300n); // not 400 — older versions do not count
    expect(room.itemCount).toBe(1);
  });

  it('upload: keeps the older version object in storage', async () => {
    const first = await uploadFile(h, cookie, roomId, 'R.pdf');
    const second = await uploadFile(h, cookie, roomId, 'R.pdf', { onConflict: 'NEW_VERSION' });
    expect(h.storage.has(first.init.storageKey)).toBe(true);
    expect(h.storage.has(second.init.storageKey)).toBe(true);
  });

  it('move: A latest version becomes B next version, A prior history is discarded (§6.4)', async () => {
    const src = await createFolder(h, cookie, roomId, 'src');
    const dst = await createFolder(h, cookie, roomId, 'dst');

    const bTarget = await uploadFile(h, cookie, dst.id, 'Same.pdf', { bytes: Buffer.alloc(10, 1) });
    // A has two versions; only its latest survives the transplant.
    const aV1 = await uploadFile(h, cookie, src.id, 'Same.pdf', { bytes: Buffer.alloc(20, 1) });
    const aV2 = await uploadFile(h, cookie, src.id, 'Same.pdf', {
      bytes: Buffer.alloc(30, 1),
      onConflict: 'NEW_VERSION',
    });

    await h
      .api()
      .post(`/api/v1/nodes/${aV1.complete.body.id}/move`)
      .set('Cookie', cookie)
      .send({ parentId: dst.id, onConflict: 'NEW_VERSION' })
      .expect(200);

    // A is gone
    expect(await h.prisma.node.findUnique({ where: { id: aV1.complete.body.id } })).toBeNull();
    // B has v1 (its own) and v2 (A's latest)
    const versions = await h.prisma.fileVersion.findMany({
      where: { nodeId: bTarget.complete.body.id },
      orderBy: { versionNumber: 'asc' },
    });
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2]);
    expect(versions[1].storageKey).toBe(aV2.init.storageKey);
    // A's discarded prior version is cleaned out of storage (§6.4 closing rule)
    expect(h.storage.has(aV1.init.storageKey)).toBe(false);
  });
});

describe('REPLACE (§6.4)', () => {
  it('upload: wipes the existing version history and starts at v1', async () => {
    const first = await uploadFile(h, cookie, roomId, 'R.pdf', { bytes: Buffer.alloc(100, 1) });
    await uploadFile(h, cookie, roomId, 'R.pdf', {
      bytes: Buffer.alloc(70, 2),
      onConflict: 'NEW_VERSION',
    });
    const replacing = await uploadFile(h, cookie, roomId, 'R.pdf', {
      bytes: Buffer.alloc(55, 3),
      onConflict: 'REPLACE',
    });

    const versions = await h.prisma.fileVersion.findMany({
      where: { nodeId: first.complete.body.id },
    });
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNumber).toBe(1);
    expect(versions[0].storageKey).toBe(replacing.init.storageKey);

    const node = await h.prisma.node.findUniqueOrThrow({ where: { id: first.complete.body.id } });
    expect(node.size).toBe(55n);
  });

  it('upload: deletes every replaced object from storage (§6.4 closing rule)', async () => {
    const first = await uploadFile(h, cookie, roomId, 'R.pdf');
    const second = await uploadFile(h, cookie, roomId, 'R.pdf', { onConflict: 'NEW_VERSION' });
    await uploadFile(h, cookie, roomId, 'R.pdf', { onConflict: 'REPLACE' });

    expect(h.storage.has(first.init.storageKey)).toBe(false);
    expect(h.storage.has(second.init.storageKey)).toBe(false);
  });

  it('move: A is deleted once its content has transplanted into B', async () => {
    const src = await createFolder(h, cookie, roomId, 'src');
    const dst = await createFolder(h, cookie, roomId, 'dst');
    const b = await uploadFile(h, cookie, dst.id, 'Same.pdf', { bytes: Buffer.alloc(10, 1) });
    const a = await uploadFile(h, cookie, src.id, 'Same.pdf', { bytes: Buffer.alloc(44, 1) });

    await h
      .api()
      .post(`/api/v1/nodes/${a.complete.body.id}/move`)
      .set('Cookie', cookie)
      .send({ parentId: dst.id, onConflict: 'REPLACE' })
      .expect(200);

    expect(await h.prisma.node.findUnique({ where: { id: a.complete.body.id } })).toBeNull();
    const versions = await h.prisma.fileVersion.findMany({
      where: { nodeId: b.complete.body.id },
    });
    expect(versions).toHaveLength(1);
    expect(versions[0].storageKey).toBe(a.init.storageKey);
    expect(h.storage.has(b.init.storageKey)).toBe(false);

    const dstRow = await h.prisma.node.findUniqueOrThrow({ where: { id: dst.id } });
    expect(dstRow.itemCount).toBe(1);
    expect(dstRow.size).toBe(44n);
  });
});
