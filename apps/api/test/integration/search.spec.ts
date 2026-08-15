import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getHarness, resetDb, type Harness } from '../helpers/harness';
import {
  createDataRoom,
  createFolder,
  makeUserAndLogin,
  relabelFile,
  uploadFile,
} from '../helpers/factories';

let h: Harness;
let cookie: string;
let roomId: string;
let financials: string;
let legal: string;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Uploads go through the PDF-only allow-list (§7.2), then the stored mime type
 * is rewritten — the corpus needs more than one type for the mimeType filter to
 * mean anything, and legacy rooms genuinely contain such files.
 */
async function uploadSpreadsheet(
  parentId: string,
  name: string,
  bytes: Buffer,
): Promise<void> {
  const { complete } = await uploadFile(h, cookie, parentId, name, { bytes });
  await relabelFile(h, complete.body.id, XLSX);
}

beforeEach(async () => {
  h = await getHarness();
  await resetDb(h.prisma);
  ({ cookie } = await makeUserAndLogin(h));
  roomId = (await createDataRoom(h, cookie, 'Project Meridian')).id;
  financials = (await createFolder(h, cookie, roomId, '02 Financials')).id;
  const audited = (await createFolder(h, cookie, financials, 'Audited Statements')).id;
  legal = (await createFolder(h, cookie, roomId, '03 Legal')).id;

  await uploadSpreadsheet(audited, 'Schedule_of_Indebtedness.xlsx', Buffer.alloc(1100, 1));
  await uploadFile(h, cookie, legal, 'Lease_Schedule_Annex_B.pdf', { bytes: Buffer.alloc(3800, 1) });
  await uploadSpreadsheet(financials, 'Capex_Schedule_FY25.xlsx', Buffer.alloc(742, 1));
  await uploadFile(h, cookie, financials, 'Unrelated.pdf', { bytes: Buffer.alloc(10, 1) });
});
afterAll(async () => h?.close());

// §8.5 search and filtering.
describe('GET /nodes/{id}/search (§8.5)', () => {
  it('matches names case-insensitively across the whole subtree', async () => {
    const res = await h
      .api()
      .get(`/api/v1/nodes/${roomId}/search`)
      .query({ q: 'schedule' })
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.items.map((n: { name: string }) => n.name).sort()).toEqual([
      'Capex_Schedule_FY25.xlsx',
      'Lease_Schedule_Annex_B.pdf',
      'Schedule_of_Indebtedness.xlsx',
    ]);
  });

  it('scopes results to the subtree of the requested node', async () => {
    const res = await h
      .api()
      .get(`/api/v1/nodes/${financials}/search`)
      .query({ q: 'schedule' })
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.items.map((n: { name: string }) => n.name).sort()).toEqual([
      'Capex_Schedule_FY25.xlsx',
      'Schedule_of_Indebtedness.xlsx',
    ]);
  });

  it('returns a human folder trail as pathLabel (design §8.2)', async () => {
    const res = await h
      .api()
      .get(`/api/v1/nodes/${roomId}/search`)
      .query({ q: 'Indebtedness' })
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.items[0].pathLabel).toBe('02 Financials / Audited Statements');
  });

  it('filters by type', async () => {
    const res = await h
      .api()
      .get(`/api/v1/nodes/${roomId}/search`)
      .query({ type: 'FOLDER' })
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.items.every((n: { type: string }) => n.type === 'FOLDER')).toBe(true);
    expect(res.body.items).toHaveLength(3);
  });

  it('filters by mimeType', async () => {
    const res = await h
      .api()
      .get(`/api/v1/nodes/${roomId}/search`)
      .query({ mimeType: XLSX })
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.items.map((n: { name: string }) => n.name).sort()).toEqual([
      'Capex_Schedule_FY25.xlsx',
      'Schedule_of_Indebtedness.xlsx',
    ]);
  });

  it('filters by size range, inclusive at both ends', async () => {
    const res = await h
      .api()
      .get(`/api/v1/nodes/${roomId}/search`)
      .query({ minSize: 742, maxSize: 1100, type: 'FILE' })
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.items.map((n: { name: string }) => n.name).sort()).toEqual([
      'Capex_Schedule_FY25.xlsx',
      'Schedule_of_Indebtedness.xlsx',
    ]);
  });

  it('filters by created date range', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const empty = await h
      .api()
      .get(`/api/v1/nodes/${roomId}/search`)
      .query({ createdFrom: tomorrow })
      .set('Cookie', cookie)
      .expect(200);
    expect(empty.body.items).toEqual([]);

    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const all = await h
      .api()
      .get(`/api/v1/nodes/${roomId}/search`)
      .query({ createdFrom: yesterday })
      .set('Cookie', cookie)
      .expect(200);
    expect(all.body.items.length).toBeGreaterThan(0);
  });

  it('combines filters conjunctively', async () => {
    const res = await h
      .api()
      .get(`/api/v1/nodes/${roomId}/search`)
      .query({ q: 'schedule', mimeType: XLSX, maxSize: 800 })
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.items.map((n: { name: string }) => n.name)).toEqual(['Capex_Schedule_FY25.xlsx']);
  });

  it('paginates search results by cursor (§4.3)', async () => {
    const first = await h
      .api()
      .get(`/api/v1/nodes/${roomId}/search`)
      .query({ q: 'schedule', limit: 2 })
      .set('Cookie', cookie)
      .expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await h
      .api()
      .get(`/api/v1/nodes/${roomId}/search`)
      .query({ q: 'schedule', limit: 2, cursor: first.body.nextCursor })
      .set('Cookie', cookie)
      .expect(200);
    expect(second.body.items).toHaveLength(1);
    const ids = [...first.body.items, ...second.body.items].map((n: { id: string }) => n.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('never returns nodes the caller cannot read (§5.2)', async () => {
    const grantee = await makeUserAndLogin(h, { email: 'g@example.test' });
    await h
      .api()
      .post(`/api/v1/nodes/${legal}/shares/people`)
      .set('Cookie', cookie)
      .send({ emails: ['g@example.test'] })
      .expect(201);

    // Searching the shared folder works…
    const ok = await h
      .api()
      .get(`/api/v1/nodes/${legal}/search`)
      .query({ q: 'schedule' })
      .set('Cookie', grantee.cookie)
      .expect(200);
    expect(ok.body.items.map((n: { name: string }) => n.name)).toEqual(['Lease_Schedule_Annex_B.pdf']);

    // …searching the room they were never given does not.
    await h
      .api()
      .get(`/api/v1/nodes/${roomId}/search`)
      .query({ q: 'schedule' })
      .set('Cookie', grantee.cookie)
      .expect(404);
  });

  it('returns everything in the subtree when no filters are given', async () => {
    const res = await h
      .api()
      .get(`/api/v1/nodes/${financials}/search`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.items).toHaveLength(4); // Audited Statements + 3 files
  });
});
