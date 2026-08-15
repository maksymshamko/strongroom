import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

/**
 * §3.6 — the seeded demo account, so email/password login works without a
 * signup UI. Idempotent: re-running never duplicates the demo data room.
 */
const DEMO_EMAIL = 'demo@strongroom.test';
const DEMO_PASSWORD = 'demo-password-001';

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  const user = existing
    ? existing
    : await prisma.user.create({
        data: {
          email: DEMO_EMAIL,
          name: 'Demo User',
          passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
        },
      });

  // Only a freshly created user gets sample content — re-seeding an existing
  // account must not resurrect a data room the user deleted.
  if (!existing) {
    const roomId = randomUUID();
    await prisma.node.create({
      data: {
        id: roomId,
        type: 'DATAROOM',
        name: 'Demo Data Room',
        path: `/${roomId}/`,
        dataRoomId: roomId,
        ownerId: user.id,
        itemCount: 1,
      },
    });

    const folderId = randomUUID();
    await prisma.node.create({
      data: {
        id: folderId,
        parentId: roomId,
        type: 'FOLDER',
        name: '01 Corporate',
        path: `/${roomId}/${folderId}/`,
        dataRoomId: roomId,
        ownerId: user.id,
      },
    });
  }

  console.log(`Seeded demo user ${DEMO_EMAIL} (password: ${DEMO_PASSWORD})`);
  await prisma.$disconnect();
}

void main();
