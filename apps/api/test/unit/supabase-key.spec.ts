import { describe, expect, it } from 'vitest';
import {
  classifySupabaseKey,
  SupabaseFileStorage,
} from '../../src/infra/storage/supabase-file-storage';

/** Builds an unsigned JWT with the given claims — only the payload is read. */
function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`;
}

describe('classifySupabaseKey', () => {
  it('recognises the legacy service_role JWT', () => {
    expect(classifySupabaseKey(jwt({ role: 'service_role' }))).toBe('service_role');
  });

  it('recognises the legacy anon JWT', () => {
    expect(classifySupabaseKey(jwt({ role: 'anon' }))).toBe('anon');
  });

  it('recognises the current key prefixes', () => {
    expect(classifySupabaseKey('sb_secret_abc123')).toBe('secret');
    expect(classifySupabaseKey('sb_publishable_abc123')).toBe('publishable');
  });

  it('gives up rather than guessing on anything else', () => {
    expect(classifySupabaseKey('not-a-key')).toBe('unknown');
    expect(classifySupabaseKey(jwt({ sub: 'no-role-claim' }))).toBe('unknown');
  });
});

describe('SupabaseFileStorage', () => {
  const url = 'https://project.supabase.co';

  // An unprivileged key authenticates fine and only fails later, as an opaque
  // "row violates row-level security policy" on the first upload. Refusing at
  // construction turns that into a startup error naming the variable to fix.
  it.each([
    ['anon', jwt({ role: 'anon' })],
    ['publishable', 'sb_publishable_abc123'],
  ])('refuses to start on a %s key', (_label, key) => {
    expect(() => new SupabaseFileStorage(url, key, 'dataroom')).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it.each([
    ['service_role', jwt({ role: 'service_role' })],
    ['sb_secret', 'sb_secret_abc123'],
    ['unrecognised', 'opaque-key'],
  ])('accepts a %s key', (_label, key) => {
    expect(() => new SupabaseFileStorage(url, key, 'dataroom')).not.toThrow();
  });
});
