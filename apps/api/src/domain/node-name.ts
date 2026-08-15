import { DomainError } from './errors';
import type { NodeType } from './node-type';

const MAX_LENGTH = 255;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/**
 * §6.3 — a validated, normalized node name.
 *
 * Normalization is NFC so two names that render identically also compare
 * identically; without it the `(parentId, name)` uniqueness constraint would
 * admit visually indistinguishable siblings.
 */
export class NodeName {
  private constructor(readonly value: string) {}

  static create(raw: string): NodeName {
    if (typeof raw !== 'string') {
      throw DomainError.validation('Name must be a string');
    }
    const normalized = raw.normalize('NFC').trim();

    if (normalized.length === 0) {
      throw DomainError.validation('Name may not be empty');
    }
    if (normalized.length > MAX_LENGTH) {
      throw DomainError.validation(`Name may not exceed ${MAX_LENGTH} characters`);
    }
    if (normalized.includes('/')) {
      throw DomainError.validation('Name may not contain "/"');
    }
    if (CONTROL_CHARS.test(normalized)) {
      throw DomainError.validation('Name may not contain control characters');
    }
    if (normalized === '.' || normalized === '..') {
      throw DomainError.validation('Name may not be "." or ".."');
    }
    return new NodeName(normalized);
  }

  /**
   * §6.2 — splits into stem and extension. Only FILE nodes have an extension,
   * and a leading dot is part of the stem (".gitignore" is not an extension).
   */
  split(type: NodeType): { stem: string; ext: string } {
    return splitName(this.value, type);
  }

  toString(): string {
    return this.value;
  }
}

export function splitName(name: string, type: NodeType): { stem: string; ext: string } {
  if (type !== 'FILE') return { stem: name, ext: '' };
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}
