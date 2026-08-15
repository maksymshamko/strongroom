import {
  decideAccess,
  visibleBreadcrumbStart,
  type Decision,
  type ShareFact,
  type ViewerFact,
} from '../domain/access-decision';
import { DomainError } from '../domain/errors';
import type { NodeRecord, Repositories } from './ports/repositories';

export type Viewer = {
  userId: string | null;
  token: string | null;
  anonId: string | null;
};

export type ResolvedViewer = ViewerFact & { anonId: string | null };

/**
 * §5 — turns a request's viewer into the facts the domain decision needs, then
 * applies §5.4's rule about which failure the caller is allowed to observe.
 */
export class AccessService {
  async resolve(repos: Repositories, viewer: Viewer): Promise<{ facts: ResolvedViewer; shares: ShareFact[] }> {
    const ownedDataRoomIds = viewer.userId
      ? await repos.nodes.ownedDataRoomIds(viewer.userId)
      : [];
    const shares = await repos.shares.activeSharesFor({
      userId: viewer.userId,
      token: viewer.token,
    });
    return {
      facts: {
        userId: viewer.userId,
        ownedDataRoomIds,
        token: viewer.token,
        anonId: viewer.anonId,
      },
      shares,
    };
  }

  decide(node: NodeRecord, facts: ViewerFact, shares: readonly ShareFact[]): Decision {
    return decideAccess(
      { path: node.path, dataRoomId: node.dataRoomId, ownerId: node.ownerId },
      facts,
      shares,
    );
  }

  /**
   * §5.4 — an unreadable node is reported as absent, so existence never leaks;
   * a readable node the viewer may not mutate is reported as forbidden.
   */
  assertRead(node: NodeRecord, facts: ViewerFact, shares: readonly ShareFact[]): void {
    if (!this.decide(node, facts, shares).canRead) throw DomainError.notFound('Node');
  }

  assertWrite(node: NodeRecord, facts: ViewerFact, shares: readonly ShareFact[]): void {
    const decision = this.decide(node, facts, shares);
    if (!decision.canRead) throw DomainError.notFound('Node');
    if (!decision.canWrite) throw DomainError.forbidden();
  }

  breadcrumbStart(
    chain: readonly NodeRecord[],
    facts: ViewerFact,
    shares: readonly ShareFact[],
  ): number {
    return visibleBreadcrumbStart(
      chain.map((n) => ({ id: n.id, path: n.path })),
      facts,
      shares,
    );
  }
}
