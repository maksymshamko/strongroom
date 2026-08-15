import { z } from 'zod';
import {
  byteSizeSchema,
  conflictResolutionSchema,
  idSchema,
  nodeNameSchema,
} from './primitives';

/**
 * §7.2 allow-list. Anything outside this set is 415 UNSUPPORTED_MEDIA_TYPE.
 *
 * The MVP accepts PDF only: it is the one format the in-app viewer (§11.5)
 * renders, so anything else would land in a room as a file nobody can read
 * without downloading it. The list stays an array so widening it later is a
 * one-line change rather than a change of shape.
 */
export const ALLOWED_MIME_TYPES = ['application/pdf'] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** File extensions matching {@link ALLOWED_MIME_TYPES}, for `<input accept>`. */
export const ALLOWED_FILE_EXTENSIONS = ['.pdf'] as const;

/** §7.1 step 1 */
export const initUploadSchema = z.object({
  parentId: idSchema,
  name: nodeNameSchema,
  size: byteSizeSchema,
  mimeType: z.string().min(1),
});

export type InitUploadResponse = {
  uploadId: string;
  storageKey: string;
  signedUrl: string;
  expiresAt: string;
  /** §7.3 — advisory; the authoritative check happens at complete. */
  conflict?: { conflictingNodeId: string; suggestedName: string; versioningAvailable: boolean };
};

/** §7.1 step 3 */
export const completeUploadSchema = z.object({
  checksum: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  onConflict: conflictResolutionSchema.optional(),
});

/** §7.2 — signed upload URL lifetime. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
/** §7.6 — signed download URL lifetime. */
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
