import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    swc.vite({
      module: { type: 'es6' },
      jsc: { target: 'es2022', parser: { syntax: 'typescript', decorators: true }, transform: { decoratorMetadata: true } },
    }),
  ],
  test: {
    globals: true,
    include: ['test/**/*.spec.ts'],
    // Integration tests share one Postgres schema — run files serially (skill gate 6).
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['test/setup.ts'],
  },
});
