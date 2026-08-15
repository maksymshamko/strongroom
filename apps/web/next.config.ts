import { join } from 'node:path'
import type { NextConfig } from 'next'
import * as dotenv from 'dotenv'

dotenv.config({
  path: join(__dirname, '../../.env'),
})
const config: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // spec 004 §2.5 — the runtime stage ships Next's pruned standalone tree
  // rather than the whole monorepo's node_modules.
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '../../'),
  env: {
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE:
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  },
}

export default config
