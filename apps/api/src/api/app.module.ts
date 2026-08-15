import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AccessService } from '../application/access.service';
import { AccountService } from '../application/account.service';
import { AuthService } from '../application/auth.service';
import { NodeService } from '../application/node.service';
import { SearchService } from '../application/search.service';
import { ShareService } from '../application/share.service';
import { StorageCleanup } from '../application/storage-cleanup';
import { UploadService } from '../application/upload.service';
import { TrashService } from '../application/trash.service';
import type { FileStorage } from '../application/ports/file-storage';
import type { Mailer } from '../application/ports/mailer';
import type { Clock, IdGenerator, PasswordHasher, TokenIssuer } from '../application/ports/services';
import type { UnitOfWork } from '../application/ports/repositories';
import {
  CLOCK,
  FILE_STORAGE,
  ID_GENERATOR,
  MAILER,
  PASSWORD_HASHER,
  TOKEN_ISSUER,
  UNIT_OF_WORK,
} from '../application/ports/tokens';

import { PrismaService } from '../infra/prisma/prisma.service';
import { PrismaUnitOfWork } from '../infra/prisma/unit-of-work';
import { LocalFileStorage } from '../infra/storage/local-file-storage';
import { SupabaseFileStorage } from '../infra/storage/supabase-file-storage';
import { InMemoryMailer } from '../infra/mail/in-memory-mailer';
import { ResendMailer } from '../infra/mail/resend-mailer';
import {
  BcryptPasswordHasher,
  JwtTokenIssuer,
  SystemClock,
  UuidGenerator,
} from '../infra/services';

import { AuthController } from './auth.controller';
import { NodesController } from './nodes.controller';
import { UploadsController } from './uploads.controller';
import { PublicSharesController, SharesController } from './shares.controller';
import { AccountController } from './account.controller';
import { TrashController } from './trash.controller';
import { TrashPurgeScheduler } from './trash-purge.scheduler';
import { DevStorageController } from './dev-storage.controller';
import { HealthController } from './health.controller';
import { AuthGuard } from './auth/viewer';
import { SessionService } from './auth/session.service';
import { GoogleOAuth } from './auth/google-oauth';
import { WEB_URL } from './tokens';

/**
 * The composition root (§1.3): the only place that knows both a port and its
 * adapter. Swapping Supabase for another store, or Resend for another provider,
 * is a change to one factory here.
 */
@Module({
  controllers: [
    AuthController,
    NodesController,
    UploadsController,
    SharesController,
    PublicSharesController,
    AccountController,
    TrashController,
    DevStorageController,
    HealthController,
  ],
  providers: [
    PrismaService,
    SessionService,
    GoogleOAuth,
    { provide: APP_GUARD, useClass: AuthGuard },

    { provide: WEB_URL, useFactory: () => process.env.WEB_URL ?? 'http://localhost:3000' },
    { provide: UNIT_OF_WORK, useClass: PrismaUnitOfWork },
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidGenerator },
    { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher },
    {
      provide: TOKEN_ISSUER,
      useFactory: () => new JwtTokenIssuer(requireEnv('JWT_SECRET')),
    },
    {
      // Falls back to the in-memory adapter when Supabase is unconfigured, so a
      // fresh clone runs end to end without cloud credentials.
      provide: FILE_STORAGE,
      useFactory: (): FileStorage => {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !key) {
          const apiBase = process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}/api/v1`;
          return new LocalFileStorage(apiBase);
        }
        return new SupabaseFileStorage(url, key, process.env.SUPABASE_BUCKET ?? 'dataroom');
      },
    },
    {
      provide: MAILER,
      useFactory: (): Mailer => {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) return new InMemoryMailer();
        return new ResendMailer(apiKey, process.env.MAIL_FROM ?? 'Strongroom <noreply@example.com>');
      },
    },

    { provide: AccessService, useFactory: () => new AccessService() },
    {
      provide: StorageCleanup,
      useFactory: (storage: FileStorage, uow: UnitOfWork) => new StorageCleanup(storage, uow),
      inject: [FILE_STORAGE, UNIT_OF_WORK],
    },
    {
      provide: AuthService,
      useFactory: (uow: UnitOfWork, hasher: PasswordHasher, tokens: TokenIssuer, clock: Clock) =>
        new AuthService(uow, hasher, tokens, clock),
      inject: [UNIT_OF_WORK, PASSWORD_HASHER, TOKEN_ISSUER, CLOCK],
    },
    {
      provide: TrashService,
      useFactory: (uow: UnitOfWork, ids: IdGenerator, clock: Clock, cleanup: StorageCleanup) =>
        new TrashService(uow, ids, clock, cleanup),
      inject: [UNIT_OF_WORK, ID_GENERATOR, CLOCK, StorageCleanup],
    },
    TrashPurgeScheduler,
    {
      provide: NodeService,
      useFactory: (
        uow: UnitOfWork,
        access: AccessService,
        ids: IdGenerator,
        clock: Clock,
        cleanup: StorageCleanup,
        trash: TrashService,
      ) => new NodeService(uow, access, ids, clock, cleanup, trash),
      inject: [UNIT_OF_WORK, AccessService, ID_GENERATOR, CLOCK, StorageCleanup, TrashService],
    },
    {
      provide: UploadService,
      useFactory: (
        uow: UnitOfWork,
        access: AccessService,
        storage: FileStorage,
        ids: IdGenerator,
        clock: Clock,
        cleanup: StorageCleanup,
      ) => new UploadService(uow, access, storage, ids, clock, cleanup),
      inject: [UNIT_OF_WORK, AccessService, FILE_STORAGE, ID_GENERATOR, CLOCK, StorageCleanup],
    },
    {
      provide: ShareService,
      useFactory: (
        uow: UnitOfWork,
        access: AccessService,
        ids: IdGenerator,
        tokens: TokenIssuer,
        clock: Clock,
        mailer: Mailer,
        webUrl: string,
      ) => new ShareService(uow, access, ids, tokens, clock, mailer, webUrl),
      inject: [UNIT_OF_WORK, AccessService, ID_GENERATOR, TOKEN_ISSUER, CLOCK, MAILER, WEB_URL],
    },
    {
      provide: SearchService,
      useFactory: (uow: UnitOfWork, access: AccessService) => new SearchService(uow, access),
      inject: [UNIT_OF_WORK, AccessService],
    },
    {
      provide: AccountService,
      useFactory: (uow: UnitOfWork, hasher: PasswordHasher, cleanup: StorageCleanup) =>
        new AccountService(uow, hasher, cleanup),
      inject: [UNIT_OF_WORK, PASSWORD_HASHER, StorageCleanup],
    },
  ],
})
export class AppModule {}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
