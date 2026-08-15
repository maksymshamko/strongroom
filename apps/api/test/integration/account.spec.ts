import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { getHarness, resetDb, type Harness } from '../helpers/harness';
import {
  createDataRoom,
  createFolder,
  login,
  makeUser,
  makeUserAndLogin,
  uploadFile,
  PASSWORD,
} from '../helpers/factories';

let h: Harness;

beforeEach(async () => {
  h = await getHarness();
  await resetDb(h.prisma);
});
afterAll(async () => h?.close());

// §8.6 account.
describe('POST /account/password (§8.6)', () => {
  it('changes the password when the current one is supplied and correct', async () => {
    const { user, cookie } = await makeUserAndLogin(h);
    await h
      .api()
      .post('/api/v1/account/password')
      .set('Cookie', cookie)
      .send({ currentPassword: PASSWORD, newPassword: 'a-brand-new-password' })
      .expect(204);

    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare('a-brand-new-password', row.passwordHash!)).toBe(true);
    await login(h, user.email, 'a-brand-new-password');
  });

  it('rejects a wrong current password', async () => {
    const { cookie } = await makeUserAndLogin(h);
    const res = await h
      .api()
      .post('/api/v1/account/password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'not-it', newPassword: 'a-brand-new-password' })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('requires the current password when the account has one (§8.6)', async () => {
    const { cookie } = await makeUserAndLogin(h);
    const res = await h
      .api()
      .post('/api/v1/account/password')
      .set('Cookie', cookie)
      .send({ newPassword: 'a-brand-new-password' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('adds a password with no current-password check for a Google-only account (design §9.2)', async () => {
    const user = await makeUser(h.prisma, {
      email: 'marcus@oyelaran.co',
      withPassword: false,
      googleId: 'g-1',
    });
    // No password yet, so log in via a directly-issued session is not possible;
    // the account gains one through this endpoint after a Google sign-in.
    const cookie = await h.issueSessionFor(user.id);

    await h
      .api()
      .post('/api/v1/account/password')
      .set('Cookie', cookie)
      .send({ newPassword: 'my-first-password-12' })
      .expect(204);

    await login(h, 'marcus@oyelaran.co', 'my-first-password-12');
  });

  it('enforces the 12-character minimum (design §9.1)', async () => {
    const { cookie } = await makeUserAndLogin(h);
    await h
      .api()
      .post('/api/v1/account/password')
      .set('Cookie', cookie)
      .send({ currentPassword: PASSWORD, newPassword: 'short' })
      .expect(400);
  });
});

describe('GET /account/delete-preview and DELETE /account (§8.6)', () => {
  it('reports the scope of what deletion destroys', async () => {
    const { cookie } = await makeUserAndLogin(h, { email: 'anna@harlanco.com' });
    const room = await createDataRoom(h, cookie, 'Room');
    const folder = await createFolder(h, cookie, room.id, 'F');
    await uploadFile(h, cookie, folder.id, 'a.pdf');
    await uploadFile(h, cookie, folder.id, 'b.pdf');
    await h
      .api()
      .post(`/api/v1/nodes/${room.id}/shares/people`)
      .set('Cookie', cookie)
      .send({ emails: ['x@example.test', 'y@example.test'] })
      .expect(201);

    const res = await h.api().get('/api/v1/account/delete-preview').set('Cookie', cookie).expect(200);
    expect(res.body).toEqual({
      dataRooms: 1,
      documents: 2,
      collaborators: 2,
      email: 'anna@harlanco.com',
    });
  });

  it('requires the typed confirmation email to match (design §9.3)', async () => {
    const { cookie } = await makeUserAndLogin(h, { email: 'anna@harlanco.com' });
    const res = await h
      .api()
      .delete('/api/v1/account')
      .set('Cookie', cookie)
      .send({ confirmEmail: 'someone.else@example.test' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(await h.prisma.user.count()).toBe(1);
  });

  it('cascades to nodes, versions, shares and grants, and clears the session', async () => {
    const { user, cookie } = await makeUserAndLogin(h, { email: 'anna@harlanco.com' });
    const room = await createDataRoom(h, cookie, 'Room');
    const { init } = await uploadFile(h, cookie, room.id, 'a.pdf');
    await h
      .api()
      .post(`/api/v1/nodes/${room.id}/shares/people`)
      .set('Cookie', cookie)
      .send({ emails: ['x@example.test'] })
      .expect(201);

    await h
      .api()
      .delete('/api/v1/account')
      .set('Cookie', cookie)
      .send({ confirmEmail: 'ANNA@harlanco.com' }) // case-insensitive per §8.6
      .expect(204);

    expect(await h.prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await h.prisma.node.count()).toBe(0);
    expect(await h.prisma.fileVersion.count()).toBe(0);
    expect(await h.prisma.share.count()).toBe(0);
    expect(await h.prisma.shareGrant.count()).toBe(0);
    // Storage objects are cleaned too (§8.6).
    expect(h.storage.has(init.storageKey)).toBe(false);
    await h.api().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
  });

  it('does not delete data rooms owned by other people that were shared with the caller', async () => {
    const other = await makeUserAndLogin(h, { email: 'owner@example.test' });
    const room = await createDataRoom(h, other.cookie, 'Their Room');
    const leaving = await makeUserAndLogin(h, { email: 'leaving@example.test' });
    await h
      .api()
      .post(`/api/v1/nodes/${room.id}/shares/people`)
      .set('Cookie', other.cookie)
      .send({ emails: ['leaving@example.test'] })
      .expect(201);

    await h
      .api()
      .delete('/api/v1/account')
      .set('Cookie', leaving.cookie)
      .send({ confirmEmail: 'leaving@example.test' })
      .expect(204);

    expect(await h.prisma.node.findUnique({ where: { id: room.id } })).not.toBeNull();
  });
});
