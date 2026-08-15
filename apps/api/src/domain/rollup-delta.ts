/**
 * §2.3 — the size/count delta each mutation applies to every ancestor.
 *
 * Keeping this pure is what lets the incremental path be checked against a full
 * recompute: the arithmetic lives in one place instead of being scattered across
 * repository methods.
 */
export type Mutation =
  | { kind: 'ADD_FILE'; size: bigint }
  | { kind: 'REMOVE_FILE'; size: bigint }
  | { kind: 'ADD_FOLDER' }
  | { kind: 'REMOVE_FOLDER' }
  | { kind: 'ADD_SUBTREE'; size: bigint; itemCount: number }
  | { kind: 'REMOVE_SUBTREE'; size: bigint; itemCount: number }
  | { kind: 'REPLACE_LATEST_VERSION'; oldSize: bigint; newSize: bigint }
  | { kind: 'RENAME' };

export type Delta = { sizeDelta: bigint; countDelta: number };

export const ZERO_DELTA: Delta = { sizeDelta: 0n, countDelta: 0 };

export function rollupDelta(mutation: Mutation): Delta {
  switch (mutation.kind) {
    case 'ADD_FILE':
      return { sizeDelta: mutation.size, countDelta: 1 };
    case 'REMOVE_FILE':
      return { sizeDelta: -mutation.size, countDelta: -1 };
    case 'ADD_FOLDER':
      return { sizeDelta: 0n, countDelta: 1 };
    case 'REMOVE_FOLDER':
      return { sizeDelta: 0n, countDelta: -1 };
    // The subtree's own root counts too, hence the ±1 alongside its descendants.
    case 'ADD_SUBTREE':
      return { sizeDelta: mutation.size, countDelta: mutation.itemCount + 1 };
    case 'REMOVE_SUBTREE':
      return { sizeDelta: -mutation.size, countDelta: -(mutation.itemCount + 1) };
    // A node reports only its latest version's size (§2.3), so item count is untouched.
    case 'REPLACE_LATEST_VERSION':
      return { sizeDelta: mutation.newSize - mutation.oldSize, countDelta: 0 };
    // Zero delta, but still applied — it is what bumps ancestor updatedAt (§2.3).
    case 'RENAME':
      return ZERO_DELTA;
  }
}

export function addDeltas(a: Delta, b: Delta): Delta {
  return { sizeDelta: a.sizeDelta + b.sizeDelta, countDelta: a.countDelta + b.countDelta };
}

export function isZero(delta: Delta): boolean {
  return delta.sizeDelta === 0n && delta.countDelta === 0;
}
