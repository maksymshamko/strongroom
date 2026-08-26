-- Row-level security for the Supabase-hosted database.
--
-- Nothing in this system reaches these tables over Supabase's REST/realtime
-- API: the browser talks only to the NestJS API, and the API talks to Postgres
-- through Prisma over a direct connection. So the correct posture for the
-- `anon` and `authenticated` roles — the two roles PostgREST assumes for
-- anything holding a publishable/anon key — is no access at all.
--
-- Enabling RLS without policies already denies those roles every row, which is
-- why the app keeps working with RLS on and nothing else configured. This
-- migration makes that state explicit and durable:
--
--   1. RLS is on for every table in `public`. A table added by a later
--      migration is not covered automatically — Postgres has no default for
--      this — so a migration that creates a table should enable RLS on it.
--   2. Table and sequence privileges are revoked from `anon`/`authenticated`,
--      so a leaked publishable key is refused at the privilege check rather
--      than relying on RLS alone.
--   3. One explicit `service_role` policy per table records the intent — that
--      the privileged server-side key is the only thing meant to read these
--      rows — and clears Supabase's "RLS enabled, no policy" advisor notice.
--
-- Deliberately NOT done: `FORCE ROW LEVEL SECURITY`. Prisma connects as the
-- role that owns these tables, and a table owner is exempt from its own RLS
-- policies. Forcing it would apply the policies to the API's own connection
-- and every query would return zero rows.
--
-- Every statement is guarded so this migration is a no-op on a plain Postgres
-- (local dev, CI), where the Supabase roles do not exist.

-- 1. RLS on, for every table in `public`.
DO $$
DECLARE
  tbl oid;
BEGIN
  FOR tbl IN
    SELECT c.oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl::regclass);
  END LOOP;
END
$$;

-- 2. Take the API surface away from the unprivileged Supabase roles.
DO $$
DECLARE
  unprivileged text;
BEGIN
  FOREACH unprivileged IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = unprivileged);

    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', unprivileged);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', unprivileged);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', unprivileged);
    -- Future tables created by this role (i.e. by Prisma) inherit the refusal.
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
      unprivileged
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
      unprivileged
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I',
      unprivileged
    );
  END LOOP;
END
$$;

-- 3. The one policy: service_role, and nothing else. `service_role` bypasses
-- RLS anyway, so this grants no access it did not already have — it states in
-- the schema which caller these tables are for.
DO $$
DECLARE
  rec record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RETURN;
  END IF;

  FOR rec IN
    SELECT c.oid, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = rec.relname
        AND policyname = 'service_role_full_access'
    );

    EXECUTE format(
      'CREATE POLICY "service_role_full_access" ON %s AS PERMISSIVE FOR ALL '
      || 'TO service_role USING (true) WITH CHECK (true)',
      rec.oid::regclass
    );
  END LOOP;
END
$$;
