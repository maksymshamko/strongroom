import { TRASH_TTL_DAYS } from '@dataroom/contracts';
import { DomainError } from '../domain/errors';
import { NodePath } from '../domain/node-path';
import { suggestFreeName } from '../domain/conflict-resolver';
import { rollupDelta } from '../domain/rollup-delta';
import type { Viewer } from './access.service';
import { checkConflict, conflictError, type Resolution } from './conflict';
import type { Clock, IdGenerator } from './ports/services';
import type {
  Cursor,
  NodeRecord,
  Repositories,
  UnitOfWork,
} from './ports/repositories';
import type { StorageCleanup } from './storage-cleanup';

const TRASH_NAME = 'Trash';
const DASHBOARD_LABEL = 'Data rooms';

/**
 * spec 003 §2 — Trash.
 *
 * Deletion is a move into a per-user TRASH root rather than a destruction, and
 * the TTL sweep is what eventually destroys. Restore (§2.6) is the same move run
 * backwards, which is why both reuse the reparent/rollup machinery instead of
 * owning a second copy of it.
 */
export class TrashService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly cleanup: StorageCleanup,
  ) {}

  // §2.2 — called by NodeService.delete once it has authorized the write.
  async moveToTrash(repos: Repositories, target: NodeRecord): Promise<void> {
    const trash = await this.ensureTrashRoot(repos, target.ownerId);

    if (target.id === trash.id) {
      throw DomainError.validation('The trash itself cannot be deleted');
    }

    const oldPath = NodePath.parse(target.path);
    const chain = await repos.nodes.ancestorChain(target);
    // Resolved now, because these ancestors may themselves be trashed or purged
    // before the user ever looks at their Trash (§2.4).
    const deletedFromLabel =
      target.type === 'DATAROOM'
        ? DASHBOARD_LABEL
        : chain
            .slice(0, -1)
            .map((n) => n.name)
            .join(' / ') || DASHBOARD_LABEL;

    // §2.3 — the user did not choose this destination, so a collision here is
    // resolved silently rather than raised as their conflict.
    const siblings = await repos.nodes.childNames(trash.id);
    const trashName = suggestFreeName(target.name, siblings, target.type);

    const newPath = NodePath.parse(trash.path).child(target.id);
    await repos.nodes.reparent(target, trash, newPath.value, trashName);

    // §2.1 — the whole subtree is deleted, so the whole subtree carries the
    // stamp; only the root carries the markers that make it restorable.
    await repos.nodes.setSubtreeDeletedAt(newPath.value, this.clock.now());
    await repos.nodes.setTrashState(target.id, {
      previousParentId: target.parentId,
      previousName: target.name,
      deletedFromLabel,
    });

    const delta = this.subtreeDelta(target);
    await repos.nodes.applyRollup(oldPath.ancestorIds, delta.remove.sizeDelta, delta.remove.countDelta);
    await repos.nodes.applyRollup([trash.id], delta.add.sizeDelta, delta.add.countDelta);

    // §2.2 step 5 — destroyed, not revoked. Sharing does not survive deletion in
    // any form, and restore must not quietly bring it back.
    await repos.shares.deleteSharesInSubtree(newPath.value);
  }

  // §2.6
  async restore(viewer: Viewer, nodeId: string, onConflict?: Resolution): Promise<NodeRecord> {
    const userId = this.requireUser(viewer);

    return this.uow.run(async (repos) => {
      const trash = await repos.nodes.findTrashRoot(userId);
      const target = await repos.nodes.findById(nodeId);

      // Only a direct child of the caller's own trash is independently
      // restorable; anything deeper travelled inside a deleted folder (§2.6).
      if (!trash || !target || target.parentId !== trash.id || target.deletedAt === null) {
        throw DomainError.notFound('Trashed item');
      }

      const destination = target.previousParentId
        ? await repos.nodes.findById(target.previousParentId)
        : null;

      // Nothing is ever silently relocated: if the origin is gone or itself
      // trashed, the user restores the parent first and tries again (§2.6).
      if (!destination || this.isTrashed(destination, trash)) {
        throw new DomainError(
          'RESTORE_TARGET_MISSING',
          `“${target.deletedFromLabel ?? 'The original folder'}” no longer exists. Restore it first, then restore this item.`,
          { previousParentId: target.previousParentId },
        );
      }

      const desiredName = target.previousName ?? target.name;
      const check = await checkConflict(
        repos.nodes,
        destination.id,
        desiredName,
        target.type,
        onConflict,
        target.id,
      );
      if (check.kind === 'BLOCKED') throw conflictError(check);
      if (check.kind === 'RESOLVED' && check.resolution !== 'KEEP_BOTH') {
        throw DomainError.validation(
          'A restored item cannot be merged into another item; choose keep-both instead',
        );
      }

      const newPath = NodePath.parse(destination.path).child(target.id);

      const restored = await repos.nodes.reparent(target, destination, newPath.value, check.name);

      // §2.6 step 3 — the mirror of the delete: clear the stamp across the
      // subtree, and the restore markers on the root.
      await repos.nodes.setSubtreeDeletedAt(newPath.value, null);
      await repos.nodes.setTrashState(target.id, {
        previousParentId: null,
        previousName: null,
        deletedFromLabel: null,
      });

      const delta = this.subtreeDelta(target);
      await repos.nodes.applyRollup([trash.id], delta.remove.sizeDelta, delta.remove.countDelta);
      await repos.nodes.applyRollup(newPath.ancestorIds, delta.add.sizeDelta, delta.add.countDelta);

      // §2.6 step 5 — sharing is not restored. The rows were destroyed at delete.
      return restored;
    });
  }

  // §2.5
  async list(
    viewer: Viewer,
    opts: { limit: number; cursor: Cursor | null },
  ): Promise<{ node: NodeRecord | null; items: NodeRecord[]; hasMore: boolean }> {
    const userId = this.requireUser(viewer);

    return this.uow.read(async (repos) => {
      const trash = await repos.nodes.findTrashRoot(userId);
      if (!trash) return { node: null, items: [], hasMore: false };

      const rows = await repos.nodes.listTrashItems(trash.id, {
        limit: opts.limit + 1,
        cursor: opts.cursor,
        sort: 'deletedAt',
        dir: 'desc',
      });
      const hasMore = rows.length > opts.limit;
      return { node: trash, items: hasMore ? rows.slice(0, opts.limit) : rows, hasMore };
    });
  }

  /**
   * §2.7 — the TTL is what actually deletes. Candidates are selected first and
   * removed one transaction at a time, so a second runner simply finds nothing:
   * the row being gone is the claim.
   */
  async purgeExpired(limit = 100): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - TRASH_TTL_DAYS * 24 * 60 * 60 * 1000);

    const expired = await this.uow.read(async (repos) =>
      repos.nodes.expiredTrashedNodes(cutoff, limit),
    );

    let purged = 0;
    for (const node of expired) {
      if (await this.purgeEntry(node.id)) purged += 1;
    }
    return purged;
  }

  /** §2.7 — permanently delete one Trash entry, before its TTL. No undo. */
  async purgeOne(viewer: Viewer, nodeId: string): Promise<void> {
    const userId = this.requireUser(viewer);

    await this.uow.read(async (repos) => {
      const trash = await repos.nodes.findTrashRoot(userId);
      const target = await repos.nodes.findById(nodeId);
      // Same rule as restore (§2.6): only a live entry in the caller's own
      // Trash, never a passenger inside a deleted folder.
      if (!trash || !target || target.parentId !== trash.id || target.deletedAt === null) {
        throw DomainError.notFound('Trashed item');
      }
    });

    await this.purgeEntry(nodeId);
  }

  /** §2.7 — empty the whole Trash. Emptying nothing is a success, not a 404. */
  async empty(viewer: Viewer): Promise<void> {
    const userId = this.requireUser(viewer);

    for (;;) {
      const batch = await this.uow.read(async (repos) => {
        const trash = await repos.nodes.findTrashRoot(userId);
        if (!trash) return [];
        return repos.nodes.listTrashItems(trash.id, {
          limit: 100,
          cursor: null,
          sort: 'deletedAt',
          dir: 'desc',
        });
      });

      if (batch.length === 0) return;
      for (const node of batch) await this.purgeEntry(node.id);
    }
  }

  /**
   * The single destroy path, shared by the TTL sweep and both on-demand routes,
   * so early purging and expiry can never diverge.
   */
  private async purgeEntry(nodeId: string): Promise<boolean> {
    const keys = await this.uow.run(async (repos) => {
      const current = await repos.nodes.findById(nodeId);
      if (!current || current.deletedAt === null) return null;

      const storageKeys = await repos.nodes.subtreeStorageKeys(current.path);
      const delta = this.subtreeDelta(current);

      await repos.nodes.delete(current.id);
      if (current.parentId) {
        await repos.nodes.applyRollup(
          [current.parentId],
          delta.remove.sizeDelta,
          delta.remove.countDelta,
        );
      }
      return storageKeys;
    });

    if (keys === null) return false;
    // §10.2 — DB first, storage after.
    await this.cleanup.purge(keys);
    return true;
  }

  // ---- internals -------------------------------------------------------

  /**
   * §2.1 — created lazily on the first delete. The partial unique index on
   * (ownerId) where type = TRASH is the real guarantee; this is the fast path.
   */
  private async ensureTrashRoot(repos: Repositories, ownerId: string): Promise<NodeRecord> {
    const existing = await repos.nodes.findTrashRoot(ownerId);
    if (existing) return existing;

    const id = this.ids.next();
    return repos.nodes.create({
      id,
      parentId: null,
      type: 'TRASH',
      name: TRASH_NAME,
      path: NodePath.root(id).value,
      dataRoomId: id,
      size: 0n,
      itemCount: 0,
      mimeType: null,
      ownerId,
    });
  }

  /** A node moving as a unit costs one ancestor chain what it gives another. */
  private subtreeDelta(node: NodeRecord) {
    const itemCount = node.type === 'FILE' ? 0 : node.itemCount;
    return {
      remove: rollupDelta({ kind: 'REMOVE_SUBTREE', size: node.size, itemCount }),
      add: rollupDelta({ kind: 'ADD_SUBTREE', size: node.size, itemCount }),
    };
  }

  private isTrashed(node: NodeRecord, trash: NodeRecord): boolean {
    return node.path.startsWith(trash.path);
  }

  private requireUser(viewer: Viewer): string {
    if (!viewer.userId) throw new DomainError('UNAUTHENTICATED', 'Sign in required');
    return viewer.userId;
  }
}
