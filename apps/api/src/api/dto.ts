import type {
  BreadcrumbSegment,
  FileVersionDto,
  NodeDto,
  ShareGrantDto,
  UserDto,
} from '@dataroom/contracts';
import type {
  FileVersionRecord,
  NodeRecord,
  ShareGrantRecord,
  UserRecord,
} from '../application/ports/repositories';

/** §4.4 — the wire shape. `size` is a string; dates are ISO-8601. */
export function nodeDto(
  node: NodeRecord,
  opts: { canWrite: boolean; isShared?: boolean },
): NodeDto {
  return {
    id: node.id,
    parentId: node.parentId,
    type: node.type,
    name: node.name,
    size: node.size.toString(),
    itemCount: node.type === 'FILE' ? 0 : node.itemCount,
    mimeType: node.mimeType,
    dataRoomId: node.dataRoomId,
    ownerId: node.ownerId,
    ownerName: node.ownerName,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
    isShared: opts.isShared ?? false,
    viewerRole: opts.canWrite ? 'OWNER' : 'VIEWER',
  };
}

export function breadcrumbDto(chain: NodeRecord[]): BreadcrumbSegment[] {
  return chain.map((n) => ({ id: n.id, name: n.name, type: n.type }));
}

/** spec 003 §1.1 — identity only; security posture lives at /account/security. */
export function userDto(user: UserRecord): UserDto {
  return { id: user.id, email: user.email, name: user.name };
}

export function versionDto(version: FileVersionRecord): FileVersionDto {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    size: version.size.toString(),
    mimeType: version.mimeType,
    checksum: version.checksum,
    createdAt: version.createdAt.toISOString(),
    createdById: version.createdById,
    createdByName: version.createdByName,
  };
}

export function grantDto(grant: ShareGrantRecord & { name: string | null }): ShareGrantDto {
  return {
    id: grant.id,
    email: grant.email,
    // A pending invite is a claim on access, not a person with access — it is
    // rendered as a raw email, never a name (design §5.2).
    name: grant.userId ? grant.name : null,
    role: 'VIEWER',
    status: grant.userId ? 'ACCEPTED' : 'PENDING',
    invitedAt: grant.createdAt.toISOString(),
    acceptedAt: grant.acceptedAt?.toISOString() ?? null,
  };
}
