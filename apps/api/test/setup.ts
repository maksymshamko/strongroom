import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Integration tests run against a real Postgres (skill gate 6: integration means
 * integration). The schema is pushed once per test process; each test file resets
 * data via truncate (test/helpers/db.ts), not by re-migrating.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://dataroom:dataroom@127.0.0.1:5432/dataroom_test?schema=public';

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret';
process.env.WEB_URL ??= 'http://localhost:3000';
process.env.NODE_ENV = 'test';

const apiRoot = resolve(__dirname, '..');

if (!process.env.DR_SCHEMA_READY) {
  execSync('pnpm exec prisma db push --skip-generate --accept-data-loss', {
    cwd: apiRoot,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
  process.env.DR_SCHEMA_READY = '1';
}
