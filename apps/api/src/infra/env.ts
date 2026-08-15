import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * spec 004 §2.2 — one `.env` at the monorepo root, for both apps and for
 * `docker compose --env-file`.
 *
 * Resolved by walking up from this file until a directory contains both a
 * `pnpm-workspace.yaml` and a `.env`, rather than trusting `process.cwd()`:
 * the API is started from the repo root in development, from `/app` in Docker,
 * and from the package directory by the test runner.
 */
export function loadRootEnv(): string | null {
  const found = findRootEnv(__dirname);
  if (found) config({ path: found });
  return found;
}

export function findRootEnv(from: string): string | null {
  let dir = from;

  for (let depth = 0; depth < 10; depth++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml')) && existsSync(resolve(dir, '.env'))) {
      return resolve(dir, '.env');
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Docker copies the root `.env` next to the app, with no workspace file.
  for (const candidate of [resolve(from, '../.env'), resolve(from, '../../.env'), '/app/.env']) {
    if (existsSync(candidate)) return candidate;
  }

  // Absent `.env` is normal in CI and in production, where the platform injects
  // the environment directly. Never throw for it.
  return null;
}
