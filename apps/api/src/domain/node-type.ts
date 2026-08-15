export type NodeType = 'DATAROOM' | 'FOLDER' | 'FILE' | 'TRASH';

/** §4.3 — folders sort before files; the rank is the leading term of the sort tuple. */
export function typeRank(type: NodeType): 0 | 1 {
  return type === 'FILE' ? 1 : 0;
}

export function canHaveChildren(type: NodeType): boolean {
  return type !== 'FILE';
}

/** spec 003 §2.1 — the per-user trash root. */
export function isTrashRoot(type: NodeType): boolean {
  return type === 'TRASH';
}
