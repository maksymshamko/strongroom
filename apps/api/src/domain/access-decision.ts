/**
 * §5.2 — the access decision, expressed as pure logic over facts the
 * infrastructure has already gathered. Nothing here queries anything; the caller
 * supplies the viewer's active share set (§5.3), which is where "revoked" is
 * already filtered out.
 */
export type ShareFact = {
  shareId: string;
  mode: 'PUBLIC_LINK' | 'PERMISSIONED';
  /** Path of the node the share sits on. */
  nodePath: string;
  /** User ids holding an active grant on this share (PERMISSIONED only). */
  grantUserIds: string[];
  /** Token for a PUBLIC_LINK share. */
  token: string | null;
};

export type ViewerFact = {
  userId: string | null;
  ownedDataRoomIds: string[];
  /** Share token presented with the request, if any (§5.6). */
  token: string | null;
};

export type NodeFact = {
  path: string;
  dataRoomId: string;
  ownerId: string;
};

export type Decision = { canRead: boolean; canWrite: boolean };

function covers(share: ShareFact, node: NodeFact): boolean {
  // Trailing slashes make this prefix test exact (§2.2 rule 1).
  return node.path.startsWith(share.nodePath);
}

function shareAdmitsViewer(share: ShareFact, viewer: ViewerFact): boolean {
  if (share.mode === 'PERMISSIONED') {
    return viewer.userId !== null && share.grantUserIds.includes(viewer.userId);
  }
  return share.token !== null && viewer.token !== null && share.token === viewer.token;
}

export function decideAccess(
  node: NodeFact,
  viewer: ViewerFact,
  activeShares: readonly ShareFact[],
): Decision {
  // Ownership is the only path to write access — ShareRole is VIEWER-only in
  // this pass, so no grant ever confers write (§5.2).
  if (viewer.userId !== null && viewer.ownedDataRoomIds.includes(node.dataRoomId)) {
    return { canRead: true, canWrite: true };
  }

  const canRead = activeShares.some(
    (share) => covers(share, node) && shareAdmitsViewer(share, viewer),
  );
  return { canRead, canWrite: false };
}

/**
 * §5.5 — the index in a root-first ancestor chain at which the viewer's
 * breadcrumb may start. An owner sees the whole chain; anyone else starts at the
 * highest node their shares actually cover.
 */
export function visibleBreadcrumbStart(
  chain: readonly { id: string; path: string }[],
  viewer: ViewerFact,
  activeShares: readonly ShareFact[],
): number {
  if (chain.length === 0) return 0;

  const dataRoomId = chain[0].id;
  if (viewer.userId !== null && viewer.ownedDataRoomIds.includes(dataRoomId)) return 0;

  const index = chain.findIndex((segment) =>
    activeShares.some(
      (share) =>
        segment.path.startsWith(share.nodePath) && shareAdmitsViewer(share, viewer),
    ),
  );
  return index === -1 ? chain.length : index;
}
