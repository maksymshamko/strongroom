import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// §1.3 layering rules — dependencies point inward only.
const SRC = resolve(__dirname, '../../src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const re = /(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) specifiers.push(m[1]);
  return specifiers;
}

const FORBIDDEN_IN_DOMAIN = [
  '@nestjs/',
  '@prisma/client',
  '@supabase/',
  'resend',
  'bcryptjs',
  'jsonwebtoken',
  'express',
  '../application',
  '../infra',
  '../api',
  '@application/',
  '@infra/',
  '@api/',
];

const FORBIDDEN_IN_APPLICATION = [
  '@nestjs/',
  '@prisma/client',
  '@supabase/',
  'resend',
  'bcryptjs',
  'jsonwebtoken',
  'express',
  '../infra',
  '../api',
  '@infra/',
  '@api/',
];

function violations(layer: string, forbidden: string[]) {
  const dir = join(SRC, layer);
  const found: string[] = [];
  for (const file of sourceFiles(dir)) {
    for (const spec of importsOf(file)) {
      if (forbidden.some((f) => spec === f.replace(/\/$/, '') || spec.startsWith(f))) {
        found.push(`${file.replace(SRC, 'src')} imports "${spec}"`);
      }
    }
  }
  return found;
}

describe('layering (§1.3)', () => {
  it('domain/ imports no framework, driver, or outer layer', () => {
    expect(violations('domain', FORBIDDEN_IN_DOMAIN)).toEqual([]);
  });

  it('application/ imports no framework, driver, infra, or api', () => {
    expect(violations('application', FORBIDDEN_IN_APPLICATION)).toEqual([]);
  });

  it('domain/ contains no I/O primitives', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(SRC, 'domain'))) {
      const src = readFileSync(file, 'utf8');
      if (/\bfetch\(|node:fs|node:http|process\.env/.test(src)) {
        offenders.push(file.replace(SRC, 'src'));
      }
    }
    expect(offenders).toEqual([]);
  });
});
