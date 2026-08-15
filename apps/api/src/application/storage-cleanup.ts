import type { FileStorage } from './ports/file-storage';
import type { UnitOfWork } from './ports/repositories';

/**
 * §10.2 — storage deletion always runs *after* the DB transaction commits.
 *
 * An orphaned object is a cost leak; a FileVersion row pointing at a deleted
 * object is a broken product. So the DB is the thing that must commit first, and
 * a failed purge is recorded (§10.3) rather than retried inline or swallowed.
 */
export class StorageCleanup {
  constructor(
    private readonly storage: FileStorage,
    private readonly uow: UnitOfWork,
  ) {}

  async purge(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.storage.deleteObjects(keys);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.uow.read(({ orphans }) => orphans.record(keys, message));
    }
  }

  /** §10.3 — manual sweep; exposed as an admin script, not a scheduled job. */
  async sweepOrphans(limit = 100): Promise<number> {
    const pending = await this.uow.read(({ orphans }) => orphans.pending(limit));
    if (pending.length === 0) return 0;
    try {
      await this.storage.deleteObjects(pending.map((p) => p.storageKey));
      await this.uow.read(({ orphans }) => orphans.clear(pending.map((p) => p.id)));
      return pending.length;
    } catch {
      return 0;
    }
  }
}
