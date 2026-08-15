-- spec 003 §2.1 — the TRASH member lands in its own migration because Postgres
-- refuses to use a new enum value in the transaction that adds it.
ALTER TYPE "NodeType" ADD VALUE 'TRASH';
