import type {
  FileVersionRecord,
  PendingUploadRecord,
  UploadRepository,
} from '../../application/ports/repositories';
import { toVersionRecord } from './mappers';
import type { Tx } from './unit-of-work';

const withCreator = { createdBy: { select: { name: true } } } as const;

export class PrismaUploadRepository implements UploadRepository {
  constructor(private readonly tx: Tx) {}

  async create(record: PendingUploadRecord): Promise<PendingUploadRecord> {
    return this.tx.pendingUpload.create({ data: record });
  }

  async findById(id: string): Promise<PendingUploadRecord | null> {
    return this.tx.pendingUpload.findUnique({ where: { id } });
  }

  async delete(id: string): Promise<void> {
    await this.tx.pendingUpload.delete({ where: { id } }).catch(() => undefined);
  }

  async nextVersionNumber(nodeId: string): Promise<number> {
    const latest = await this.tx.fileVersion.findFirst({
      where: { nodeId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    return (latest?.versionNumber ?? 0) + 1;
  }

  async latestVersion(nodeId: string): Promise<FileVersionRecord | null> {
    const row = await this.tx.fileVersion.findFirst({
      where: { nodeId },
      orderBy: { versionNumber: 'desc' },
      include: withCreator,
    });
    return row ? toVersionRecord(row) : null;
  }

  async versionByNumber(nodeId: string, versionNumber: number): Promise<FileVersionRecord | null> {
    const row = await this.tx.fileVersion.findUnique({
      where: { nodeId_versionNumber: { nodeId, versionNumber } },
      include: withCreator,
    });
    return row ? toVersionRecord(row) : null;
  }

  async listVersions(nodeId: string): Promise<FileVersionRecord[]> {
    const rows = await this.tx.fileVersion.findMany({
      where: { nodeId },
      orderBy: { versionNumber: 'desc' },
      include: withCreator,
    });
    return rows.map(toVersionRecord);
  }

  async createVersion(input: {
    id: string;
    nodeId: string;
    storageKey: string;
    size: bigint;
    mimeType: string;
    checksum: string | null;
    versionNumber: number;
    createdById: string;
  }): Promise<FileVersionRecord> {
    const row = await this.tx.fileVersion.create({ data: input, include: withCreator });
    return toVersionRecord(row);
  }

  /** §6.4 — transplanting A's content into B keeps the object, moves the row. */
  async moveVersion(versionId: string, toNodeId: string, versionNumber: number): Promise<void> {
    await this.tx.fileVersion.update({
      where: { id: versionId },
      data: { nodeId: toNodeId, versionNumber },
    });
  }

  /** Returns the storage keys freed, for the post-commit purge (§10.2). */
  async deleteVersions(nodeId: string): Promise<string[]> {
    const rows = await this.tx.fileVersion.findMany({
      where: { nodeId },
      select: { storageKey: true },
    });
    await this.tx.fileVersion.deleteMany({ where: { nodeId } });
    return rows.map((r) => r.storageKey);
  }

  async deleteVersionsExcept(nodeId: string, keepVersionId: string): Promise<string[]> {
    const rows = await this.tx.fileVersion.findMany({
      where: { nodeId, id: { not: keepVersionId } },
      select: { storageKey: true },
    });
    await this.tx.fileVersion.deleteMany({ where: { nodeId, id: { not: keepVersionId } } });
    return rows.map((r) => r.storageKey);
  }
}
