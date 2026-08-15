import { splitName } from './node-name';
import type { NodeType } from './node-type';

/** Matches a trailing " (12)" so suffixes replace rather than compound. */
const EXISTING_SUFFIX = /^(.*?) \((\d+)\)$/;

/**
 * §6.2 — given a desired name and the set of names already used by siblings,
 * return the first free " (k)"-suffixed variant. Pure and deterministic; the
 * sibling set is never mutated.
 */
export function suggestFreeName(
  desired: string,
  siblingNames: ReadonlySet<string>,
  type: NodeType,
): string {
  if (!siblingNames.has(desired)) return desired;

  const { stem, ext } = splitName(desired, type);
  const base = EXISTING_SUFFIX.exec(stem)?.[1] ?? stem;

  for (let k = 1; ; k++) {
    const candidate = `${base} (${k})${ext}`;
    if (!siblingNames.has(candidate)) return candidate;
  }
}
