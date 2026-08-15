import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/api/app.module';
import { FILE_STORAGE, MAILER } from '../../src/application/ports/tokens';
import { InMemoryFileStorage } from '../../src/infra/storage/in-memory-file-storage';
import { InMemoryMailer } from '../../src/infra/mail/in-memory-mailer';
import { bootstrapApp } from '../../src/api/bootstrap';
import { SESSION_COOKIE } from '@dataroom/contracts';

export type Harness = {
  app: INestApplication;
  prisma: PrismaClient;
  storage: InMemoryFileStorage;
  mailer: InMemoryMailer;
  api: () => ReturnType<typeof request>;
  /** Mints a session cookie directly — for accounts that cannot use password login (§8.6). */
  issueSessionFor: (userId: string) => Promise<string>;
  close: () => Promise<void>;
};

let shared: Harness | null = null;

export async function getHarness(): Promise<Harness> {
  if (shared) return shared;

  const storage = new InMemoryFileStorage();
  const mailer = new InMemoryMailer();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FILE_STORAGE)
    .useValue(storage)
    .overrideProvider(MAILER)
    .useValue(mailer)
    .compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  bootstrapApp(app);
  await app.init();

  const prisma = new PrismaClient();
  await prisma.$connect();

  const harness: Harness = {
    app,
    prisma,
    storage,
    mailer,
    api: () => request(app.getHttpServer()),
    issueSessionFor: async (userId: string) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const { SessionService } = await import('../../src/api/auth/session.service');
      const token = app.get(SessionService).sign({ sub: user.id, email: user.email });
      return `${SESSION_COOKIE}=${token}`;
    },
    close: async () => {
      await prisma.$disconnect();
      await app.close();
      shared = null;
    },
  };
  shared = harness;
  return harness;
}

/** Truncates every table between tests. Order-independent via CASCADE. */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "ShareAccessLog", "ShareGrant", "Share", "FileVersion",
                   "PendingUpload", "Node", "OrphanedObject", "LoginAttempt", "User"
    RESTART IDENTITY CASCADE
  `);
}
