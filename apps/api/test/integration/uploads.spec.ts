import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getHarness, resetDb, type Harness } from '../helpers/harness';
import { createDataRoom, makeUserAndLogin, uploadFile } from '../helpers/factories';
import { MAX_FILE_BYTES } from '@dataroom/contracts';

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

// §7 uploads.
describe('POST /uploads/init (§7.1, §7.2)', () => {
  it('returns a signed URL and a storage key that is a uuid, never the filename (§2.1)', async () => {
    const res = await h
      .api()
      .post('/api/v1/uploads/init')
      .set('Cookie', cookie)
      .send({ parentId: roomId, name: 'Secret_Deal_Terms.pdf', size: 10, mimeType: 'application/pdf' })
      .expect(201);

    expect(res.body.signedUrl).toBeTruthy();
    expect(res.body.storageKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.storageKey).not.toContain('Secret_Deal_Terms');
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('writes no Node — only a PendingUpload (§7.1)', async () => {
    await h
      .api()
      .post('/api/v1/uploads/init')
      .set('Cookie', cookie)
      .send({ parentId: roomId, name: 'a.pdf', size: 10, mimeType: 'application/pdf' })
      .expect(201);

    expect(await h.prisma.node.count({ where: { parentId: roomId } })).toBe(0);
    expect(await h.prisma.pendingUpload.count()).toBe(1);
  });

  it('rejects a file above MAX_FILE_BYTES with 413 (§7.2)', async () => {
    const res = await h
      .api()
      .post('/api/v1/uploads/init')
      .set('Cookie', cookie)
      .send({
        parentId: roomId,
        name: 'huge.pdf',
        size: (MAX_FILE_BYTES + 1n).toString(),
        mimeType: 'application/pdf',
      })
      .expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  // A file is not a container. A client that treats one as a folder — a viewer
  // deep-linked to /n/<fileId>, a caller replaying an id it mistook for a
  // directory — must be refused before any storage URL is minted, or the room
  // grows a node parented to a PDF.
  describe('refuses a file as the upload destination (§6.3)', () => {
    let fileId: string;

    beforeEach(async () => {
      const { complete } = await uploadFile(h, cookie, roomId, 'Contract.pdf');
      fileId = complete.body.id;
    });

    it('answers 409 INVALID_MOVE', async () => {
      const res = await h
        .api()
        .post('/api/v1/uploads/init')
        .set('Cookie', cookie)
        .send({ parentId: fileId, name: 'nested.pdf', size: 10, mimeType: 'application/pdf' })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_MOVE');
    });

    it('mints no upload URL and leaves no pending row behind', async () => {
      const before = await h.prisma.pendingUpload.count();

      await h
        .api()
        .post('/api/v1/uploads/init')
        .set('Cookie', cookie)
        .send({ parentId: fileId, name: 'nested.pdf', size: 10, mimeType: 'application/pdf' })
        .expect(409);

      expect(await h.prisma.pendingUpload.count()).toBe(before);
      expect(await h.prisma.node.count({ where: { parentId: fileId } })).toBe(0);
    });

    it('refuses a folder under a file too, by the same rule', async () => {
      const res = await h
        .api()
        .post('/api/v1/nodes/folders')
        .set('Cookie', cookie)
        .send({ parentId: fileId, name: 'Attachments' })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_MOVE');
    });
  });

  it('rejects a mime type outside the allow-list with 415 (§7.2)', async () => {
    const res = await h
      .api()
      .post('/api/v1/uploads/init')
      .set('Cookie', cookie)
      .send({ parentId: roomId, name: 'evil.exe', size: 10, mimeType: 'application/x-msdownload' })
      .expect(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects a spreadsheet — the MVP allow-list is PDF only (§7.2)', async () => {
    const res = await h
      .api()
      .post('/api/v1/uploads/init')
      .set('Cookie', cookie)
      .send({
        parentId: roomId,
        name: 'model.xlsx',
        size: 10,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('reports a conflict advisory without failing (§7.3)', async () => {
    await uploadFile(h, cookie, roomId, 'Report.pdf');
    const res = await h
      .api()
      .post('/api/v1/uploads/init')
      .set('Cookie', cookie)
      .send({ parentId: roomId, name: 'Report.pdf', size: 10, mimeType: 'application/pdf' })
      .expect(201);

    expect(res.body.conflict).toMatchObject({ suggestedName: 'Report (1).pdf' });
  });

  it('refuses to init into a folder the caller cannot write', async () => {
    const other = await makeUserAndLogin(h);
    await h
      .api()
      .post('/api/v1/uploads/init')
      .set('Cookie', other.cookie)
      .send({ parentId: roomId, name: 'a.pdf', size: 10, mimeType: 'application/pdf' })
      .expect(404);
  });
});

describe('POST /uploads/{id}/complete (§7.4, §7.5)', () => {
  it('creates the node, version 1, and the ancestor rollups', async () => {
    const { init, complete } = await uploadFile(h, cookie, roomId, 'a.pdf', {
      bytes: Buffer.alloc(4200, 1),
    });

    expect(complete.status).toBe(201);
    expect(complete.body).toMatchObject({ name: 'a.pdf', type: 'FILE', size: '4200' });

    const version = await h.prisma.fileVersion.findFirstOrThrow({
      where: { nodeId: complete.body.id },
    });
    expect(version.versionNumber).toBe(1);
    expect(version.storageKey).toBe(init.storageKey);

    const room = await h.prisma.node.findUniqueOrThrow({ where: { id: roomId } });
    expect(room.size).toBe(4200n);
    expect(room.itemCount).toBe(1);
  });

  it('consumes the PendingUpload row (§7.5)', async () => {
    await uploadFile(h, cookie, roomId, 'a.pdf');
    expect(await h.prisma.pendingUpload.count()).toBe(0);
  });

  it('fails when the storage object does not exist (§7.4)', async () => {
    const init = await h
      .api()
      .post('/api/v1/uploads/init')
      .set('Cookie', cookie)
      .send({ parentId: roomId, name: 'ghost.pdf', size: 10, mimeType: 'application/pdf' })
      .expect(201);

    // Client claims completion without ever uploading.
    const res = await h
      .api()
      .post(`/api/v1/uploads/${init.body.uploadId}/complete`)
      .set('Cookie', cookie)
      .send({})
      .expect(409);

    expect(res.body.error.code).toBe('UPLOAD_VERIFICATION_FAILED');
    expect(await h.prisma.node.count({ where: { parentId: roomId } })).toBe(0);
  });

  it('fails when the uploaded size differs from the declared size (§7.4)', async () => {
    const init = await h
      .api()
      .post('/api/v1/uploads/init')
      .set('Cookie', cookie)
      .send({ parentId: roomId, name: 'lie.pdf', size: 10, mimeType: 'application/pdf' })
      .expect(201);

    h.storage.put(init.body.storageKey, Buffer.alloc(9999, 1), 'application/pdf');

    const res = await h
      .api()
      .post(`/api/v1/uploads/${init.body.uploadId}/complete`)
      .set('Cookie', cookie)
      .send({})
      .expect(409);

    expect(res.body.error.code).toBe('UPLOAD_VERIFICATION_FAILED');
    // The orphan is cleaned up and the pending row consumed.
    expect(h.storage.has(init.body.storageKey)).toBe(false);
    expect(await h.prisma.pendingUpload.count()).toBe(0);
  });

  it('fails when the stored content-type differs from the declared type (§7.4)', async () => {
    const init = await h
      .api()
      .post('/api/v1/uploads/init')
      .set('Cookie', cookie)
      .send({ parentId: roomId, name: 'mislabelled.pdf', size: 5, mimeType: 'application/pdf' })
      .expect(201);

    h.storage.put(init.body.storageKey, Buffer.alloc(5, 1), 'application/zip');

    const res = await h
      .api()
      .post(`/api/v1/uploads/${init.body.uploadId}/complete`)
      .set('Cookie', cookie)
      .send({})
      .expect(409);
    expect(res.body.error.code).toBe('UPLOAD_VERIFICATION_FAILED');
  });

  it('cannot be completed by a different user (§7.1 — the pending row is the authority)', async () => {
    const init = await h
      .api()
      .post('/api/v1/uploads/init')
      .set('Cookie', cookie)
      .send({ parentId: roomId, name: 'a.pdf', size: 5, mimeType: 'application/pdf' })
      .expect(201);
    h.storage.put(init.body.storageKey, Buffer.alloc(5, 1), 'application/pdf');

    const other = await makeUserAndLogin(h);
    await h
      .api()
      .post(`/api/v1/uploads/${init.body.uploadId}/complete`)
      .set('Cookie', other.cookie)
      .send({})
      .expect(404);
  });

  it('is not replayable — a consumed uploadId 404s on a second complete', async () => {
    const { init } = await uploadFile(h, cookie, roomId, 'a.pdf');
    await h
      .api()
      .post(`/api/v1/uploads/${init.uploadId}/complete`)
      .set('Cookie', cookie)
      .send({})
      .expect(404);
  });
});

describe('POST /uploads/{id}/abort (§8.2)', () => {
  it('removes the object and the pending row', async () => {
    const init = await h
      .api()
      .post('/api/v1/uploads/init')
      .set('Cookie', cookie)
      .send({ parentId: roomId, name: 'a.pdf', size: 5, mimeType: 'application/pdf' })
      .expect(201);
    h.storage.put(init.body.storageKey, Buffer.alloc(5, 1), 'application/pdf');

    await h.api().post(`/api/v1/uploads/${init.body.uploadId}/abort`).set('Cookie', cookie).expect(204);

    expect(h.storage.has(init.body.storageKey)).toBe(false);
    expect(await h.prisma.pendingUpload.count()).toBe(0);
  });
});

describe('GET /nodes/{id}/content (§7.6)', () => {
  it('returns a signed URL with the original filename and mime type', async () => {
    const { complete } = await uploadFile(h, cookie, roomId, 'QoE_Report.pdf');
    const res = await h
      .api()
      .get(`/api/v1/nodes/${complete.body.id}/content`)
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body).toMatchObject({ filename: 'QoE_Report.pdf', mimeType: 'application/pdf' });
    expect(res.body.url).toBeTruthy();
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('serves an older version on request (§8.1)', async () => {
    const first = await uploadFile(h, cookie, roomId, 'R.pdf');
    await uploadFile(h, cookie, roomId, 'R.pdf', { onConflict: 'NEW_VERSION' });

    const res = await h
      .api()
      .get(`/api/v1/nodes/${first.complete.body.id}/content`)
      .query({ version: 1 })
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.url).toContain(first.init.storageKey);
  });

  it('404s for a stranger (§5.4)', async () => {
    const { complete } = await uploadFile(h, cookie, roomId, 'a.pdf');
    const other = await makeUserAndLogin(h);
    await h
      .api()
      .get(`/api/v1/nodes/${complete.body.id}/content`)
      .set('Cookie', other.cookie)
      .expect(404);
  });
});

describe('GET /nodes/{id}/versions (§8.1)', () => {
  it('lists versions newest-first with uploader names', async () => {
    const first = await uploadFile(h, cookie, roomId, 'R.pdf');
    await uploadFile(h, cookie, roomId, 'R.pdf', { onConflict: 'NEW_VERSION' });

    const res = await h
      .api()
      .get(`/api/v1/nodes/${first.complete.body.id}/versions`)
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.items.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([2, 1]);
    expect(res.body.items[0].createdByName).toBeTruthy();
  });
});
