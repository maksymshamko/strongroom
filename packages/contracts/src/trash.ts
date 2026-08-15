import { z } from 'zod';
import { conflictResolutionSchema } from './primitives';
import type { NodeDto } from './nodes';

/** spec 003 §2.5 */
export type TrashItemDto = NodeDto & {
  deletedAt: string;
  deletedFromLabel: string;
};

export type TrashResponse = {
  /** Null until the user's first delete — no TRASH row is written before then. */
  node: NodeDto | null;
  items: TrashItemDto[];
  nextCursor: string | null;
};

/** spec 003 §2.6 — restore is a move, so it takes the §6.4 conflict protocol. */
export const restoreSchema = z.object({
  onConflict: conflictResolutionSchema.optional(),
});

/** spec 003 §2.7 — 30 days from deletedAt. */
export const TRASH_TTL_DAYS = 30;
