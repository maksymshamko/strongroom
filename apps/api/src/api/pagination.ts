import { listQuerySchema } from '@dataroom/contracts';
import type { ListOptions, NodeRecord } from '../application/ports/repositories';
import { decodeCursor, encodeCursor, type SortKey } from '../infra/prisma/cursor';

/** §4.3 — one place where a query string becomes ListOptions. */
export function listOptions(query: unknown): ListOptions {
  const parsed = listQuerySchema.parse(query);
  return {
    limit: parsed.limit,
    cursor: decodeCursor(parsed.cursor),
    sort: parsed.sort,
    dir: parsed.dir,
  };
}

export function pageResponse<T>(
  result: { items: NodeRecord[]; hasMore: boolean },
  sort: SortKey,
  map: (node: NodeRecord) => T,
): { items: T[]; nextCursor: string | null } {
  const last = result.items[result.items.length - 1];
  return {
    items: result.items.map(map),
    nextCursor: result.hasMore && last ? encodeCursor(last, sort) : null,
  };
}
