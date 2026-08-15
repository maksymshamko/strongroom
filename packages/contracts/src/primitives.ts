import { z } from 'zod'

/** §6.3 structural rules — name validation shared by create/rename/move/upload. */
export const MAX_NAME_LENGTH = 255
export const MAX_DEPTH = 32
/** §7.2 */
export const MAX_FILE_BYTES = 10n * 1024n * 1024n

const CONTROL_CHARS = /[\x00-\x1f]/

export const nodeNameSchema = z
  .string()
  .transform((s) => s.normalize('NFC').trim())
  .refine((s) => s.length > 0, { message: 'Name may not be empty' })
  .refine((s) => s.length <= MAX_NAME_LENGTH, {
    message: `Name may not exceed ${MAX_NAME_LENGTH} characters`,
  })
  .refine((s) => !s.includes('/'), { message: 'Name may not contain "/"' })
  .refine((s) => !CONTROL_CHARS.test(s), {
    message: 'Name may not contain control characters',
  })
  .refine((s) => s !== '.' && s !== '..', {
    message: 'Name may not be "." or ".."',
  })

export const idSchema = z.string().uuid()

/** §4.1 — BigInt sizes are transported as decimal strings. */
export const byteSizeSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform((v) => BigInt(v))

/** TRASH is spec 003 §2.1 — a per-user root; it is never a search or filter target. */
export const nodeTypeSchema = z.enum(['DATAROOM', 'FOLDER', 'FILE', 'TRASH'])

/** The types a user can actually filter by (§8.5) — TRASH is not one of them. */
export const filterableNodeTypeSchema = z.enum(['DATAROOM', 'FOLDER', 'FILE'])
export type NodeType = z.infer<typeof nodeTypeSchema>

/** §6.4 conflict protocol. */
export const conflictResolutionSchema = z.enum([
  'KEEP_BOTH',
  'NEW_VERSION',
  'REPLACE',
])
export type ConflictResolution = z.infer<typeof conflictResolutionSchema>

/** §4.3 pagination. */
export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const sortSchema = z.object({
  sort: z.enum(['name', 'size', 'updatedAt']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
})

export const listQuerySchema = paginationSchema.merge(sortSchema)
export type ListQuery = z.input<typeof listQuerySchema>

export type Page<T> = { items: T[]; nextCursor: string | null }
