import { Prisma } from '@prisma/client';
import type {
  ListOptions,
  NodeCreateInput,
  NodeRecord,
  NodeRepository,
  SearchFilters,
  SubtreeTotals,
} from '../../application/ports/repositories';
import { NodePath } from '../../domain/node-path';
import { toNodeRecord } from './mappers';
import { sortKeySql } from './cursor';
import type { Tx } from './unit-of-work';

const withOwner = { owner: { select: { name: true } } } as const;

export class PrismaNodeRepository implements NodeRepository {
  constructor(private readonly tx: Tx) {}

  async findById(id: string): Promise<NodeRecord | null> {
    const row = await this.tx.node.findUnique({ where: { id }, include: withOwner });
    return row ? toNodeRecord(row) : null;
  }

  async findByIds(ids: string[]): Promise<NodeRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.tx.node.findMany({ where: { id: { in: ids } }, include: withOwner });
    return rows.map(toNodeRecord);
  }

  /** §2.2 rule 2 — ancestors come from the path, never from a recursive query. */
  async ancestorChain(node: NodeRecord): Promise<NodeRecord[]> {
    const ids = NodePath.parse(node.path).ids;
    const rows = await this.tx.node.findMany({ where: { id: { in: ids } }, include: withOwner });
    const byId = new Map(rows.map((r) => [r.id, toNodeRecord(r)]));
    return ids.map((id) => byId.get(id)).filter((n): n is NodeRecord => Boolean(n));
  }

  async childNames(parentId: string): Promise<Set<string>> {
    const rows = await this.tx.node.findMany({ where: { parentId }, select: { name: true } });
    return new Set(rows.map((r) => r.name));
  }

  async findChildByName(parentId: string, name: string): Promise<NodeRecord | null> {
    const row = await this.tx.node.findFirst({ where: { parentId, name }, include: withOwner });
    return row ? toNodeRecord(row) : null;
  }

  async listChildren(parentId: string, opts: ListOptions): Promise<NodeRecord[]> {
    return this.listWhere(Prisma.sql`"parentId" = ${parentId}`, opts);
  }

  async listDataRooms(ownerId: string, opts: ListOptions): Promise<NodeRecord[]> {
    return this.listWhere(
      Prisma.sql`"ownerId" = ${ownerId} AND "type" = 'DATAROOM'::"NodeType"`,
      opts,
    );
  }

  async searchSubtree(
    pathPrefix: string,
    filters: SearchFilters,
    opts: ListOptions,
  ): Promise<NodeRecord[]> {
    const clauses: Prisma.Sql[] = [
      // Subtree, excluding the root itself (§8.5 searches *within* the node).
      Prisma.sql`"path" LIKE ${pathPrefix + '%'}`,
      Prisma.sql`"path" <> ${pathPrefix}`,
    ];

    if (filters.q) clauses.push(Prisma.sql`"name" ILIKE ${'%' + escapeLike(filters.q) + '%'}`);
    if (filters.types?.length) {
      clauses.push(
        Prisma.sql`"type" = ANY(${filters.types}::text[]::"NodeType"[])`,
      );
    }
    if (filters.mimeTypes?.length) {
      clauses.push(Prisma.sql`"mimeType" = ANY(${filters.mimeTypes}::text[])`);
    }
    if (filters.minSize !== undefined) clauses.push(Prisma.sql`"size" >= ${BigInt(filters.minSize)}`);
    if (filters.maxSize !== undefined) clauses.push(Prisma.sql`"size" <= ${BigInt(filters.maxSize)}`);
    if (filters.createdFrom) clauses.push(Prisma.sql`"createdAt" >= ${filters.createdFrom}`);
    if (filters.createdTo) clauses.push(Prisma.sql`"createdAt" <= ${filters.createdTo}`);
    if (filters.updatedFrom) clauses.push(Prisma.sql`"updatedAt" >= ${filters.updatedFrom}`);
    if (filters.updatedTo) clauses.push(Prisma.sql`"updatedAt" <= ${filters.updatedTo}`);

    return this.listWhere(Prisma.join(clauses, ' AND '), opts);
  }

  async create(record: NodeCreateInput): Promise<NodeRecord> {
    const row = await this.tx.node.create({
      data: {
        id: record.id,
        parentId: record.parentId,
        type: record.type,
        name: record.name,
        path: record.path,
        dataRoomId: record.dataRoomId,
        size: record.size,
        itemCount: record.itemCount,
        mimeType: record.mimeType,
        ownerId: record.ownerId,
      },
      include: withOwner,
    });
    return toNodeRecord(row);
  }

  async rename(id: string, name: string): Promise<NodeRecord> {
    const row = await this.tx.node.update({
      where: { id },
      data: { name },
      include: withOwner,
    });
    return toNodeRecord(row);
  }

  async reparent(
    node: NodeRecord,
    newParent: NodeRecord,
    newPath: string,
    newName: string,
  ): Promise<NodeRecord> {
    // §2.2 rule 4 — one statement rewrites the whole moved subtree.
    await this.tx.$executeRaw`
      UPDATE "Node"
      SET "path" = ${newPath} || substring("path" from ${Prisma.raw(String(node.path.length + 1))}),
          "dataRoomId" = ${newParent.dataRoomId}
      WHERE "path" LIKE ${node.path + '%'} AND "id" <> ${node.id}
    `;
    const row = await this.tx.node.update({
      where: { id: node.id },
      data: {
        parentId: newParent.id,
        name: newName,
        path: newPath,
        dataRoomId: newParent.dataRoomId,
      },
      include: withOwner,
    });
    return toNodeRecord(row);
  }

  async delete(id: string): Promise<void> {
    await this.tx.node.delete({ where: { id } });
  }

  async setLatestVersionMeta(id: string, size: bigint, mimeType: string): Promise<void> {
    await this.tx.node.update({ where: { id }, data: { size, mimeType } });
  }

  /** §2.3 — one UPDATE applies the delta and bumps updatedAt on every ancestor. */
  async applyRollup(ancestorIds: string[], sizeDelta: bigint, countDelta: number): Promise<void> {
    if (ancestorIds.length === 0) return;
    await this.tx.$executeRaw`
      UPDATE "Node"
      SET "size" = "size" + ${sizeDelta},
          "itemCount" = "itemCount" + ${countDelta},
          "updatedAt" = now()
      WHERE "id" = ANY(${ancestorIds}::text[])
    `;
  }

  async subtreeTotals(pathPrefix: string): Promise<SubtreeTotals> {
    const [row] = await this.tx.$queryRaw<{ files: bigint; folders: bigint; size: bigint | null }[]>`
      SELECT
        count(*) FILTER (WHERE "type" = 'FILE')   AS files,
        count(*) FILTER (WHERE "type" = 'FOLDER') AS folders,
        coalesce(sum("size") FILTER (WHERE "type" = 'FILE'), 0) AS size
      FROM "Node"
      WHERE "path" LIKE ${pathPrefix + '%'} AND "path" <> ${pathPrefix}
    `;
    return {
      files: Number(row?.files ?? 0),
      folders: Number(row?.folders ?? 0),
      size: BigInt(row?.size ?? 0),
    };
  }

  async subtreeMaxDepth(pathPrefix: string): Promise<number> {
    const [row] = await this.tx.$queryRaw<{ depth: number | null }[]>`
      SELECT max(array_length(string_to_array(trim(both '/' from "path"), '/'), 1)) AS depth
      FROM "Node"
      WHERE "path" LIKE ${pathPrefix + '%'}
    `;
    return row?.depth ?? 0;
  }

  async subtreeStorageKeys(pathPrefix: string): Promise<string[]> {
    const rows = await this.tx.$queryRaw<{ storageKey: string }[]>`
      SELECT v."storageKey"
      FROM "FileVersion" v
      JOIN "Node" n ON n."id" = v."nodeId"
      WHERE n."path" LIKE ${pathPrefix + '%'}
    `;
    return rows.map((r) => r.storageKey);
  }

  async ownedDataRoomIds(ownerId: string): Promise<string[]> {
    const rows = await this.tx.node.findMany({
      where: { ownerId, type: 'DATAROOM' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  // ---- spec 003 §2 ----------------------------------------------------

  async findTrashRoot(ownerId: string): Promise<NodeRecord | null> {
    const row = await this.tx.node.findFirst({
      where: { ownerId, type: 'TRASH' },
      include: withOwner,
    });
    return row ? toNodeRecord(row) : null;
  }

  /** §2.5 — only direct children; anything deeper travelled inside a folder. */
  async listTrashItems(trashId: string, opts: ListOptions): Promise<NodeRecord[]> {
    const rows = await this.tx.node.findMany({
      where: { parentId: trashId, deletedAt: { not: null } },
      include: withOwner,
      orderBy: [{ deletedAt: opts.dir === 'asc' ? 'asc' : 'desc' }, { id: 'desc' }],
      take: opts.limit,
      ...(opts.cursor ? { cursor: { id: opts.cursor.id }, skip: 1 } : {}),
    });
    return rows.map(toNodeRecord);
  }

  async setTrashState(
    id: string,
    state: {
      previousParentId: string | null;
      previousName: string | null;
      deletedFromLabel: string | null;
    },
  ): Promise<void> {
    await this.tx.node.update({ where: { id }, data: state });
  }

  /** §2.1 — one UPDATE for the whole subtree, alongside the path rewrite. */
  async setSubtreeDeletedAt(pathPrefix: string, deletedAt: Date | null): Promise<void> {
    await this.tx.node.updateMany({
      where: { path: { startsWith: pathPrefix } },
      data: { deletedAt },
    });
  }

  async expiredTrashedNodes(before: Date, limit: number): Promise<NodeRecord[]> {
    const rows = await this.tx.node.findMany({
      // previousParentId marks the restorable/purgeable unit (§2.1).
      where: { deletedAt: { not: null, lt: before }, previousParentId: { not: null } },
      include: withOwner,
      orderBy: { deletedAt: 'asc' },
      take: limit,
    });
    return rows.map(toNodeRecord);
  }

  // ---- internals -------------------------------------------------------

  /**
   * §4.3 — cursor pagination as a row-value comparison over
   * `(typeRank, sortKey, id)`. No OFFSET anywhere.
   */
  private async listWhere(where: Prisma.Sql, opts: ListOptions): Promise<NodeRecord[]> {
    const rank = Prisma.sql`(CASE WHEN "type" = 'FILE' THEN 1 ELSE 0 END)`;
    const key = Prisma.raw(sortKeySql(opts.sort === 'deletedAt' ? 'updatedAt' : opts.sort));
    const direction = opts.dir === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const comparison = opts.dir === 'desc' ? Prisma.sql`<` : Prisma.sql`>`;

    // §2.8 — one predicate hides a deleted folder and everything inside it.
    const excludeClause = opts.excludeDeleted
      ? Prisma.sql`AND "deletedAt" IS NULL`
      : opts.onlyDeleted
        ? Prisma.sql`AND "deletedAt" IS NOT NULL`
        : Prisma.empty;

    const cursorClause = opts.cursor
      ? Prisma.sql`AND (${rank}, ${key}, "id") ${comparison} (${opts.cursor.typeRank}, ${opts.cursor.sortKey}, ${opts.cursor.id})`
      : Prisma.empty;

    const rows = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Node"
      WHERE ${where} ${excludeClause} ${cursorClause}
      ORDER BY ${rank} ${direction}, ${key} ${direction}, "id" ${direction}
      LIMIT ${opts.limit}
    `;

    // Re-read with the owner relation, preserving the SQL ordering.
    const records = await this.findByIds(rows.map((r) => r.id));
    const byId = new Map(records.map((r) => [r.id, r]));
    return rows.map((r) => byId.get(r.id)).filter((n): n is NodeRecord => Boolean(n));
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
