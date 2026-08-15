import { describe, expect, it } from 'vitest';
import { rollupDelta } from '../../src/domain/rollup-delta';

// §2.3 size and item-count invariants.
describe('rollupDelta (§2.3)', () => {
  it('adds one item and the file size when a file is uploaded', () => {
    expect(rollupDelta({ kind: 'ADD_FILE', size: 4200n })).toEqual({
      sizeDelta: 4200n,
      countDelta: 1,
    });
  });

  it('adds one item and no size when a folder is created', () => {
    expect(rollupDelta({ kind: 'ADD_FOLDER' })).toEqual({ sizeDelta: 0n, countDelta: 1 });
  });

  it('subtracts the whole subtree when a folder is deleted', () => {
    expect(rollupDelta({ kind: 'REMOVE_SUBTREE', size: 8_400_000n, itemCount: 15 })).toEqual({
      sizeDelta: -8_400_000n,
      countDelta: -16, // 15 descendants plus the folder itself
    });
  });

  it('subtracts one item and the file size when a file is deleted', () => {
    expect(rollupDelta({ kind: 'REMOVE_FILE', size: 4200n })).toEqual({
      sizeDelta: -4200n,
      countDelta: -1,
    });
  });

  it('applies only a size delta when a new version replaces the latest (§2.3 latest-only)', () => {
    // v2 (6.2 MB) replaces v1 (4.2 MB) as the node's reported size; item count is unchanged.
    expect(rollupDelta({ kind: 'REPLACE_LATEST_VERSION', oldSize: 4200n, newSize: 6200n })).toEqual({
      sizeDelta: 2000n,
      countDelta: 0,
    });
  });

  it('produces a zero delta for a rename, which still bumps ancestor updatedAt (§2.3)', () => {
    expect(rollupDelta({ kind: 'RENAME' })).toEqual({ sizeDelta: 0n, countDelta: 0 });
  });

  it('negates a delta for the source ancestors of a move', () => {
    const moved = { size: 1_000n, itemCount: 3 };
    const gain = rollupDelta({ kind: 'ADD_SUBTREE', ...moved });
    const loss = rollupDelta({ kind: 'REMOVE_SUBTREE', ...moved });
    expect(gain.sizeDelta).toBe(-loss.sizeDelta);
    expect(gain.countDelta).toBe(-loss.countDelta);
  });
});
