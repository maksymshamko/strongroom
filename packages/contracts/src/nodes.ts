import { z } from 'zod';
import {
  conflictResolutionSchema,
  idSchema,
  listQuerySchema,
  nodeNameSchema,
  nodeTypeSchema,
  type NodeType,
} from './primitives';

/** §4.4 node representation. `size` is a stringified BigInt. */
export type NodeDto = {
  id: string;
  parentId: string | null;
  type: NodeType;
  name: string;
  size: string;
  itemCount: number;
  mimeType: string | null;
  dataRoomId: string;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
  isShared: boolean;
  viewerRole: 'OWNER' | 'VIEWER';
};

export type BreadcrumbSegment = { id: string; name: string; type: NodeType };

/** §8.1 GET /nodes/{id} */
export type NodeDetailResponse = { node: NodeDto; breadcrumb: BreadcrumbSegment[] };

/** §8.1 GET /shared-with-me */
export type SharedItemDto = NodeDto & {
  sharedByEmail: string;
  sharedAt: string;
  shareId: string;
};

/** §8.1 POST /data-rooms */
export const createDataRoomSchema = z.object({ name: nodeNameSchema });

/** §8.1 POST /nodes/folders */
export const createFolderSchema = z.object({
  parentId: idSchema,
  name: nodeNameSchema,
  onConflict: conflictResolutionSchema.optional(),
});

/** §8.1 PATCH /nodes/{id} */
export const renameNodeSchema = z.object({
  name: nodeNameSchema,
  onConflict: conflictResolutionSchema.optional(),
});

/** §8.1 POST /nodes/{id}/move */
export const moveNodeSchema = z.object({
  parentId: idSchema,
  onConflict: conflictResolutionSchema.optional(),
});

export const listChildrenQuerySchema = listQuerySchema;

/** §8.1 GET /nodes/{id}/delete-preview — drives the design's delete dialog. */
export type DeletePreviewDto = {
  nodeId: string;
  name: string;
  type: NodeType;
  contents: { files: number; folders: number; size: string };
  shareImpact: {
    peopleCount: number;
    activeLinkCount: number;
    people: { email: string; name: string | null }[];
  };
};

/** §8.1 GET /nodes/{id}/versions */
export type FileVersionDto = {
  id: string;
  versionNumber: number;
  size: string;
  mimeType: string;
  checksum: string | null;
  createdAt: string;
  createdById: string;
  createdByName: string;
};

/** §7.6 GET /nodes/{id}/content */
export const contentQuerySchema = z.object({
  version: z.coerce.number().int().positive().optional(),
  download: z.coerce.boolean().optional(),
});
export type ContentUrlResponse = {
  url: string;
  expiresAt: string;
  filename: string;
  mimeType: string;
};

export const nodeTypeValues = nodeTypeSchema.options;
