import { describe, expect, it } from 'vitest';
import { NodePath } from '../../src/domain/node-path';
import { DomainError } from '../../src/domain/errors';
import { MAX_DEPTH } from '@dataroom/contracts';

const R = '11111111-1111-1111-1111-111111111111';
const F = '22222222-2222-2222-2222-222222222222';
const X = '33333333-3333-3333-3333-333333333333';
const OTHER = '44444444-4444-4444-4444-444444444444';

// §2.2 materialized path.
describe('NodePath (§2.2)', () => {
  it('renders a data room root as /R/', () => {
    expect(NodePath.root(R).value).toBe(`/${R}/`);
  });

  it('renders descendants with leading and trailing slashes', () => {
    const folder = NodePath.root(R).child(F);
    expect(folder.value).toBe(`/${R}/${F}/`);
    expect(folder.child(X).value).toBe(`/${R}/${F}/${X}/`);
  });

  it('exposes the ancestor ids excluding self', () => {
    const file = NodePath.root(R).child(F).child(X);
    expect(file.ancestorIds).toEqual([R, F]);
    expect(file.ids).toEqual([R, F, X]);
    expect(file.selfId).toBe(X);
  });

  it('derives dataRoomId from the first segment (§2.2 rule 5)', () => {
    expect(NodePath.root(R).child(F).child(X).dataRoomId).toBe(R);
  });

  it('computes depth as the number of ids (§2.2 rule 3)', () => {
    expect(NodePath.root(R).depth).toBe(1);
    expect(NodePath.root(R).child(F).depth).toBe(2);
    expect(NodePath.root(R).child(F).child(X).depth).toBe(3);
  });

  it('rejects going deeper than MAX_DEPTH', () => {
    let p = NodePath.root(R);
    for (let i = 1; i < MAX_DEPTH; i++) p = p.child(`${i}`.padStart(8, '0') + '-0000-0000-0000-000000000000');
    expect(p.depth).toBe(MAX_DEPTH);
    expect(() => p.child(OTHER)).toThrow(DomainError);
  });

  it('prefix-tests the subtree, inclusive of self (§2.2 rule 1)', () => {
    const room = NodePath.root(R);
    const folder = room.child(F);
    const file = folder.child(X);
    expect(room.contains(room)).toBe(true);
    expect(room.contains(file)).toBe(true);
    expect(folder.contains(file)).toBe(true);
    expect(file.contains(folder)).toBe(false);
    expect(NodePath.root(OTHER).contains(file)).toBe(false);
  });

  it('does not treat an id-prefix collision as containment', () => {
    // Trailing slashes are what make prefix matching safe.
    const a = NodePath.parse('/aaaa/');
    const b = NodePath.parse('/aaaabbbb/');
    expect(a.contains(b)).toBe(false);
  });

  it('reparents a subtree by prefix substitution (§2.2 rule 4)', () => {
    const oldParent = NodePath.root(R).child(F);
    const newParent = NodePath.root(R).child(OTHER);
    const descendant = oldParent.child(X);
    expect(descendant.reparent(oldParent, newParent).value).toBe(`/${R}/${OTHER}/${X}/`);
  });

  it('parses a stored path string back into a NodePath', () => {
    const raw = `/${R}/${F}/${X}/`;
    expect(NodePath.parse(raw).value).toBe(raw);
    expect(() => NodePath.parse(`${R}/${F}`)).toThrow(DomainError);
    expect(() => NodePath.parse('')).toThrow(DomainError);
  });
});
