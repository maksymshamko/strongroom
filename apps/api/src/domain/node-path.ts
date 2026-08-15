import { DomainError } from './errors';

/** §2.2 rule 3 — kept in sync with @dataroom/contracts MAX_DEPTH. */
export const MAX_DEPTH = 32;

/**
 * §2.2 — the materialized ancestor path, inclusive of self, with a leading and
 * trailing slash: `/roomId/folderId/fileId/`.
 *
 * The trailing slash is what makes prefix matching safe: without it, `/aaaa`
 * would appear to contain `/aaaabbbb`.
 */
export class NodePath {
  private constructor(private readonly segments: readonly string[]) {}

  static root(id: string): NodePath {
    if (!id) throw DomainError.validation('Path segment may not be empty');
    return new NodePath([id]);
  }

  static parse(raw: string): NodePath {
    if (typeof raw !== 'string' || !raw.startsWith('/') || !raw.endsWith('/') || raw.length < 3) {
      throw DomainError.validation(`Malformed node path: "${raw}"`);
    }
    const segments = raw.slice(1, -1).split('/');
    if (segments.some((s) => s.length === 0)) {
      throw DomainError.validation(`Malformed node path: "${raw}"`);
    }
    return new NodePath(segments);
  }

  child(id: string): NodePath {
    if (!id) throw DomainError.validation('Path segment may not be empty');
    if (this.segments.length + 1 > MAX_DEPTH) {
      throw DomainError.invalidMove(
        `Folder nesting may not exceed ${MAX_DEPTH} levels`,
      );
    }
    return new NodePath([...this.segments, id]);
  }

  get value(): string {
    return `/${this.segments.join('/')}/`;
  }

  get ids(): string[] {
    return [...this.segments];
  }

  get ancestorIds(): string[] {
    return this.segments.slice(0, -1);
  }

  get selfId(): string {
    return this.segments[this.segments.length - 1];
  }

  /** §2.2 rule 5 — the data room root is the first segment. */
  get dataRoomId(): string {
    return this.segments[0];
  }

  /** §2.2 rule 3 */
  get depth(): number {
    return this.segments.length;
  }

  /** §2.2 rule 1 — subtree containment, inclusive of self. */
  contains(other: NodePath): boolean {
    return other.value.startsWith(this.value);
  }

  isDescendantOf(other: NodePath): boolean {
    return other.contains(this) && other.value !== this.value;
  }

  /** §2.2 rule 4 — prefix substitution for a moved subtree. */
  reparent(oldParent: NodePath, newParent: NodePath): NodePath {
    if (!oldParent.contains(this)) {
      throw DomainError.validation('Cannot reparent a path outside the moved subtree');
    }
    const rewritten = newParent.value + this.value.slice(oldParent.value.length);
    const result = NodePath.parse(rewritten);
    if (result.depth > MAX_DEPTH) {
      throw DomainError.invalidMove(`Folder nesting may not exceed ${MAX_DEPTH} levels`);
    }
    return result;
  }

  toString(): string {
    return this.value;
  }
}
