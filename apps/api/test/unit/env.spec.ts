import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRootEnv } from '../../src/infra/env';

// spec 004 §2.2 — the root `.env` must be found from wherever a process starts.
describe('findRootEnv (§2.2)', () => {
  function makeWorkspace(): string {
    const root = mkdtempSync(join(tmpdir(), 'dr-env-'));
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n');
    writeFileSync(join(root, '.env'), 'JWT_SECRET=from-root\n');
    mkdirSync(join(root, 'apps', 'api', 'src', 'infra'), { recursive: true });
    return root;
  }

  it('walks up to the workspace root from deep inside a package', () => {
    const root = makeWorkspace();
    expect(findRootEnv(join(root, 'apps', 'api', 'src', 'infra'))).toBe(join(root, '.env'));
  });

  it('finds it from the workspace root itself', () => {
    const root = makeWorkspace();
    expect(findRootEnv(root)).toBe(join(root, '.env'));
  });

  it('stops at the workspace root rather than escaping to a parent .env', () => {
    const outer = mkdtempSync(join(tmpdir(), 'dr-outer-'));
    writeFileSync(join(outer, '.env'), 'JWT_SECRET=from-outer\n');
    const root = join(outer, 'repo');
    mkdirSync(join(root, 'apps', 'api'), { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    writeFileSync(join(root, '.env'), 'JWT_SECRET=from-repo\n');

    expect(findRootEnv(join(root, 'apps', 'api'))).toBe(join(root, '.env'));
  });

  it('falls back to a sibling .env when there is no workspace file (Docker layout)', () => {
    const app = mkdtempSync(join(tmpdir(), 'dr-docker-'));
    mkdirSync(join(app, 'dist'), { recursive: true });
    writeFileSync(join(app, '.env'), 'JWT_SECRET=from-image\n');

    expect(findRootEnv(join(app, 'dist'))).toBe(join(app, '.env'));
  });

  it('returns null instead of throwing when there is no .env at all', () => {
    // Normal in CI and in production, where the platform injects the environment.
    const bare = mkdtempSync(join(tmpdir(), 'dr-bare-'));
    expect(findRootEnv(bare)).toBeNull();
  });
});
