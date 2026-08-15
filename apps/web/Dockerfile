# spec 004 §2.5 — web image.
# Built from the monorepo root: docker build -f apps/web/Dockerfile .
#
# §2.3 is the thing to watch here: Next.js bakes NEXT_PUBLIC_* into the client
# bundle at BUILD time, so those arrive as ARG. Passing them only as runtime
# `environment` produces an image that silently talks to the wrong API.

# ---- deps -------------------------------------------------------------
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --filter @dataroom/web... --filter @dataroom/contracts...

# ---- build ------------------------------------------------------------
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

ARG ENV=production
# Baked into the bundle — see §2.3.
ARG NEXT_PUBLIC_API_URL=/api/v1
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
ARG NEXT_PUBLIC_POSTHOG_KEY=""
ARG NEXT_PUBLIC_POSTHOG_HOST="https://eu.i.posthog.com"

ENV NODE_ENV=production \
    ENV=${ENV} \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_SENTRY_ENVIRONMENT=${NEXT_PUBLIC_SENTRY_ENVIRONMENT} \
    NEXT_PUBLIC_POSTHOG_KEY=${NEXT_PUBLIC_POSTHOG_KEY} \
    NEXT_PUBLIC_POSTHOG_HOST=${NEXT_PUBLIC_POSTHOG_HOST}

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY . .

RUN pnpm --filter @dataroom/contracts build \
 && pnpm --filter @dataroom/web build

# Next's standalone output only includes public/ if it existed at build time;
# the app doesn't have static assets yet, so make sure the runtime COPY below
# has a directory to copy.
RUN mkdir -p apps/web/public

# ---- runtime ----------------------------------------------------------
FROM node:22-alpine AS runtime
RUN apk add --no-cache wget
WORKDIR /app

ARG ENV=production
ENV NODE_ENV=production \
    ENV=${ENV} \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3400 \
    HOSTNAME=0.0.0.0

# Next's standalone output already contains the pruned dependency tree.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs \
 && chown -R nextjs:nodejs /app
USER nextjs

# §2.4
EXPOSE 3400

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3400/login || exit 1

CMD ["node", "apps/web/server.js"]
