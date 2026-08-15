import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES, UPLOAD_URL_TTL_SECONDS, DOWNLOAD_URL_TTL_SECONDS } from '@dataroom/contracts';
import { DomainError } from '../domain/errors';
import { NodeName } from '../domain/node-name';
import { NodePath } from '../domain/node-path';
import { canHaveChildren } from '../domain/node-type';
import { rollupDelta } from '../domain/rollup-delta';
import { AccessService, type Viewer } from './access.service';
import { checkConflict, conflictError, type Resolution } from './conflict';
import type { FileStorage } from './ports/file-storage';
import type { Clock, IdGenerator } from './ports/services';
import type { FileVersionRecord, NodeRecord, Repositories, UnitOfWork } from './ports/repositories';
import type { StorageCleanup } from './storage-cleanup';

const ALLOWED = new Set<string>(ALLOWED_MIME_TYPES);

export class UploadService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly access: AccessService,
    private readonly storage: FileStorage,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly cleanup: StorageCleanup,
  ) {}

  // §7.1 step 1 / §8.2
  async init(
    viewer: Viewer,
    input: { parentId: string; name: string; size: bigint; mimeType: string },
  ) {
    const name = NodeName.create(input.name);

    if (input.size > MAX_FILE_BYTES) {
      throw new DomainError('PAYLOAD_TOO_LARGE', 'File exceeds the 5 GB limit');
    }
    if (!ALLOWED.has(input.mimeType)) {
      throw new DomainError(
        'UNSUPPORTED_MEDIA_TYPE',
        `Only PDF files can be uploaded — "${input.mimeType}" is not accepted`,
      );
    }

    const prepared = await this.uow.run(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const parent = await this.requireNode(repos, input.parentId);
      this.access.assertWrite(parent, facts, shares);
      if (!canHaveChildren(parent.type)) {
        throw DomainError.invalidMove('A file cannot contain other items');
      }
      // Depth is checked now rather than at complete, so the client is not asked
      // to spend bandwidth on an upload that can never land.
      NodePath.parse(parent.path).child(this.ids.next());

      // §7.3 — advisory only; `complete` re-checks authoritatively.
      const check = await checkConflict(repos.nodes, parent.id, name.value, 'FILE', undefined);

      const record = await repos.uploads.create({
        id: this.ids.next(),
        parentId: parent.id,
        name: name.value,
        declaredSize: input.size,
        declaredMimeType: input.mimeType,
        storageKey: this.ids.next(),
        createdById: facts.userId!,
        expiresAt: new Date(this.clock.now().getTime() + UPLOAD_URL_TTL_SECONDS * 1000),
      });

      return {
        record,
        conflict:
          check.kind === 'BLOCKED'
            ? {
                conflictingNodeId: check.existing.id,
                suggestedName: check.suggestedName,
                versioningAvailable: check.versioningAvailable,
              }
            : undefined,
      };
    });

    const signed = await this.storage.createSignedUploadUrl(
      prepared.record.storageKey,
      prepared.record.declaredMimeType,
      Number(MAX_FILE_BYTES),
      UPLOAD_URL_TTL_SECONDS,
    );

    return {
      uploadId: prepared.record.id,
      storageKey: prepared.record.storageKey,
      signedUrl: signed.url,
      expiresAt: signed.expiresAt,
      conflict: prepared.conflict,
    };
  }

  // §7.1 step 3 / §7.4 / §7.5
  async complete(
    viewer: Viewer,
    uploadId: string,
    input: { checksum?: string; onConflict?: Resolution },
  ): Promise<NodeRecord> {
    const userId = this.requireUser(viewer);

    const pending = await this.uow.read(async (repos) => repos.uploads.findById(uploadId));
    // A pending row that belongs to someone else is reported as absent — the
    // caller has no business knowing it exists (§5.4).
    if (!pending || pending.createdById !== userId) throw DomainError.notFound('Upload');

    // §7.4 — the client's claim is never trusted on its own.
    const stat = await this.storage.statObject(pending.storageKey);
    const mismatch =
      stat === null ||
      BigInt(stat.size) !== pending.declaredSize ||
      stat.contentType !== pending.declaredMimeType;

    if (mismatch) {
      await this.uow.run(async (repos) => repos.uploads.delete(pending.id));
      await this.cleanup.purge([pending.storageKey]);
      throw new DomainError(
        'UPLOAD_VERIFICATION_FAILED',
        'The uploaded file does not match what was declared',
      );
    }

    const { node, purge } = await this.uow.run(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const parent = await this.requireNode(repos, pending.parentId);
      this.access.assertWrite(parent, facts, shares);

      const check = await checkConflict(
        repos.nodes,
        parent.id,
        pending.name,
        'FILE',
        input.onConflict,
      );
      if (check.kind === 'BLOCKED') {
        // Nothing is written; the pending row survives so the client can retry
        // with a resolution without re-uploading the bytes.
        throw conflictError(check);
      }

      await repos.uploads.delete(pending.id);

      if (check.kind === 'RESOLVED' && check.resolution !== 'KEEP_BOTH') {
        return this.addVersionTo(repos, check.existing, pending, userId, check.resolution, input.checksum);
      }
      return this.createFileNode(repos, parent, check.name, pending, userId, input.checksum);
    });

    await this.cleanup.purge(purge);
    return node;
  }

  // §8.2 abort
  async abort(viewer: Viewer, uploadId: string): Promise<void> {
    const userId = this.requireUser(viewer);
    const pending = await this.uow.read(async (repos) => repos.uploads.findById(uploadId));
    if (!pending || pending.createdById !== userId) throw DomainError.notFound('Upload');

    await this.uow.run(async (repos) => repos.uploads.delete(pending.id));
    await this.cleanup.purge([pending.storageKey]);
  }

  // §7.6 / §8.1
  async contentUrl(
    viewer: Viewer,
    nodeId: string,
    opts: { version?: number; download?: boolean },
  ) {
    const { node, version } = await this.uow.read(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const target = await this.requireNode(repos, nodeId);
      // spec 003 §2.8 — content of a trashed file is not served either.
      if (target.deletedAt !== null) throw DomainError.notFound('Node');
      this.access.assertRead(target, facts, shares);
      if (target.type !== 'FILE') throw DomainError.validation('Only files have content');

      const found = opts.version
        ? await repos.uploads.versionByNumber(target.id, opts.version)
        : await repos.uploads.latestVersion(target.id);
      if (!found) throw DomainError.notFound('Version');
      return { node: target, version: found };
    });

    const signed = await this.storage.createSignedDownloadUrl(version.storageKey, {
      ttlSeconds: DOWNLOAD_URL_TTL_SECONDS,
      filename: node.name,
      disposition: opts.download ? 'attachment' : 'inline',
    });

    return {
      url: signed.url,
      expiresAt: signed.expiresAt,
      filename: node.name,
      mimeType: version.mimeType,
    };
  }

  // §8.1 GET /nodes/{id}/versions
  async listVersions(viewer: Viewer, nodeId: string): Promise<FileVersionRecord[]> {
    return this.uow.read(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const target = await this.requireNode(repos, nodeId);
      if (target.deletedAt !== null) throw DomainError.notFound('Node');
      this.access.assertRead(target, facts, shares);
      return repos.uploads.listVersions(target.id);
    });
  }

  // ---- internals -------------------------------------------------------

  private async createFileNode(
    repos: Repositories,
    parent: NodeRecord,
    name: string,
    pending: { id: string; storageKey: string; declaredSize: bigint; declaredMimeType: string },
    userId: string,
    checksum?: string,
  ): Promise<{ node: NodeRecord; purge: string[] }> {
    const id = this.ids.next();
    const path = NodePath.parse(parent.path).child(id);

    const node = await repos.nodes.create({
      id,
      parentId: parent.id,
      type: 'FILE',
      name,
      path: path.value,
      dataRoomId: parent.dataRoomId,
      size: pending.declaredSize,
      itemCount: 0,
      mimeType: pending.declaredMimeType,
      ownerId: parent.ownerId,
    });

    await repos.uploads.createVersion({
      id: this.ids.next(),
      nodeId: id,
      storageKey: pending.storageKey,
      size: pending.declaredSize,
      mimeType: pending.declaredMimeType,
      checksum: checksum ?? null,
      versionNumber: 1,
      createdById: userId,
    });

    const delta = rollupDelta({ kind: 'ADD_FILE', size: pending.declaredSize });
    await repos.nodes.applyRollup(path.ancestorIds, delta.sizeDelta, delta.countDelta);
    return { node, purge: [] };
  }

  /** §6.4 NEW_VERSION / REPLACE for an upload landing on an existing file. */
  private async addVersionTo(
    repos: Repositories,
    existing: NodeRecord,
    pending: { storageKey: string; declaredSize: bigint; declaredMimeType: string },
    userId: string,
    resolution: Exclude<Resolution, 'KEEP_BOTH'>,
    checksum?: string,
  ): Promise<{ node: NodeRecord; purge: string[] }> {
    const purge: string[] = [];
    let versionNumber: number;

    if (resolution === 'REPLACE') {
      purge.push(...(await repos.uploads.deleteVersions(existing.id)));
      versionNumber = 1;
    } else {
      versionNumber = await repos.uploads.nextVersionNumber(existing.id);
    }

    await repos.uploads.createVersion({
      id: this.ids.next(),
      nodeId: existing.id,
      storageKey: pending.storageKey,
      size: pending.declaredSize,
      mimeType: pending.declaredMimeType,
      checksum: checksum ?? null,
      versionNumber,
      createdById: userId,
    });

    await repos.nodes.setLatestVersionMeta(
      existing.id,
      pending.declaredSize,
      pending.declaredMimeType,
    );

    // Only the size moves — the node already counted as one item (§2.3).
    const delta = rollupDelta({
      kind: 'REPLACE_LATEST_VERSION',
      oldSize: existing.size,
      newSize: pending.declaredSize,
    });
    await repos.nodes.applyRollup(
      NodePath.parse(existing.path).ancestorIds,
      delta.sizeDelta,
      delta.countDelta,
    );

    const updated = await repos.nodes.findById(existing.id);
    if (!updated) throw DomainError.notFound('Node');
    return { node: updated, purge };
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
}
