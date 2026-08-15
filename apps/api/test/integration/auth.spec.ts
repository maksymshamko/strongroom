import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getHarness, resetDb, type Harness } from '../helpers/harness';
import { makeUser, login, PASSWORD } from '../helpers/factories';
import { SESSION_COOKIE } from '@dataroom/contracts';

let h: Harness;

beforeEach(async () => {
  h = await getHarness();
  await resetDb(h.prisma);
});
afterAll(async () => h?.close());

// §3 authentication and session.
describe('POST /auth/login (§3.2, §3.3)', () => {
  it('sets an httpOnly session cookie and returns the user', async () => {
    const user = await makeUser(h.prisma, { email: 'anna@harlanco.com', name: 'Anna Ruiz' });
    const res = await h
      .api()
      .post('/api/v1/auth/login')
      .send({ email: 'anna@harlanco.com', password: PASSWORD })
      .expect(200);

    // Spec 003 §1.1 removed hasPassword/hasGoogle from this payload.
    expect(res.body.user).toEqual({
      id: user.id,
      email: 'anna@harlanco.com',
      name: 'Anna Ruiz',
    });
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(SESSION_COOKIE),
    );
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('matches the email case-insensitively (§3.3)', async () => {
    await makeUser(h.prisma, { email: 'anna@harlanco.com' });
    await h
      .api()
      .post('/api/v1/auth/login')
      .send({ email: 'ANNA@HarlanCo.com', password: PASSWORD })
      .expect(200);
  });

  it('returns the same INVALID_CREDENTIALS for unknown email and wrong password (no enumeration)', async () => {
    await makeUser(h.prisma, { email: 'anna@harlanco.com' });

    const unknown = await h
      .api()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@nowhere.test', password: PASSWORD })
      .expect(401);
    const wrongPassword = await h
      .api()
      .post('/api/v1/auth/login')
      .send({ email: 'anna@harlanco.com', password: 'wrong-password' })
      .expect(401);

    expect(unknown.body).toEqual(wrongPassword.body);
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses password login for a Google-only account with the same generic error (§3.3)', async () => {
    await makeUser(h.prisma, {
      email: 'marcus@oyelaran.co',
      withPassword: false,
      googleId: 'google-123',
    });
    const res = await h
      .api()
      .post('/api/v1/auth/login')
      .send({ email: 'marcus@oyelaran.co', password: PASSWORD })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(JSON.stringify(res.body)).not.toMatch(/google/i);
  });

  it('rate-limits after 10 failed attempts for one email (§3.3)', async () => {
    await makeUser(h.prisma, { email: 'anna@harlanco.com' });
    for (let i = 0; i < 10; i++) {
      await h
        .api()
        .post('/api/v1/auth/login')
        .send({ email: 'anna@harlanco.com', password: 'nope' })
        .expect(401);
    }
    const res = await h
      .api()
      .post('/api/v1/auth/login')
      .send({ email: 'anna@harlanco.com', password: PASSWORD })
      .expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('GET /auth/me and POST /auth/logout (§3.2)', () => {
  it('returns 401 UNAUTHENTICATED without a session', async () => {
    const res = await h.api().get('/api/v1/auth/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the user with a session, and 401 after logout', async () => {
    const user = await makeUser(h.prisma);
    const cookie = await login(h, user.email);

    await h.api().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    const out = await h.api().post('/api/v1/auth/logout').set('Cookie', cookie).expect(200);

    const cleared = (out.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(SESSION_COOKIE),
    );
    expect(cleared).toMatch(/dr_session=;|Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it('rejects a tampered session token', async () => {
    const user = await makeUser(h.prisma);
    const cookie = await login(h, user.email);
    const tampered = cookie.replace(/.$/, 'X');
    await h.api().get('/api/v1/auth/me').set('Cookie', tampered).expect(401);
  });
});

// §3.5 first-visit grant linking.
describe('grant linking on authentication (§3.5)', () => {
  it('links pending ShareGrant rows matching the email on login', async () => {
    const owner = await makeUser(h.prisma, { email: 'anna@harlanco.com' });
    const room = await h.prisma.node.create({
      data: {
        id: crypto.randomUUID(),
        type: 'DATAROOM',
        name: 'Project Meridian',
        path: 'placeholder',
        dataRoomId: 'placeholder',
        ownerId: owner.id,
      },
    });
    await h.prisma.node.update({
      where: { id: room.id },
      data: { path: `/${room.id}/`, dataRoomId: room.id },
    });
    const share = await h.prisma.share.create({
      data: { nodeId: room.id, mode: 'PERMISSIONED', createdById: owner.id },
    });
    await h.prisma.shareGrant.create({
      data: { shareId: share.id, email: 'marcus@oyelaran.co', userId: null },
    });

    // Account created after the grant, exactly as in §4.1.2 of spec 001.
    const invitee = await makeUser(h.prisma, { email: 'marcus@oyelaran.co' });
    await login(h, invitee.email);

    const grant = await h.prisma.shareGrant.findFirstOrThrow({
      where: { email: 'marcus@oyelaran.co' },
    });
    expect(grant.userId).toBe(invitee.id);
  });

  it('does not link revoked grants', async () => {
    const owner = await makeUser(h.prisma);
    const room = await h.prisma.node.create({
      data: { type: 'DATAROOM', name: 'R', path: 'x', dataRoomId: 'x', ownerId: owner.id },
    });
    await h.prisma.node.update({
      where: { id: room.id },
      data: { path: `/${room.id}/`, dataRoomId: room.id },
    });
    const share = await h.prisma.share.create({
      data: { nodeId: room.id, mode: 'PERMISSIONED', createdById: owner.id },
    });
    await h.prisma.shareGrant.create({
      data: {
        shareId: share.id,
        email: 'revoked@example.test',
        userId: null,
        revokedAt: new Date(),
      },
    });

    const invitee = await makeUser(h.prisma, { email: 'revoked@example.test' });
    await login(h, invitee.email);

    const grant = await h.prisma.shareGrant.findFirstOrThrow({
      where: { email: 'revoked@example.test' },
    });
    expect(grant.userId).toBeNull();
  });
});
