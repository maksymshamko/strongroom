# ---- deps -------------------------------------------------------------
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile \
  --filter @dataroom/api... \
  --filter @dataroom/contracts...

# ---- build ------------------------------------------------------------
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

ARG ENV=production
ENV NODE_ENV=production
ENV CI=true

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules

COPY . .

RUN pnpm --filter @dataroom/contracts build \
  && pnpm --filter @dataroom/api exec prisma generate \
  && pnpm --filter @dataroom/api build

RUN pnpm install --frozen-lockfile \
  --prod \
  --filter @dataroom/api... \
  --filter @dataroom/contracts...

# ---- runtime ----------------------------------------------------------
FROM node:22-alpine AS runtime

RUN corepack enable && apk add --no-cache wget

RUN addgroup -g 1001 -S nodejs \
  && adduser -u 1001 -S nodejs -G nodejs

WORKDIR /app

ARG ENV=production
ENV NODE_ENV=production
ENV ENV=${ENV}
ENV API_PORT=3401

COPY --from=build --chown=nodejs:nodejs /repo/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /repo/packages/contracts ./packages/contracts
COPY --from=build --chown=nodejs:nodejs /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=nodejs:nodejs /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=nodejs:nodejs /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=nodejs:nodejs /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=nodejs:nodejs /repo/package.json ./package.json

COPY --chown=nodejs:nodejs apps/api/docker-entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh

USER nodejs

EXPOSE 3401

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3401/api/v1/health || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "apps/api/dist/main.js"]