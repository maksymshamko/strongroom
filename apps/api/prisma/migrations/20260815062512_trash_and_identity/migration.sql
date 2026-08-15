-- spec 003 §2.1 — trash bookkeeping columns.
ALTER TABLE "Node" ADD COLUMN     "deletedFromLabel" TEXT,
ADD COLUMN     "previousName" TEXT,
ADD COLUMN     "previousParentId" TEXT;

-- CreateIndex
CREATE INDEX "Node_deletedAt_idx" ON "Node"("deletedAt");

-- spec 003 §2.1 — exactly one TRASH node per user. Prisma cannot express a
-- partial unique index, so it is declared here.
CREATE UNIQUE INDEX "Node_owner_trash_unique"
  ON "Node" ("ownerId") WHERE "type" = 'TRASH';
