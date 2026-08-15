import { SHARE_TOKEN_BYTES } from '@dataroom/contracts';
import { DomainError } from '../domain/errors';
import { NodePath } from '../domain/node-path';
import { AccessService, type Viewer } from './access.service';
import type { Mailer } from './ports/mailer';
import type { Clock, IdGenerator, TokenIssuer } from './ports/services';
import type {
  Cursor,
  ListOptions,
  NodeRecord,
  Repositories,
  ShareGrantRecord,
  UnitOfWork,
} from './ports/repositories';

export type ShareState = {
  link: { shareId: string; token: string; createdAt: Date } | null;
  grants: (ShareGrantRecord & { name: string | null })[];
  inheritedFrom: { nodeId: string; name: string } | null;
};

export class ShareService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly access: AccessService,
    private readonly ids: IdGenerator,
    private readonly tokens: TokenIssuer,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly webUrl: string,
  ) {}

  // §8.3 GET /nodes/{id}/shares
  async state(viewer: Viewer, nodeId: string): Promise<ShareState> {
    return this.uow.read(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const node = await this.requireNode(repos, nodeId);
      this.access.assertWrite(node, facts, shares);

      const chain = NodePath.parse(node.path).ids;
      const onChain = await repos.shares.activeSharesOnPathChain(chain);

      const link = onChain.find((s) => s.mode === 'PUBLIC_LINK' && s.nodeId === node.id) ?? null;
      const permissioned = onChain.filter((s) => s.mode === 'PERMISSIONED');
      const grants = await repos.shares.grantsForShares(permissioned.map((s) => s.id));

      // §8.3 — "Access inherits from X" when the grant sits on an ancestor.
      const ancestorShare = permissioned.find((s) => s.nodeId !== node.id);
      return {
        link: link ? { shareId: link.id, token: link.token!, createdAt: link.createdAt } : null,
        grants,
        inheritedFrom: ancestorShare
          ? { nodeId: ancestorShare.nodeId, name: ancestorShare.nodeName }
          : null,
      };
    });
  }

  // §8.3 POST /nodes/{id}/shares/link — idempotent while a link is active.
  async createLink(viewer: Viewer, nodeId: string) {
    return this.uow.run(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const node = await this.requireNode(repos, nodeId);
      this.access.assertWrite(node, facts, shares);

      const existing = await repos.shares.findActiveLink(node.id);
      if (existing) {
        return { shareId: existing.id, token: existing.token!, url: this.linkUrl(existing.token!) };
      }

      const token = this.tokens.randomToken(SHARE_TOKEN_BYTES);
      const created = await repos.shares.createShare({
        id: this.ids.next(),
        nodeId: node.id,
        mode: 'PUBLIC_LINK',
        token,
        createdById: facts.userId!,
      });
      return { shareId: created.id, token, url: this.linkUrl(token) };
    });
  }

  // §8.3 POST /nodes/{id}/shares/people
  async addPeople(viewer: Viewer, nodeId: string, emails: string[]) {
    const { grants, invites } = await this.uow.run(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const node = await this.requireNode(repos, nodeId);
      this.access.assertWrite(node, facts, shares);

      const share =
        (await repos.shares.findPermissionedShare(node.id)) ??
        (await repos.shares.createShare({
          id: this.ids.next(),
          nodeId: node.id,
          mode: 'PERMISSIONED',
          token: null,
          createdById: facts.userId!,
        }));

      const normalized = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
      const already = new Set(
        (await repos.shares.grantsForShare(share.id)).map((g) => g.email),
      );
      const fresh = normalized.filter((e) => !already.has(e));

      const accounts = new Map(
        (await repos.users.findManyByEmail(fresh)).map((u) => [u.email, u]),
      );

      const created = await repos.shares.createGrants(
        fresh.map((email) => ({
          id: this.ids.next(),
          shareId: share.id,
          email,
          userId: accounts.get(email)?.id ?? null,
        })),
      );

      const inviter = facts.userId ? await repos.users.findById(facts.userId) : null;
      return {
        grants: await repos.shares.grantsForShare(share.id),
        // Email is sent after the transaction — a mail failure must not roll
        // back the grant, which is the actual source of truth for access (§9).
        invites: created.map((grant) => ({
          to: grant.email,
          inviterName: inviter?.name ?? 'Someone',
          nodeName: node.name,
          recipientHasAccount: accounts.has(grant.email),
          link: accounts.has(grant.email)
            ? `${this.webUrl}/n/${node.id}`
            : `${this.webUrl}/login?next=${encodeURIComponent(`/n/${node.id}`)}`,
        })),
      };
    });

    for (const invite of invites) {
      try {
        await this.mailer.sendShareInvite(invite);
      } catch {
        // Best-effort by design (§9): the grant already exists and grants access.
      }
    }

    return grants;
  }

  // §8.3 DELETE /shares/{id}
  async revokeShare(viewer: Viewer, shareId: string): Promise<void> {
    await this.uow.run(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const share = await repos.shares.findById(shareId);
      if (!share) throw DomainError.notFound('Share');
      const node = await this.requireNode(repos, share.nodeId);
      this.access.assertWrite(node, facts, shares);

      await repos.shares.revokeShare(shareId, this.clock.now());
    });
  }

  // §8.3 DELETE /share-grants/{id}
  async revokeGrant(viewer: Viewer, grantId: string): Promise<void> {
    await this.uow.run(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const grant = await repos.shares.findGrantById(grantId);
      if (!grant) throw DomainError.notFound('Grant');
      const node = await this.requireNode(repos, grant.nodeId);
      this.access.assertWrite(node, facts, shares);

      await repos.shares.revokeGrant(grantId, this.clock.now());
    });
  }

  // §8.1 GET /shared-with-me
  async sharedWithMe(viewer: Viewer, limit: number, cursor: Cursor | null) {
    if (!viewer.userId) throw new DomainError('UNAUTHENTICATED', 'Sign in required');
    return this.uow.read(async (repos) => {
      const rows = await repos.shares.itemsSharedWith(viewer.userId!, limit + 1, cursor);
      const hasMore = rows.length > limit;
      return { items: hasMore ? rows.slice(0, limit) : rows, hasMore };
    });
  }

  // §8.4 public link resolution
  async resolvePublic(token: string, nodeId: string | null, viewer: Viewer) {
    const resolved = await this.uow.read(async (repos) => {
      const share = await repos.shares.findByToken(token);
      // A revoked or unknown token is indistinguishable from one that never
      // existed — the viewer sees "no longer available" either way.
      if (!share || share.revokedAt !== null) throw DomainError.notFound('Share');

      const node = nodeId
        ? await repos.nodes.findById(nodeId)
        : await repos.nodes.findById(share.nodeId);
      if (!node) throw DomainError.notFound('Node');

      // §5.6 — the token only reaches the shared node's subtree.
      if (!node.path.startsWith(share.nodePath)) throw DomainError.notFound('Node');

      const chain = await repos.nodes.ancestorChain(node);
      const sharedIndex = chain.findIndex((n) => n.id === share.nodeId);
      return {
        share,
        node,
        breadcrumb: chain.slice(sharedIndex === -1 ? chain.length : sharedIndex),
      };
    });

    await this.logAccess(resolved.share.id, resolved.node.id, viewer);
    return resolved;
  }

  async listPublicChildren(token: string, nodeId: string, viewer: Viewer, opts: ListOptions) {
    const { node } = await this.resolvePublic(token, nodeId, viewer);
    return this.uow.read(async (repos) => {
      const rows = await repos.nodes.listChildren(node.id, {
        ...opts,
        limit: opts.limit + 1,
        excludeDeleted: true,
      });
      const hasMore = rows.length > opts.limit;
      return { items: hasMore ? rows.slice(0, opts.limit) : rows, hasMore };
    });
  }

  async logAccess(shareId: string, nodeId: string | null, viewer: Viewer): Promise<void> {
    await this.uow.read(async (repos) =>
      repos.shares.logAccess({
        shareId,
        nodeId,
        viewerUserId: viewer.userId,
        // An authenticated viewer is logged by identity; only anonymous ones
        // fall back to the cookie id (§8.4).
        anonId: viewer.userId ? null : viewer.anonId,
      }),
    );
  }

  private linkUrl(token: string): string {
    return `${this.webUrl}/s/${token}`;
  }

  private async requireNode(repos: Repositories, id: string): Promise<NodeRecord> {
    const node = await repos.nodes.findById(id);
    if (!node) throw DomainError.notFound('Node');
    return node;
  }
}
