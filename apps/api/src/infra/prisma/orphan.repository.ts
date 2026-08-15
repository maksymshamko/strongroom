import type { OrphanRepository } from '../../application/ports/repositories';
import type { Tx } from './unit-of-work';

/** §10.3 — a failed storage delete is recorded so nothing is lost silently. */
export class PrismaOrphanRepository implements OrphanRepository {
  constructor(private readonly tx: Tx) {}

  async record(keys: string[], error: string): Promise<void> {
    if (keys.length === 0) return;
    await this.tx.orphanedObject.createMany({
      data: keys.map((storageKey) => ({ storageKey, lastError: error.slice(0, 500) })),
    });
  }

  async pending(limit: number): Promise<{ id: string; storageKey: string }[]> {
    return this.tx.orphanedObject.findMany({
      take: limit,
      orderBy: { failedAt: 'asc' },
      select: { id: true, storageKey: true },
    });
  }

  async clear(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.tx.orphanedObject.deleteMany({ where: { id: { in: ids } } });
  }
}
