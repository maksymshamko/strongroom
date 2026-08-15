import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getHarness, resetDb, type Harness } from '../helpers/harness';
import { makeUser, makeUserAndLogin, PASSWORD } from '../helpers/factories';

let h: Harness;

beforeEach(async () => {
  h = await getHarness();
  await resetDb(h.prisma);
});
afterAll(async () => h?.close());

// §1.1 — the session payload carries identity, not security posture.
describe('UserDto shape (§1.1)', () => {
  it('does not expose hasPassword or hasGoogle from /auth/login', async () => {
    const user = await makeUser(h.prisma, { email: 'anna@harlanco.com' });
    const res = await h
      .api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);

    expect(res.body.user).toEqual({
      id: user.id,
      email: 'anna@harlanco.com',
      name: user.name,
    });
  });

  it('does not expose them from /auth/me either', async () => {
    const { cookie } = await makeUserAndLogin(h);
    const res = await h.api().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    expect(Object.keys(res.body.user).sort()).toEqual(['email', 'id', 'name']);
  });
});

// §1.2 — the account-scoped security endpoint.
describe('GET /account/security (§1.2)', () => {
  it('reports password and Google state for the caller', async () => {
    const { cookie } = await makeUserAndLogin(h, { email: 'anna@harlanco.com' });
    const res = await h.api().get('/api/v1/account/security').set('Cookie', cookie).expect(200);

    expect(res.body).toEqual({
      hasPassword: true,
      google: { connected: false, email: null },
    });
  });

  it('reports a Google-only account as having no password', async () => {
    const user = await makeUser(h.prisma, {
      email: 'marcus@oyelaran.co',
      withPassword: false,
      googleId: 'google-123',
    });
    const cookie = await h.issueSessionFor(user.id);

    const res = await h.api().get('/api/v1/account/security').set('Cookie', cookie).expect(200);
    expect(res.body.hasPassword).toBe(false);
    expect(res.body.google.connected).toBe(true);
  });

  it('requires a session', async () => {
    await h.api().get('/api/v1/account/security').expect(401);
  });

  it('never describes another account', async () => {
    await makeUser(h.prisma, { email: 'other@example.test', googleId: 'g-other' });
    const { cookie } = await makeUserAndLogin(h, { email: 'me@example.test' });

    const res = await h.api().get('/api/v1/account/security').set('Cookie', cookie).expect(200);
    expect(res.body.google.connected).toBe(false);
  });
});

// §1.5 — unlinking must not lock the account out.
describe('DELETE /account/google (§1.5)', () => {
  it('refuses to unlink when the account has no password', async () => {
    const user = await makeUser(h.prisma, {
      email: 'marcus@oyelaran.co',
      withPassword: false,
      googleId: 'google-123',
    });
    const cookie = await h.issueSessionFor(user.id);

    const res = await h.api().delete('/api/v1/account/google').set('Cookie', cookie).expect(409);
    expect(res.body.error.code).toBe('PASSWORD_REQUIRED');

    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.googleId).toBe('google-123');
  });

  it('unlinks once a password exists', async () => {
    const user = await makeUser(h.prisma, { email: 'anna@harlanco.com', googleId: 'google-456' });
    const cookie = await h.issueSessionFor(user.id);

    await h.api().delete('/api/v1/account/google').set('Cookie', cookie).expect(204);

    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.googleId).toBeNull();
  });

  it('lets a Google-only account set a password and then unlink (§1.5 path out)', async () => {
    const user = await makeUser(h.prisma, {
      email: 'marcus@oyelaran.co',
      withPassword: false,
      googleId: 'google-789',
    });
    const cookie = await h.issueSessionFor(user.id);

    await h
      .api()
      .post('/api/v1/account/password')
      .set('Cookie', cookie)
      .send({ newPassword: 'my-first-password-12' })
      .expect(204);

    await h.api().delete('/api/v1/account/google').set('Cookie', cookie).expect(204);
  });

  it('404s when nothing is linked', async () => {
    const { cookie } = await makeUserAndLogin(h);
    const res = await h.api().delete('/api/v1/account/google').set('Cookie', cookie).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// §1.4 — linking rules. The OAuth round trip itself is not exercised here; the
// linking decision is, through the same service the callback calls.
describe('Google linking rules (§1.4)', () => {
  it('rejects a googleId already attached to another account', async () => {
    await makeUser(h.prisma, { email: 'taken@example.test', googleId: 'shared-google-id' });
    const { user, cookie } = await makeUserAndLogin(h, { email: 'me@example.test' });

    const { AccountService } = await import('../../src/application/account.service');
    const service = h.app.get(AccountService);

    await expect(
      service.linkGoogle(user.id, {
        googleId: 'shared-google-id',
        email: 'whatever@example.test',
        name: 'Whoever',
      }),
    ).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' });

    const res = await h.api().get('/api/v1/account/security').set('Cookie', cookie).expect(200);
    expect(res.body.google.connected).toBe(false);
  });

  it('links a Google identity whose email differs from the account email', async () => {
    const { user, cookie } = await makeUserAndLogin(h, { email: 'personal@example.test' });

    const { AccountService } = await import('../../src/application/account.service');
    await h.app.get(AccountService).linkGoogle(user.id, {
      googleId: 'work-google-id',
      email: 'work@company.test',
      name: 'Work Account',
    });

    const res = await h.api().get('/api/v1/account/security').set('Cookie', cookie).expect(200);
    expect(res.body.google).toEqual({ connected: true, email: 'work@company.test' });
  });

  it('rejects linking a second identity while one is already attached', async () => {
    const { user } = await makeUserAndLogin(h, { email: 'me@example.test' });
    const { AccountService } = await import('../../src/application/account.service');
    const service = h.app.get(AccountService);

    await service.linkGoogle(user.id, { googleId: 'first', email: 'a@b.test', name: 'A' });
    await expect(
      service.linkGoogle(user.id, { googleId: 'second', email: 'c@d.test', name: 'C' }),
    ).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' });
  });
});
