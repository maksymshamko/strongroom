import type { FileVersionRecord, NodeRecord } from '../../application/ports/repositories';
import type { NodeType } from '../../domain/node-type';

type NodeRow = {
  id: string;
  parentId: string | null;
  type: string;
  name: string;
  path: string;
  dataRoomId: string;
  size: bigint;
  itemCount: number;
  mimeType: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  previousParentId?: string | null;
  previousName?: string | null;
  deletedFromLabel?: string | null;
  owner?: { name: string } | null;
};

/** Prisma row → port-shaped record. Driver types stop here (§1.3). */
export function toNodeRecord(row: NodeRow): NodeRecord {
  return {
    id: row.id,
    parentId: row.parentId,
    type: row.type as NodeType,
    name: row.name,
    path: row.path,
    dataRoomId: row.dataRoomId,
    size: row.size,
    itemCount: row.itemCount,
    mimeType: row.mimeType,
    ownerId: row.ownerId,
    ownerName: row.owner?.name ?? '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null,
    previousParentId: row.previousParentId ?? null,
    previousName: row.previousName ?? null,
    deletedFromLabel: row.deletedFromLabel ?? null,
  };
}

type VersionRow = {
  id: string;
  nodeId: string;
  storageKey: string;
  size: bigint;
  mimeType: string;
  checksum: string | null;
  versionNumber: number;
  createdAt: Date;
  createdById: string;
  createdBy?: { name: string } | null;
};

export function toVersionRecord(row: VersionRow): FileVersionRecord {
  return {
    id: row.id,
    nodeId: row.nodeId,
    storageKey: row.storageKey,
    size: row.size,
    mimeType: row.mimeType,
    checksum: row.checksum,
    versionNumber: row.versionNumber,
    createdAt: row.createdAt,
    createdById: row.createdById,
    createdByName: row.createdBy?.name ?? '',
  };
}
