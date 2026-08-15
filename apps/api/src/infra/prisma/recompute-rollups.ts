import type { PrismaClient } from '@prisma/client';

/**
 * §2.3 — a full recompute of every folder's size and itemCount from scratch.
 *
 * This exists so the incremental path can be checked against ground truth: if a
 * mutation ever forgets an ancestor, running this after a workload changes rows,
 * and the test fails. It is not used on the request path.
 */
export async function recomputeRollups(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    WITH totals AS (
      SELECT
        parent."id" AS id,
        count(child."id") FILTER (WHERE child."id" IS NOT NULL) AS item_count,
        coalesce(sum(child."size") FILTER (WHERE child."type" = 'FILE'), 0) AS total_size
      FROM "Node" parent
      LEFT JOIN "Node" child
        ON child."path" LIKE parent."path" || '%'
       AND child."id" <> parent."id"
      WHERE parent."type" <> 'FILE'
      GROUP BY parent."id"
    )
    UPDATE "Node" n
    SET "size" = totals.total_size,
        "itemCount" = totals.item_count
    FROM totals
    WHERE n."id" = totals.id
      AND (n."size" <> totals.total_size OR n."itemCount" <> totals.item_count)
  `);
}
