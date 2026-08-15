import type { NodeType } from '../../domain/node-type';
import type { ShareFact } from '../../domain/access-decision';

/** Row shapes are domain-shaped, not Prisma-shaped (§1.3). */
export type NodeRecord = {
  id: string;
  parentId: string | null;
  type: NodeType;
  name: string;
  path: string;
  dataRoomId: string;
  size: bigint;
  itemCount: number;
  mimeType: string | null;
  ownerId: string;
  ownerName: string;
  createdAt: Date;
  updatedAt: Date;
  // spec 003 §2.1 — set on a trashed node itself, never on its descendants.
  deletedAt: Date | null;
  previousParentId: string | null;
  previousName: string | null;
  deletedFromLabel: string | null;
};

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  googleId: string | null;
};

export type FileVersionRecord = {
  id: string;
  nodeId: string;
  storageKey: string;
  size: bigint;
  mimeType: string;
  checksum: string | null;
  versionNumber: number;
  createdAt: Date;
  createdById: string;
  createdByName: string;
};

export type PendingUploadRecord = {
  id: string;
  parentId: string;
  name: string;
  declaredSize: bigint;
  declaredMimeType: string;
  storageKey: string;
  createdById: string;
  expiresAt: Date;
};

export type ShareRecord = {
  id: string;
  nodeId: string;
  mode: 'PUBLIC_LINK' | 'PERMISSIONED';
  token: string | null;
  createdById: string;
  createdAt: Date;
  revokedAt: Date | null;
};

export type ShareGrantRecord = {
  id: string;
  shareId: string;
  email: string;
  userId: string | null;
  role: 'VIEWER';
  acceptedAt: Date | null;
  createdAt: Date;
};

/** §4.3 — the sort tuple, decoded from the request cursor. */
export type Cursor = { typeRank: number; sortKey: string; id: string };

export type ListOptions = {
  limit: number;
  cursor: Cursor | null;
  sort: 'name' | 'size' | 'updatedAt' | 'deletedAt';
  dir: 'asc' | 'desc';
  /**
   * spec 003 §2.8 — when true, rows with `deletedAt` set are excluded. Because
   * §2.1 stamps the whole deleted subtree, this one predicate hides a deleted
   * folder and everything inside it without locating the owner's Trash.
   */
  excludeDeleted?: boolean;
  /** The inverse: only trashed rows. Used by the Trash listing itself. */
  onlyDeleted?: boolean;
};

export type SearchFilters = {
  q?: string;
  types?: NodeType[];
  mimeTypes?: string[];
  minSize?: number;
  maxSize?: number;
  createdFrom?: Date;
  createdTo?: Date;
  updatedFrom?: Date;
  updatedTo?: Date;
};

export type SubtreeTotals = { files: number; folders: number; size: bigint };

/** Trash bookkeeping is never set at creation — only by setTrashState (§2.2). */
export type NodeCreateInput = Omit<
  NodeRecord,
  | 'ownerName'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
  | 'previousParentId'
  | 'previousName'
  | 'deletedFromLabel'
>;

export interface NodeRepository {
  findById(id: string): Promise<NodeRecord | null>;
  findByIds(ids: string[]): Promise<NodeRecord[]>;
  /** Root-first ancestor chain, inclusive of the node itself. */
  ancestorChain(node: NodeRecord): Promise<NodeRecord[]>;
  childNames(parentId: string): Promise<Set<string>>;
  findChildByName(parentId: string, name: string): Promise<NodeRecord | null>;

  listChildren(parentId: string, opts: ListOptions): Promise<NodeRecord[]>;
  listDataRooms(ownerId: string, opts: ListOptions): Promise<NodeRecord[]>;
  searchSubtree(pathPrefix: string, filters: SearchFilters, opts: ListOptions): Promise<NodeRecord[]>;

  create(record: NodeCreateInput): Promise<NodeRecord>;
  rename(id: string, name: string): Promise<NodeRecord>;
  /** Moves the node and rewrites every descendant path in one statement (§2.2 rule 4). */
  reparent(node: NodeRecord, newParent: NodeRecord, newPath: string, newName: string): Promise<NodeRecord>;
  delete(id: string): Promise<void>;
  setLatestVersionMeta(id: string, size: bigint, mimeType: string): Promise<void>;

  /** §2.3 — applies one delta to every ancestor and bumps their updatedAt. */
  applyRollup(ancestorIds: string[], sizeDelta: bigint, countDelta: number): Promise<void>;

  subtreeTotals(pathPrefix: string): Promise<SubtreeTotals>;
  /** §6.3 — depth of the deepest node in the subtree, for move validation. */
  subtreeMaxDepth(pathPrefix: string): Promise<number>;
  subtreeStorageKeys(pathPrefix: string): Promise<string[]>;
  ownedDataRoomIds(ownerId: string): Promise<string[]>;

  // ---- spec 003 §2 ----------------------------------------------------
  /** The caller's TRASH root, or null before their first delete. */
  findTrashRoot(ownerId: string): Promise<NodeRecord | null>;
  /** Direct children of TRASH — the independently restorable items (§2.5). */
  listTrashItems(trashId: string, opts: ListOptions): Promise<NodeRecord[]>;
  /**
   * §2.1 — the restore markers, set on the deleted subtree's root only.
   */
  setTrashState(
    id: string,
    state: {
      previousParentId: string | null;
      previousName: string | null;
      deletedFromLabel: string | null;
    },
  ): Promise<void>;
  /** §2.1 — stamps (or clears) `deletedAt` across a whole subtree in one UPDATE. */
  setSubtreeDeletedAt(pathPrefix: string, deletedAt: Date | null): Promise<void>;
  /**
   * §2.7 — expired *roots* only: `deletedAt` past the cutoff **and**
   * `previousParentId` set. Descendants carry the stamp too but go with their
   * root, never on their own.
   */
  expiredTrashedNodes(before: Date, limit: number): Promise<NodeRecord[]>;
}

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findByGoogleId(googleId: string): Promise<UserRecord | null>;
  findManyByEmail(emails: string[]): Promise<UserRecord[]>;
  create(input: { email: string; name: string; passwordHash: string | null; googleId: string | null }): Promise<UserRecord>;
  setPasswordHash(id: string, hash: string): Promise<void>;
  setGoogleId(id: string, googleId: string): Promise<void>;
  /** spec 003 §1.5 */
  clearGoogleId(id: string): Promise<void>;
  delete(id: string): Promise<void>;

  /** §3.5 — idempotent linking of pre-account grants. */
  linkPendingGrants(userId: string, email: string): Promise<void>;

  countFailedLogins(email: string, since: Date): Promise<number>;
  recordFailedLogin(email: string): Promise<void>;
  clearFailedLogins(email: string): Promise<void>;
}

export interface ShareRepository {
  /** §5.3 — every active share visible to this viewer, as decision facts. */
  activeSharesFor(viewer: { userId: string | null; token: string | null }): Promise<ShareFact[]>;
  activeSharesOnPathChain(ancestorIds: string[]): Promise<(ShareRecord & { nodeName: string })[]>;
  findActiveLink(nodeId: string): Promise<ShareRecord | null>;
  findByToken(token: string): Promise<(ShareRecord & { nodePath: string }) | null>;
  findById(id: string): Promise<ShareRecord | null>;
  findPermissionedShare(nodeId: string): Promise<ShareRecord | null>;

  createShare(input: { id: string; nodeId: string; mode: 'PUBLIC_LINK' | 'PERMISSIONED'; token: string | null; createdById: string }): Promise<ShareRecord>;
  revokeShare(id: string, at: Date): Promise<void>;

  grantsForShare(shareId: string): Promise<(ShareGrantRecord & { name: string | null })[]>;
  grantsForShares(shareIds: string[]): Promise<(ShareGrantRecord & { name: string | null })[]>;
  createGrants(inputs: { id: string; shareId: string; email: string; userId: string | null }[]): Promise<ShareGrantRecord[]>;
  findGrantById(id: string): Promise<(ShareGrantRecord & { nodeId: string }) | null>;
  revokeGrant(id: string, at: Date): Promise<void>;
  acceptGrantsFor(userId: string, shareIds: string[], at: Date): Promise<void>;

  /** §8.1 shared-with-me. */
  itemsSharedWith(userId: string, limit: number, cursor: Cursor | null): Promise<{ node: NodeRecord; shareId: string; sharedByEmail: string; sharedAt: Date }[]>;

  /** §8.1 delete-preview share impact — active shares anywhere in a subtree. */
  activeSharesInSubtree(pathPrefix: string): Promise<{ shareId: string; mode: 'PUBLIC_LINK' | 'PERMISSIONED'; emails: { email: string; name: string | null }[] }[]>;

  logAccess(input: { shareId: string; nodeId: string | null; viewerUserId: string | null; anonId: string | null }): Promise<void>;

  /** spec 003 §2.2 step 5 — deletes rows outright; sharing does not survive deletion. */
  deleteSharesInSubtree(pathPrefix: string): Promise<void>;

  countCollaborators(ownerId: string): Promise<number>;
}

export interface UploadRepository {
  create(record: PendingUploadRecord): Promise<PendingUploadRecord>;
  findById(id: string): Promise<PendingUploadRecord | null>;
  delete(id: string): Promise<void>;
  nextVersionNumber(nodeId: string): Promise<number>;
  latestVersion(nodeId: string): Promise<FileVersionRecord | null>;
  versionByNumber(nodeId: string, versionNumber: number): Promise<FileVersionRecord | null>;
  listVersions(nodeId: string): Promise<FileVersionRecord[]>;
  createVersion(input: { id: string; nodeId: string; storageKey: string; size: bigint; mimeType: string; checksum: string | null; versionNumber: number; createdById: string }): Promise<FileVersionRecord>;
  moveVersion(versionId: string, toNodeId: string, versionNumber: number): Promise<void>;
  deleteVersions(nodeId: string): Promise<string[]>;
  deleteVersionsExcept(nodeId: string, keepVersionId: string): Promise<string[]>;
}

export interface OrphanRepository {
  /** §10.3 — a failed storage delete is recorded, never lost. */
  record(keys: string[], error: string): Promise<void>;
  pending(limit: number): Promise<{ id: string; storageKey: string }[]>;
  clear(ids: string[]): Promise<void>;
}

/** Every repository, scoped to one transaction (§10.4). */
export type Repositories = {
  nodes: NodeRepository;
  users: UserRepository;
  shares: ShareRepository;
  uploads: UploadRepository;
  orphans: OrphanRepository;
};

/**
 * §10.4 — the transaction boundary. Use cases receive port-typed repositories,
 * never a driver transaction handle, so `application/` stays Prisma-free.
 */
export interface UnitOfWork {
  run<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
  /** Read-only work that needs no serializable transaction. */
  read<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
}
