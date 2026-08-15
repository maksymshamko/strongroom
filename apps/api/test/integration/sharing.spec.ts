import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getHarness, resetDb, type Harness } from '../helpers/harness';
import { createDataRoom, createFolder, makeUser, makeUserAndLogin, uploadFile } from '../helpers/factories';

let h: Harness;
let owner: { cookie: string; user: { id: string; email: string } };
let roomId: string;
let folderId: string;
let fileId: string;

beforeEach(async () => {
  h = await getHarness();
  await resetDb(h.prisma);
  owner = (await makeUserAndLogin(h, { email: 'anna@harlanco.com', name: 'Anna Ruiz' })) as never;
  roomId = (await createDataRoom(h, owner.cookie, 'Project Meridian')).id;
  folderId = (await createFolder(h, owner.cookie, roomId, '02 Financials')).id;
  fileId = (await uploadFile(h, owner.cookie, folderId, 'QoE_Report.pdf')).complete.body.id;
  h.mailer.reset();
});
afterAll(async () => h?.close());

// §8.3 sharing.
describe('POST /nodes/{id}/shares/link (§8.3)', () => {
  it('creates a public link and is idempotent for the same node', async () => {
    const first = await h
      .api()
      .post(`/api/v1/nodes/${fileId}/shares/link`)
      .set('Cookie', owner.cookie)
      .expect(201);
    const second = await h
      .api()
      .post(`/api/v1/nodes/${fileId}/shares/link`)
      .set('Cookie', owner.cookie)
      .expect(201);

    expect(first.body.token).toHaveLength(32);
    expect(second.body.shareId).toBe(first.body.shareId);
    expect(await h.prisma.share.count({ where: { nodeId: fileId, mode: 'PUBLIC_LINK' } })).toBe(1);
  });

  it('issues a fresh link after the previous one was revoked', async () => {
    const first = await h
      .api()
      .post(`/api/v1/nodes/${fileId}/shares/link`)
      .set('Cookie', owner.cookie)
      .expect(201);
    await h.api().delete(`/api/v1/shares/${first.body.shareId}`).set('Cookie', owner.cookie).expect(204);
    const second = await h
      .api()
      .post(`/api/v1/nodes/${fileId}/shares/link`)
      .set('Cookie', owner.cookie)
      .expect(201);

    expect(second.body.shareId).not.toBe(first.body.shareId);
    expect(second.body.token).not.toBe(first.body.token);
  });
});

describe('POST /nodes/{id}/shares/people (§8.3, §9)', () => {
  it('creates grants, resolves existing users, and sends one invite each', async () => {
    const existing = await makeUser(h.prisma, { email: 'j.tran@meridianadv.com', name: 'Jonah Tran' });

    const res = await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['j.tran@meridianadv.com', 's.kaur@brightpath.vc'] })
      .expect(201);

    expect(res.body.grants).toHaveLength(2);
    const resolved = res.body.grants.find((g: { email: string }) => g.email === 'j.tran@meridianadv.com');
    const pending = res.body.grants.find((g: { email: string }) => g.email === 's.kaur@brightpath.vc');
    expect(resolved.status).toBe('ACCEPTED');
    expect(pending.status).toBe('PENDING');
    expect(pending.name).toBeNull();

    const rows = await h.prisma.shareGrant.findMany({ orderBy: { email: 'asc' } });
    expect(rows.find((r) => r.email === 'j.tran@meridianadv.com')!.userId).toBe(existing.id);
    expect(rows.find((r) => r.email === 's.kaur@brightpath.vc')!.userId).toBeNull();

    expect(h.mailer.sent).toHaveLength(2);
    expect(h.mailer.sent[0].subject).toContain('Anna Ruiz');
    expect(h.mailer.sent[0].subject).toContain('02 Financials');
  });

  it('lower-cases and de-duplicates emails, and skips an email that already has a grant', async () => {
    await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['Jonah@Example.Test', 'jonah@example.test'] })
      .expect(201);
    h.mailer.reset();

    await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['jonah@example.test'] })
      .expect(201);

    expect(await h.prisma.shareGrant.count()).toBe(1);
    expect(h.mailer.sent).toHaveLength(0); // no resend/reminder in this pass (§9)
  });

  it('does not fail the request when the mailer throws (§9 best-effort)', async () => {
    h.mailer.failNext = true;
    await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['someone@example.test'] })
      .expect(201);

    expect(await h.prisma.shareGrant.count()).toBe(1);
  });
});

describe('GET /nodes/{id}/shares (§8.3)', () => {
  it('reports inheritance when the share sits on an ancestor', async () => {
    await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['x@example.test'] })
      .expect(201);

    const res = await h.api().get(`/api/v1/nodes/${fileId}/shares`).set('Cookie', owner.cookie).expect(200);
    expect(res.body.inheritedFrom).toEqual({ nodeId: folderId, name: '02 Financials' });
    expect(res.body.grants.map((g: { email: string }) => g.email)).toContain('x@example.test');
  });

  it('reports inheritedFrom null when the share is on this node', async () => {
    await h
      .api()
      .post(`/api/v1/nodes/${fileId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['x@example.test'] })
      .expect(201);
    const res = await h.api().get(`/api/v1/nodes/${fileId}/shares`).set('Cookie', owner.cookie).expect(200);
    expect(res.body.inheritedFrom).toBeNull();
  });

  it('omits revoked grants and revoked links', async () => {
    const link = await h
      .api()
      .post(`/api/v1/nodes/${fileId}/shares/link`)
      .set('Cookie', owner.cookie)
      .expect(201);
    const people = await h
      .api()
      .post(`/api/v1/nodes/${fileId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['x@example.test'] })
      .expect(201);

    await h.api().delete(`/api/v1/shares/${link.body.shareId}`).set('Cookie', owner.cookie).expect(204);
    await h
      .api()
      .delete(`/api/v1/share-grants/${people.body.grants[0].id}`)
      .set('Cookie', owner.cookie)
      .expect(204);

    const res = await h.api().get(`/api/v1/nodes/${fileId}/shares`).set('Cookie', owner.cookie).expect(200);
    expect(res.body.link).toBeNull();
    expect(res.body.grants).toEqual([]);
  });
});

// §5 access control matrix — the single most important property in the system.
describe('access control matrix (§5.2, §5.4)', () => {
  const readPaths = (id: string) => [`/api/v1/nodes/${id}`, `/api/v1/nodes/${id}/children`];

  it('a stranger 404s on every read path (existence is not leaked)', async () => {
    const stranger = await makeUserAndLogin(h);
    for (const p of [...readPaths(roomId), ...readPaths(folderId), `/api/v1/nodes/${fileId}`]) {
      await h.api().get(p).set('Cookie', stranger.cookie).expect(404);
    }
  });

  it('an anonymous caller 401s where a session is required', async () => {
    await h.api().get(`/api/v1/nodes/${roomId}`).expect(401);
  });

  it('a grantee can read the shared node and its descendants', async () => {
    const grantee = await makeUserAndLogin(h, { email: 'g@example.test' });
    await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['g@example.test'] })
      .expect(201);

    await h.api().get(`/api/v1/nodes/${folderId}`).set('Cookie', grantee.cookie).expect(200);
    await h.api().get(`/api/v1/nodes/${fileId}`).set('Cookie', grantee.cookie).expect(200);
  });

  it('a grantee cannot read upward past the shared node (§5.2)', async () => {
    const grantee = await makeUserAndLogin(h, { email: 'g@example.test' });
    await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['g@example.test'] })
      .expect(201);

    await h.api().get(`/api/v1/nodes/${roomId}`).set('Cookie', grantee.cookie).expect(404);
  });

  it('a grantee gets a breadcrumb starting at the shared node (§5.5)', async () => {
    const grantee = await makeUserAndLogin(h, { email: 'g@example.test' });
    await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['g@example.test'] })
      .expect(201);

    const res = await h.api().get(`/api/v1/nodes/${fileId}`).set('Cookie', grantee.cookie).expect(200);
    expect(res.body.breadcrumb.map((s: { name: string }) => s.name)).toEqual([
      '02 Financials',
      'QoE_Report.pdf',
    ]);
    expect(JSON.stringify(res.body)).not.toContain('Project Meridian');
  });

  it('a grantee gets 403 — not 404 — when mutating something they can read (§5.4)', async () => {
    const grantee = await makeUserAndLogin(h, { email: 'g@example.test' });
    await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['g@example.test'] })
      .expect(201);

    const rename = await h
      .api()
      .patch(`/api/v1/nodes/${fileId}`)
      .set('Cookie', grantee.cookie)
      .send({ name: 'hijacked.pdf' })
      .expect(403);
    expect(rename.body.error.code).toBe('FORBIDDEN');

    await h.api().delete(`/api/v1/nodes/${fileId}`).set('Cookie', grantee.cookie).expect(403);
    await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/link`)
      .set('Cookie', grantee.cookie)
      .expect(403);
    await h
      .api()
      .post('/api/v1/uploads/init')
      .set('Cookie', grantee.cookie)
      .send({ parentId: folderId, name: 'x.pdf', size: 5, mimeType: 'application/pdf' })
      .expect(403);
  });

  it('a revoked grantee loses read immediately (§8.3, spec 001 §4.4.18)', async () => {
    const grantee = await makeUserAndLogin(h, { email: 'g@example.test' });
    const created = await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['g@example.test'] })
      .expect(201);

    await h.api().get(`/api/v1/nodes/${folderId}`).set('Cookie', grantee.cookie).expect(200);
    await h
      .api()
      .delete(`/api/v1/share-grants/${created.body.grants[0].id}`)
      .set('Cookie', owner.cookie)
      .expect(204);
    await h.api().get(`/api/v1/nodes/${folderId}`).set('Cookie', grantee.cookie).expect(404);
  });

  it('a grantee never appears as an owner in the DTO (§4.4 viewerRole)', async () => {
    const grantee = await makeUserAndLogin(h, { email: 'g@example.test' });
    await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['g@example.test'] })
      .expect(201);

    const res = await h.api().get(`/api/v1/nodes/${folderId}`).set('Cookie', grantee.cookie).expect(200);
    expect(res.body.node.viewerRole).toBe('VIEWER');
  });

  it('children listings are filtered by access, not filtered after fetch', async () => {
    const grantee = await makeUserAndLogin(h, { email: 'g@example.test' });
    await createFolder(h, owner.cookie, roomId, '03 Legal');
    await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['g@example.test'] })
      .expect(201);

    // The grantee can list the shared folder, but the room's other children stay invisible.
    const children = await h
      .api()
      .get(`/api/v1/nodes/${folderId}/children`)
      .set('Cookie', grantee.cookie)
      .expect(200);
    expect(children.body.items.map((n: { name: string }) => n.name)).toEqual(['QoE_Report.pdf']);
    await h.api().get(`/api/v1/nodes/${roomId}/children`).set('Cookie', grantee.cookie).expect(404);
  });
});

// §8.4 public link access.
describe('public link access (§8.4, §5.6)', () => {
  it('resolves the token anonymously and logs the view', async () => {
    const link = await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/link`)
      .set('Cookie', owner.cookie)
      .expect(201);

    const res = await h.api().get(`/api/v1/public/shares/${link.body.token}`).expect(200);
    expect(res.body.node.id).toBe(folderId);
    expect(res.body.share).toEqual({ mode: 'PUBLIC_LINK', nodeId: folderId });

    const logs = await h.prisma.shareAccessLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0].viewerUserId).toBeNull();
    expect(logs[0].anonId).toBeTruthy();
  });

  it('logs an authenticated viewer by user id, not anonId', async () => {
    const link = await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/link`)
      .set('Cookie', owner.cookie)
      .expect(201);
    const someone = await makeUserAndLogin(h);

    await h
      .api()
      .get(`/api/v1/public/shares/${link.body.token}`)
      .set('Cookie', someone.cookie)
      .expect(200);

    const log = await h.prisma.shareAccessLog.findFirstOrThrow();
    expect(log.viewerUserId).toBe(someone.user.id);
  });

  it('grants read to the whole subtree under the shared node', async () => {
    const link = await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/link`)
      .set('Cookie', owner.cookie)
      .expect(201);

    await h
      .api()
      .get(`/api/v1/public/shares/${link.body.token}/nodes/${fileId}`)
      .expect(200);
    await h
      .api()
      .get(`/api/v1/public/shares/${link.body.token}/nodes/${folderId}/children`)
      .expect(200);
  });

  it('404s for a node outside the shared subtree (§5.6)', async () => {
    const other = await createFolder(h, owner.cookie, roomId, '03 Legal');
    const link = await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/link`)
      .set('Cookie', owner.cookie)
      .expect(201);

    await h.api().get(`/api/v1/public/shares/${link.body.token}/nodes/${other.id}`).expect(404);
    await h.api().get(`/api/v1/public/shares/${link.body.token}/nodes/${roomId}`).expect(404);
  });

  it('404s once the link is revoked ("no longer available")', async () => {
    const link = await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/link`)
      .set('Cookie', owner.cookie)
      .expect(201);
    await h.api().delete(`/api/v1/shares/${link.body.shareId}`).set('Cookie', owner.cookie).expect(204);

    await h.api().get(`/api/v1/public/shares/${link.body.token}`).expect(404);
  });

  it('404s for an unknown token', async () => {
    await h.api().get('/api/v1/public/shares/not-a-real-token-000000').expect(404);
  });

  it('never allows a mutation through a public link', async () => {
    const link = await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/link`)
      .set('Cookie', owner.cookie)
      .expect(201);
    // There is no public mutation route at all — a tokened caller hitting the
    // authenticated surface is unauthenticated.
    await h
      .api()
      .patch(`/api/v1/nodes/${fileId}`)
      .query({ t: link.body.token })
      .send({ name: 'x.pdf' })
      .expect(401);
  });

  it('serves file content through the link and logs it', async () => {
    const link = await h
      .api()
      .post(`/api/v1/nodes/${fileId}/shares/link`)
      .set('Cookie', owner.cookie)
      .expect(201);

    const res = await h
      .api()
      .get(`/api/v1/public/shares/${link.body.token}/nodes/${fileId}/content`)
      .expect(200);
    expect(res.body.url).toBeTruthy();
    expect(await h.prisma.shareAccessLog.count()).toBeGreaterThan(0);
  });
});

// §8.1 shared-with-me.
describe('GET /shared-with-me (§8.1, spec 001 §4.1.2)', () => {
  it('lists items shared with the caller, with who shared them', async () => {
    const grantee = await makeUserAndLogin(h, { email: 'g@example.test' });
    await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['g@example.test'] })
      .expect(201);

    const res = await h.api().get('/api/v1/shared-with-me').set('Cookie', grantee.cookie).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      id: folderId,
      name: '02 Financials',
      sharedByEmail: 'anna@harlanco.com',
    });
  });

  it('surfaces grants created before the account existed once linked (§3.5)', async () => {
    await h
      .api()
      .post(`/api/v1/nodes/${fileId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['later@example.test'] })
      .expect(201);

    const late = await makeUserAndLogin(h, { email: 'later@example.test' });
    const res = await h.api().get('/api/v1/shared-with-me').set('Cookie', late.cookie).expect(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([fileId]);
  });

  it('excludes revoked shares', async () => {
    const grantee = await makeUserAndLogin(h, { email: 'g@example.test' });
    const created = await h
      .api()
      .post(`/api/v1/nodes/${folderId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['g@example.test'] })
      .expect(201);
    await h
      .api()
      .delete(`/api/v1/share-grants/${created.body.grants[0].id}`)
      .set('Cookie', owner.cookie)
      .expect(204);

    const res = await h.api().get('/api/v1/shared-with-me').set('Cookie', grantee.cookie).expect(200);
    expect(res.body.items).toEqual([]);
  });

  it('does not list the owner own rooms as shared with them', async () => {
    const res = await h.api().get('/api/v1/shared-with-me').set('Cookie', owner.cookie).expect(200);
    expect(res.body.items).toEqual([]);
  });
});

// §8.1 delete-preview share impact + spec 001 §4.3.13 shared-delete warning.
describe('delete preview share impact (§8.1)', () => {
  it('counts people and active links that would lose access', async () => {
    await h
      .api()
      .post(`/api/v1/nodes/${fileId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails: ['a@example.test', 'b@example.test'] })
      .expect(201);
    await h.api().post(`/api/v1/nodes/${fileId}/shares/link`).set('Cookie', owner.cookie).expect(201);

    const res = await h
      .api()
      .get(`/api/v1/nodes/${folderId}/delete-preview`)
      .set('Cookie', owner.cookie)
      .expect(200);

    // Shares inside the subtree count, because deleting the folder destroys them.
    expect(res.body.shareImpact.peopleCount).toBe(2);
    expect(res.body.shareImpact.activeLinkCount).toBe(1);
    expect(res.body.shareImpact.people.map((p: { email: string }) => p.email).sort()).toEqual([
      'a@example.test',
      'b@example.test',
    ]);
  });

  it('caps the listed people at 4 while keeping the true count', async () => {
    const emails = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => `${x}@example.test`);
    await h
      .api()
      .post(`/api/v1/nodes/${fileId}/shares/people`)
      .set('Cookie', owner.cookie)
      .send({ emails })
      .expect(201);

    const res = await h
      .api()
      .get(`/api/v1/nodes/${fileId}/delete-preview`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(res.body.shareImpact.peopleCount).toBe(6);
    expect(res.body.shareImpact.people).toHaveLength(4);
  });
});
