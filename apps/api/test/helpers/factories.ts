import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import type { Harness } from './harness';

export const PASSWORD = 'correct-horse-battery';

export async function makeUser(
  prisma: PrismaClient,
  over: { email?: string; name?: string; withPassword?: boolean; googleId?: string } = {},
) {
  const email = (over.email ?? `user-${crypto.randomUUID()}@example.test`).toLowerCase();
  return prisma.user.create({
    data: {
      email,
      name: over.name ?? 'Test User',
      passwordHash: over.withPassword === false ? null : await bcrypt.hash(PASSWORD, 4),
      googleId: over.googleId ?? null,
    },
  });
}

/** Logs in and returns the session cookie string for use with `.set('Cookie', …)`. */
export async function login(h: Harness, email: string, password = PASSWORD): Promise<string> {
  const res = await h.api().post('/api/v1/auth/login').send({ email, password }).expect(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

export async function makeUserAndLogin(h: Harness, over: Parameters<typeof makeUser>[1] = {}) {
  const user = await makeUser(h.prisma, over);
  const cookie = await login(h, user.email);
  return { user, cookie };
}

export async function createDataRoom(h: Harness, cookie: string, name: string) {
  const res = await h.api().post('/api/v1/data-rooms').set('Cookie', cookie).send({ name }).expect(201);
  return res.body as { id: string; name: string; dataRoomId: string };
}

export async function createFolder(h: Harness, cookie: string, parentId: string, name: string) {
  const res = await h
    .api()
    .post('/api/v1/nodes/folders')
    .set('Cookie', cookie)
    .send({ parentId, name })
    .expect(201);
  return res.body as { id: string; name: string };
}

/**
 * Full §7.1 upload handshake against the in-memory storage adapter:
 * init → PUT bytes into the fake bucket → complete.
 */
export async function uploadFile(
  h: Harness,
  cookie: string,
  parentId: string,
  name: string,
  opts: { bytes?: Buffer; mimeType?: string; onConflict?: string } = {},
) {
  const bytes = opts.bytes ?? Buffer.from('%PDF-1.7 fake pdf body');
  const mimeType = opts.mimeType ?? 'application/pdf';

  const init = await h
    .api()
    .post('/api/v1/uploads/init')
    .set('Cookie', cookie)
    .send({ parentId, name, size: bytes.length, mimeType })
    .expect(201);

  h.storage.put(init.body.storageKey, bytes, mimeType);

  const complete = await h
    .api()
    .post(`/api/v1/uploads/${init.body.uploadId}/complete`)
    .set('Cookie', cookie)
    .send(opts.onConflict ? { onConflict: opts.onConflict } : {});

  return { init: init.body, complete };
}

/**
 * Stamps an already-uploaded file with a mime type the allow-list no longer
 * accepts. The upload allow-list is PDF-only (§7.2), but rooms filled before
 * that narrowing still hold spreadsheets and images, and reading, searching
 * and filtering them must keep working.
 */
export async function relabelFile(h: Harness, nodeId: string, mimeType: string): Promise<void> {
  await h.prisma.node.update({ where: { id: nodeId }, data: { mimeType } });
  await h.prisma.fileVersion.updateMany({ where: { nodeId }, data: { mimeType } });
}
