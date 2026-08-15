import { z } from 'zod';

/** §4.2 error envelope — every non-2xx response body has this shape. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'INVALID_CREDENTIALS',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'NAME_CONFLICT',
  'INVALID_MOVE',
  'UPLOAD_VERIFICATION_FAILED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'PASSWORD_REQUIRED',
  'IDENTITY_CONFLICT',
  'RESTORE_TARGET_MISSING',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** §4.2 — the HTTP status each code maps to. Single source of truth for the filter. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NAME_CONFLICT: 409,
  INVALID_MOVE: 409,
  UPLOAD_VERIFICATION_FAILED: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  // spec 003 §1.6, §2.6
  PASSWORD_REQUIRED: 409,
  IDENTITY_CONFLICT: 409,
  RESTORE_TARGET_MISSING: 409,
  INTERNAL: 500,
};

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/** §6.4 — details carried by NAME_CONFLICT so the client can render the dialog. */
export type NameConflictDetails = {
  conflictingNodeId: string;
  conflictingNodeType: 'DATAROOM' | 'FOLDER' | 'FILE';
  suggestedName: string;
  /** false when the pair is not FILE+FILE — only keep-both/cancel apply (§6.1). */
  versioningAvailable: boolean;
};
