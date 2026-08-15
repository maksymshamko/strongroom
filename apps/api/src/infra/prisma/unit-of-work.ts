import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Repositories, UnitOfWork } from '../../application/ports/repositories';
import { PrismaService } from './prisma.service';
import { PrismaNodeRepository } from './node.repository';
import { PrismaUserRepository } from './user.repository';
import { PrismaShareRepository } from './share.repository';
import { PrismaUploadRepository } from './upload.repository';
import { PrismaOrphanRepository } from './orphan.repository';

/** The transaction-scoped Prisma handle. Never leaves `infra/`. */
export type Tx = Prisma.TransactionClient | PrismaService;

export function buildRepositories(tx: Tx): Repositories {
  return {
    nodes: new PrismaNodeRepository(tx),
    users: new PrismaUserRepository(tx),
    shares: new PrismaShareRepository(tx),
    uploads: new PrismaUploadRepository(tx),
    orphans: new PrismaOrphanRepository(tx),
  };
}

const SERIALIZATION_FAILURE = '40001';
const DEADLOCK = '40P01';
const MAX_ATTEMPTS = 3;

@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * §10.4 — mutations run Serializable so two concurrent uploads into one folder
   * cannot lose a size delta. Serialization failures are retried before they are
   * allowed to surface as a 500.
   */
  async run<T>(fn: (repos: Repositories) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => fn(buildRepositories(tx)),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
        );
      } catch (error) {
        if (!isRetryable(error) || attempt === MAX_ATTEMPTS) throw error;
        lastError = error;
        await sleep(10 * attempt);
      }
    }
    throw lastError;
  }

  /** Reads need no serializable transaction; they share the same port shape. */
  async read<T>(fn: (repos: Repositories) => Promise<T>): Promise<T> {
    return fn(buildRepositories(this.prisma));
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const code = (error.meta as { code?: string } | undefined)?.code;
    return code === SERIALIZATION_FAILURE || code === DEADLOCK || error.code === 'P2034';
  }
  const message = error instanceof Error ? error.message : '';
  return message.includes(SERIALIZATION_FAILURE) || message.includes(DEADLOCK);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
