import type { Cursor, NodeRecord } from '../../application/ports/repositories';
import { typeRank } from '../../domain/node-type';

/**
 * §4.3 — the cursor carries the full sort tuple `(typeRank, sortKey, id)`.
 * `id` is the tie-breaker that makes the tuple total, so a page boundary can
 * never repeat or skip a row.
 */
export type SortKey = 'name' | 'size' | 'updatedAt' | 'deletedAt';

export function encodeCursor(node: NodeRecord, sort: SortKey): string {
  const cursor: Cursor = {
    typeRank: typeRank(node.type),
    sortKey: sortKeyOf(node, sort),
    id: node.id,
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (
      typeof parsed.typeRank !== 'number' ||
      typeof parsed.sortKey !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    // A malformed cursor is treated as "start from the beginning" rather than an
    // error — it is an opaque token the client never constructs by hand.
    return null;
  }
}

export function sortKeyOf(node: NodeRecord, sort: SortKey): string {
  switch (sort) {
    case 'name':
      return node.name;
    case 'size':
      // Zero-padded so string comparison matches numeric comparison.
      return node.size.toString().padStart(24, '0');
    case 'updatedAt':
      return node.updatedAt.toISOString();
    // spec 003 §2.5 — trash listings order by when the item was deleted.
    case 'deletedAt':
      return (node.deletedAt ?? node.updatedAt).toISOString();
  }
}

/** The SQL expression that produces the same key, for the row-value comparison. */
export function sortKeySql(sort: Exclude<SortKey, 'deletedAt'>): string {
  switch (sort) {
    case 'name':
      return '"name"';
    case 'size':
      return 'lpad("size"::text, 24, \'0\')';
    case 'updatedAt':
      return 'to_char("updatedAt" AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\')';
  }
}
