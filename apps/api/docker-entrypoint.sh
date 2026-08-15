#!/bin/sh
# spec 004 §2.5 — migrate, then serve.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not set. The API cannot start without a database." >&2
  exit 1
fi

echo "Applying database migrations…"
node apps/api/node_modules/prisma/build/index.js migrate deploy --schema apps/api/prisma/schema.prisma

# Seeding is opt-in: it is a convenience for a fresh environment, never
# something a production restart should do on its own.
if [ "$SEED_ON_START" = "true" ]; then
  echo "Seeding demo data…"
  node apps/api/dist/prisma/seed.js || echo "Seed skipped (already present or unavailable)"
fi

exec "$@"
