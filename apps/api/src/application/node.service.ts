import { DomainError } from '../domain/errors';
import { NodeName } from '../domain/node-name';
import { MAX_DEPTH, NodePath } from '../domain/node-path';
import { canHaveChildren } from '../domain/node-type';
import { rollupDelta } from '../domain/rollup-delta';
import { AccessService, type Viewer } from './access.service';
import { checkConflict, conflictError, type Resolution } from './conflict';
import type { Clock, IdGenerator } from './ports/services';
import type {
  Cursor,
  ListOptions,
  NodeRecord,
  Repositories,
  UnitOfWork,
} from './ports/repositories';
import type { StorageCleanup } from './storage-cleanup';
import type { TrashService } from './trash.service';

export type ListResult = { items: NodeRecord[]; hasMore: boolean };

export class NodeService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly access: AccessService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly cleanup: StorageCleanup,
    private readonly trash: TrashService,
  ) {}

  // §8.1 POST /data-rooms
  async createDataRoom(viewer: Viewer, rawName: string): Promise<NodeRecord> {
    const name = NodeName.create(rawName);
    const ownerId = this.requireUser(viewer);

    return this.uow.run(async (repos) => {
      const id = this.ids.next();
      return repos.nodes.create({
        id,
        parentId: null,
        type: 'DATAROOM',
        name: name.value,
        path: NodePath.root(id).value,
        dataRoomId: id,
        size: 0n,
        itemCount: 0,
        mimeType: null,
        ownerId,
      });
    });
  }

  // §8.1 POST /nodes/folders
  async createFolder(
    viewer: Viewer,
    parentId: string,
    rawName: string,
    onConflict?: Resolution,
  ): Promise<NodeRecord> {
    const name = NodeName.create(rawName);

    return this.uow.run(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const parent = await this.requireNode(repos, parentId);
      this.access.assertWrite(parent, facts, shares);

      if (!canHaveChildren(parent.type)) {
        throw DomainError.invalidMove('A file cannot contain other items');
      }

      const check = await checkConflict(repos.nodes, parentId, name.value, 'FOLDER', onConflict);
      if (check.kind === 'BLOCKED') throw conflictError(check);
      if (check.kind === 'RESOLVED' && check.resolution !== 'KEEP_BOTH') {
        // Guarded in checkConflict, but stated here so the rule is local.
        throw DomainError.validation('A folder cannot be added as a version of another item');
      }

      const id = this.ids.next();
      // .child() enforces MAX_DEPTH (§6.3).
      const path = NodePath.parse(parent.path).child(id);

      const created = await repos.nodes.create({
        id,
        parentId: parent.id,
        type: 'FOLDER',
        name: check.name,
        path: path.value,
        dataRoomId: parent.dataRoomId,
        size: 0n,
        itemCount: 0,
        mimeType: null,
        ownerId: parent.ownerId,
      });

      const delta = rollupDelta({ kind: 'ADD_FOLDER' });
      await repos.nodes.applyRollup(path.ancestorIds, delta.sizeDelta, delta.countDelta);
      return created;
    });
  }

  // §8.1 GET /nodes/{id}
  async getNode(
    viewer: Viewer,
    nodeId: string,
  ): Promise<{ node: NodeRecord; breadcrumb: NodeRecord[]; canWrite: boolean }> {
    return this.uow.read(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const node = await this.requireNode(repos, nodeId);
      this.assertNotTrashed(node);
      const decision = this.access.decide(node, facts, shares);
      if (!decision.canRead) throw DomainError.notFound('Node');

      const chain = await repos.nodes.ancestorChain(node);
      const start = this.access.breadcrumbStart(chain, facts, shares);
      return { node, breadcrumb: chain.slice(start), canWrite: decision.canWrite };
    });
  }

  // §8.1 GET /nodes/{id}/children
  async listChildren(viewer: Viewer, nodeId: string, opts: ListOptions): Promise<ListResult> {
    return this.uow.read(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const node = await this.requireNode(repos, nodeId);
      this.assertNotTrashed(node);
      this.access.assertRead(node, facts, shares);

      const rows = await repos.nodes.listChildren(nodeId, {
        ...opts,
        limit: opts.limit + 1,
        excludeDeleted: true,
      });
      return this.page(rows, opts.limit);
    });
  }

  // §8.1 GET /data-rooms
  async listDataRooms(viewer: Viewer, opts: ListOptions): Promise<ListResult> {
    const ownerId = this.requireUser(viewer);
    return this.uow.read(async (repos) => {
      // §2.8 — a deleted data room belongs in Trash, not on the dashboard.
      const rows = await repos.nodes.listDataRooms(ownerId, {
        ...opts,
        limit: opts.limit + 1,
        excludeDeleted: true,
      });
      return this.page(rows, opts.limit);
    });
  }

  // §8.1 PATCH /nodes/{id}
  async rename(
    viewer: Viewer,
    nodeId: string,
    rawName: string,
    onConflict?: Resolution,
  ): Promise<NodeRecord> {
    const name = NodeName.create(rawName);

    const { node, purge } = await this.uow.run(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const target = await this.requireNode(repos, nodeId);
      this.access.assertWrite(target, facts, shares);

      if (target.parentId === null) {
        // A data room has no siblings to collide with; rename is unconditional.
        const renamed = await repos.nodes.rename(target.id, name.value);
        return { node: renamed, purge: [] as string[] };
      }

      const check = await checkConflict(
        repos.nodes,
        target.parentId,
        name.value,
        target.type,
        onConflict,
        target.id,
      );
      if (check.kind === 'BLOCKED') throw conflictError(check);

      if (check.kind === 'RESOLVED' && check.resolution !== 'KEEP_BOTH') {
        const outcome = await this.transplant(repos, target, check.existing, check.resolution);
        return { node: outcome.node, purge: outcome.purge };
      }

      const renamed = await repos.nodes.rename(target.id, check.name);
      // Zero delta, but still applied — it bumps ancestor updatedAt (§2.3).
      const delta = rollupDelta({ kind: 'RENAME' });
      await repos.nodes.applyRollup(
        NodePath.parse(target.path).ancestorIds,
        delta.sizeDelta,
        delta.countDelta,
      );
      return { node: renamed, purge: [] as string[] };
    });

    await this.cleanup.purge(purge);
    return node;
  }

  // §8.1 POST /nodes/{id}/move
  async move(
    viewer: Viewer,
    nodeId: string,
    newParentId: string,
    onConflict?: Resolution,
  ): Promise<NodeRecord> {
    const { node, purge } = await this.uow.run(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const target = await this.requireNode(repos, nodeId);
      const destination = await this.requireNode(repos, newParentId);
      this.access.assertWrite(target, facts, shares);
      this.access.assertWrite(destination, facts, shares);

      this.assertMovable(target, destination);

      const check = await checkConflict(
        repos.nodes,
        destination.id,
        target.name,
        target.type,
        onConflict,
        target.id,
      );
      if (check.kind === 'BLOCKED') throw conflictError(check);

      if (check.kind === 'RESOLVED' && check.resolution !== 'KEEP_BOTH') {
        const outcome = await this.transplant(repos, target, check.existing, check.resolution);
        return { node: outcome.node, purge: outcome.purge };
      }

      const oldPath = NodePath.parse(target.path);
      const newPath = NodePath.parse(destination.path).child(target.id);
      // The deepest descendant decides whether the whole subtree still fits (§6.3).
      await this.assertSubtreeFits(repos, target, newPath);

      const moved = await repos.nodes.reparent(target, destination, newPath.value, check.name);

      const subtreeItems = target.type === 'FILE' ? 0 : target.itemCount;
      const loss = rollupDelta({
        kind: 'REMOVE_SUBTREE',
        size: target.size,
        itemCount: subtreeItems,
      });
      const gain = rollupDelta({
        kind: 'ADD_SUBTREE',
        size: target.size,
        itemCount: subtreeItems,
      });
      // Common ancestors receive both deltas and net to zero, which is why an
      // internal move leaves the data room totals unchanged (plan §3.6).
      await repos.nodes.applyRollup(oldPath.ancestorIds, loss.sizeDelta, loss.countDelta);
      await repos.nodes.applyRollup(newPath.ancestorIds, gain.sizeDelta, gain.countDelta);

      return { node: moved, purge: [] as string[] };
    });

    await this.cleanup.purge(purge);
    return node;
  }

  /**
   * §8.1 DELETE /nodes/{id} — spec 003 §2.2 turned this into a move into the
   * owner's Trash. Nothing is destroyed here; the TTL sweep does that.
   */
  async delete(viewer: Viewer, nodeId: string): Promise<void> {
    await this.uow.run(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const target = await this.requireNode(repos, nodeId);
      // Only the owner can write, and no share confers write — so only the owner
      // can delete, and an item only ever reaches its own owner's Trash.
      this.access.assertWrite(target, facts, shares);

      await this.trash.moveToTrash(repos, target);
    });
  }

  // §8.1 GET /nodes/{id}/delete-preview
  async deletePreview(viewer: Viewer, nodeId: string) {
    return this.uow.read(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const target = await this.requireNode(repos, nodeId);
      this.access.assertWrite(target, facts, shares);

      // `subtreeTotals` counts strictly below the node, which is right for a
      // container but leaves a file reporting "0 files · 0 B" about itself.
      // What the dialog needs is what disappears, and for a file that is the
      // file (§11.3).
      const totals = canHaveChildren(target.type)
        ? await repos.nodes.subtreeTotals(target.path)
        : { files: 1, folders: 0, size: target.size };
      const active = await repos.shares.activeSharesInSubtree(target.path);

      const people = new Map<string, { email: string; name: string | null }>();
      let activeLinkCount = 0;
      for (const share of active) {
        if (share.mode === 'PUBLIC_LINK') activeLinkCount += 1;
        for (const person of share.emails) people.set(person.email, person);
      }
      const everyone = [...people.values()].sort((a, b) => a.email.localeCompare(b.email));

      return {
        node: target,
        contents: totals,
        shareImpact: {
          peopleCount: everyone.length,
          activeLinkCount,
          // The dialog shows four avatars plus an overflow count (design §6.2).
          people: everyone.slice(0, 4),
        },
      };
    });
  }

  // ---- internals -------------------------------------------------------

  private page(rows: NodeRecord[], limit: number): ListResult {
    const hasMore = rows.length > limit;
    return { items: hasMore ? rows.slice(0, limit) : rows, hasMore };
  }

  private requireUser(viewer: Viewer): string {
    if (!viewer.userId) throw new DomainError('UNAUTHENTICATED', 'Sign in required');
    return viewer.userId;
  }

  private async requireNode(repos: Repositories, id: string): Promise<NodeRecord> {
    const node = await repos.nodes.findById(id);
    if (!node) throw DomainError.notFound('Node');
    return node;
  }

  /**
   * spec 003 §2.8 — a trashed node is reachable only through /trash. Because the
   * stamp covers the whole subtree (§2.1), this is a local check: a file inside a
   * deleted folder answers for itself, with no lookup. Reported as absent rather
   * than forbidden, like anything else the caller may not see (002 §5.4).
   */
  private assertNotTrashed(node: NodeRecord): void {
    if (node.type === 'TRASH' || node.deletedAt !== null) {
      throw DomainError.notFound('Node');
    }
  }

  /** §6.3 structural rules for a move. */
  private assertMovable(target: NodeRecord, destination: NodeRecord): void {
    if (target.type === 'DATAROOM') {
      throw DomainError.invalidMove('A data room cannot be moved');
    }
    if (!canHaveChildren(destination.type)) {
      throw DomainError.invalidMove('A file cannot contain other items');
    }
    if (target.id === destination.id) {
      throw DomainError.invalidMove('An item cannot be moved into itself');
    }
    const targetPath = NodePath.parse(target.path);
    if (targetPath.contains(NodePath.parse(destination.path))) {
      throw DomainError.invalidMove('An item cannot be moved into its own descendant');
    }
    // §15.2 — cross-room moves are deferred, not decided, so they are refused.
    if (target.dataRoomId !== destination.dataRoomId) {
      throw DomainError.invalidMove('Items cannot be moved between data rooms');
    }
  }

  /**
   * §6.3 — the deepest descendant decides whether the moved subtree still fits.
   * Asking the database for one number beats walking the subtree in memory.
   */
  private async assertSubtreeFits(
    repos: Repositories,
    target: NodeRecord,
    newPath: NodePath,
  ): Promise<void> {
    if (target.type === 'FILE') return;

    const currentMaxDepth = await repos.nodes.subtreeMaxDepth(target.path);
    const subtreeHeight = currentMaxDepth - NodePath.parse(target.path).depth;
    if (newPath.depth + subtreeHeight > MAX_DEPTH) {
      throw DomainError.invalidMove(`Folder nesting may not exceed ${MAX_DEPTH} levels`);
    }
  }

  /**
   * §6.4 NEW_VERSION / REPLACE for rename and move: A's content transplants into
   * B, then A is deleted. A's older versions are discarded either way.
   */
  private async transplant(
    repos: Repositories,
    source: NodeRecord,
    target: NodeRecord,
    resolution: Exclude<Resolution, 'KEEP_BOTH'>,
  ): Promise<{ node: NodeRecord; purge: string[] }> {
    const latest = await repos.uploads.latestVersion(source.id);
    if (!latest) throw DomainError.validation('The item being moved has no content to transplant');

    const purge: string[] = [];

    // A's prior history is discarded, not merged (§6.4).
    purge.push(...(await repos.uploads.deleteVersionsExcept(source.id, latest.id)));

    let nextVersion: number;
    if (resolution === 'REPLACE') {
      purge.push(...(await repos.uploads.deleteVersions(target.id)));
      nextVersion = 1;
    } else {
      nextVersion = await repos.uploads.nextVersionNumber(target.id);
    }

    const oldTargetSize = target.size;
    await repos.uploads.moveVersion(latest.id, target.id, nextVersion);
    await repos.nodes.setLatestVersionMeta(target.id, latest.size, latest.mimeType);

    // Removing A costs its ancestors one item and its size…
    const sourcePath = NodePath.parse(source.path);
    const removal = rollupDelta({ kind: 'REMOVE_FILE', size: source.size });
    await repos.nodes.delete(source.id);
    await repos.nodes.applyRollup(sourcePath.ancestorIds, removal.sizeDelta, removal.countDelta);

    // …and B's ancestors only see a size change, since B already existed (§2.3).
    const targetPath = NodePath.parse(target.path);
    const resize = rollupDelta({
      kind: 'REPLACE_LATEST_VERSION',
      oldSize: oldTargetSize,
      newSize: latest.size,
    });
    await repos.nodes.applyRollup(targetPath.ancestorIds, resize.sizeDelta, resize.countDelta);

    const updated = await repos.nodes.findById(target.id);
    if (!updated) throw DomainError.notFound('Node');
    return { node: updated, purge };
  }
}

export type { Cursor };
