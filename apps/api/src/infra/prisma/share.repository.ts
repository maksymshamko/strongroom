import type {
  Cursor,
  NodeRecord,
  ShareGrantRecord,
  ShareRecord,
  ShareRepository,
} from '../../application/ports/repositories';
import type { ShareFact } from '../../domain/access-decision';
import { toNodeRecord } from './mappers';
import type { Tx } from './unit-of-work';

const ACTIVE = { revokedAt: null } as const;

export class PrismaShareRepository implements ShareRepository {
  constructor(private readonly tx: Tx) {}

  /**
   * §5.3 — the viewer's entire active share set in one query. Prefix-testing
   * happens against these paths, so access never costs N ancestor lookups.
   */
  async activeSharesFor(viewer: { userId: string | null; token: string | null }): Promise<ShareFact[]> {
    if (!viewer.userId && !viewer.token) return [];

    const rows = await this.tx.share.findMany({
      where: {
        ...ACTIVE,
        OR: [
          ...(viewer.userId
            ? [
                {
                  mode: 'PERMISSIONED' as const,
                  grants: { some: { userId: viewer.userId, revokedAt: null } },
                },
              ]
            : []),
          ...(viewer.token
            ? [{ mode: 'PUBLIC_LINK' as const, token: viewer.token }]
            : []),
        ],
      },
      include: {
        node: { select: { path: true } },
        grants: { where: { revokedAt: null }, select: { userId: true } },
      },
    });

    return rows.map((row) => ({
      shareId: row.id,
      mode: row.mode,
      nodePath: row.node.path,
      grantUserIds: row.grants.map((g) => g.userId).filter((id): id is string => Boolean(id)),
      token: row.token,
    }));
  }

  async activeSharesOnPathChain(ancestorIds: string[]): Promise<(ShareRecord & { nodeName: string })[]> {
    const rows = await this.tx.share.findMany({
      where: { ...ACTIVE, nodeId: { in: ancestorIds } },
      include: { node: { select: { name: true, path: true } } },
    });
    // Deepest first, so "inherits from" names the nearest ancestor.
    return rows
      .sort((a, b) => b.node.path.length - a.node.path.length)
      .map((row) => ({ ...toShareRecord(row), nodeName: row.node.name }));
  }

  async findActiveLink(nodeId: string): Promise<ShareRecord | null> {
    const row = await this.tx.share.findFirst({
      where: { nodeId, mode: 'PUBLIC_LINK', ...ACTIVE },
    });
    return row ? toShareRecord(row) : null;
  }

  async findPermissionedShare(nodeId: string): Promise<ShareRecord | null> {
    const row = await this.tx.share.findFirst({
      where: { nodeId, mode: 'PERMISSIONED', ...ACTIVE },
    });
    return row ? toShareRecord(row) : null;
  }

  async findByToken(token: string): Promise<(ShareRecord & { nodePath: string }) | null> {
    const row = await this.tx.share.findUnique({
      where: { token },
      include: { node: { select: { path: true } } },
    });
    return row ? { ...toShareRecord(row), nodePath: row.node.path } : null;
  }

  async findById(id: string): Promise<ShareRecord | null> {
    const row = await this.tx.share.findUnique({ where: { id } });
    return row ? toShareRecord(row) : null;
  }

  async createShare(input: {
    id: string;
    nodeId: string;
    mode: 'PUBLIC_LINK' | 'PERMISSIONED';
    token: string | null;
    createdById: string;
  }): Promise<ShareRecord> {
    const row = await this.tx.share.create({ data: input });
    return toShareRecord(row);
  }

  async revokeShare(id: string, at: Date): Promise<void> {
    await this.tx.share.update({ where: { id }, data: { revokedAt: at } });
  }

  async grantsForShare(shareId: string): Promise<(ShareGrantRecord & { name: string | null })[]> {
    return this.grantsForShares([shareId]);
  }

  async grantsForShares(shareIds: string[]): Promise<(ShareGrantRecord & { name: string | null })[]> {
    if (shareIds.length === 0) return [];
    const rows = await this.tx.shareGrant.findMany({
      where: { shareId: { in: shareIds }, ...ACTIVE },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      shareId: row.shareId,
      email: row.email,
      userId: row.userId,
      role: 'VIEWER' as const,
      acceptedAt: row.acceptedAt,
      createdAt: row.createdAt,
      name: row.user?.name ?? null,
    }));
  }

  async createGrants(
    inputs: { id: string; shareId: string; email: string; userId: string | null }[],
  ): Promise<ShareGrantRecord[]> {
    const created: ShareGrantRecord[] = [];
    for (const input of inputs) {
      const row = await this.tx.shareGrant.create({ data: input });
      created.push({
        id: row.id,
        shareId: row.shareId,
        email: row.email,
        userId: row.userId,
        role: 'VIEWER',
        acceptedAt: row.acceptedAt,
        createdAt: row.createdAt,
      });
    }
    return created;
  }

  async findGrantById(id: string): Promise<(ShareGrantRecord & { nodeId: string }) | null> {
    const row = await this.tx.shareGrant.findUnique({
      where: { id },
      include: { share: { select: { nodeId: true } } },
    });
    if (!row) return null;
    return {
      id: row.id,
      shareId: row.shareId,
      email: row.email,
      userId: row.userId,
      role: 'VIEWER',
      acceptedAt: row.acceptedAt,
      createdAt: row.createdAt,
      nodeId: row.share.nodeId,
    };
  }

  async revokeGrant(id: string, at: Date): Promise<void> {
    await this.tx.shareGrant.update({ where: { id }, data: { revokedAt: at } });
  }

  async acceptGrantsFor(userId: string, shareIds: string[], at: Date): Promise<void> {
    if (shareIds.length === 0) return;
    await this.tx.shareGrant.updateMany({
      where: { userId, shareId: { in: shareIds }, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: at },
    });
  }

  async itemsSharedWith(
    userId: string,
    limit: number,
    cursor: Cursor | null,
  ): Promise<{ node: NodeRecord; shareId: string; sharedByEmail: string; sharedAt: Date }[]> {
    const rows = await this.tx.shareGrant.findMany({
      where: {
        userId,
        ...ACTIVE,
        share: { ...ACTIVE, node: { ownerId: { not: userId } } },
      },
      include: {
        share: {
          include: {
            createdBy: { select: { email: true } },
            node: { include: { owner: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    });

    return rows.map((row) => ({
      node: toNodeRecord(row.share.node),
      shareId: row.shareId,
      sharedByEmail: row.share.createdBy.email,
      sharedAt: row.createdAt,
    }));
  }

  async activeSharesInSubtree(pathPrefix: string) {
    const rows = await this.tx.share.findMany({
      where: { ...ACTIVE, node: { path: { startsWith: pathPrefix } } },
      include: {
        grants: {
          where: { revokedAt: null },
          include: { user: { select: { name: true } } },
        },
      },
    });
    return rows.map((row) => ({
      shareId: row.id,
      mode: row.mode,
      emails: row.grants.map((g) => ({ email: g.email, name: g.user?.name ?? null })),
    }));
  }

  async logAccess(input: {
    shareId: string;
    nodeId: string | null;
    viewerUserId: string | null;
    anonId: string | null;
  }): Promise<void> {
    await this.tx.shareAccessLog.create({ data: input });
  }

  /**
   * spec 003 §2.2 step 5 — the rows are removed, not revoked. ShareGrant and
   * ShareAccessLog cascade with them (002 §2.1).
   */
  async deleteSharesInSubtree(pathPrefix: string): Promise<void> {
    await this.tx.share.deleteMany({ where: { node: { path: { startsWith: pathPrefix } } } });
  }

  /** §8.6 — distinct people holding access to anything this owner owns. */
  async countCollaborators(ownerId: string): Promise<number> {
    const rows = await this.tx.shareGrant.findMany({
      where: { ...ACTIVE, share: { ...ACTIVE, node: { ownerId } } },
      select: { email: true },
      distinct: ['email'],
    });
    return rows.length;
  }
}

function toShareRecord(row: {
  id: string;
  nodeId: string;
  mode: string;
  token: string | null;
  createdById: string;
  createdAt: Date;
  revokedAt: Date | null;
}): ShareRecord {
  return {
    id: row.id,
    nodeId: row.nodeId,
    mode: row.mode as 'PUBLIC_LINK' | 'PERMISSIONED',
    token: row.token,
    createdById: row.createdById,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}
