import { z } from 'zod';
import { filterableNodeTypeSchema, listQuerySchema } from './primitives';
import type { NodeDto } from './nodes';

/**
 * Query params may repeat (`?type=FILE&type=FOLDER`); Express gives a string for
 * one and an array for many. Both normalize to an array here.
 */
const repeatable = <T extends z.ZodTypeAny>(inner: T) =>
  z
    .union([inner, z.array(inner)])
    .optional()
    .transform((v): z.infer<T>[] | undefined =>
      v === undefined ? undefined : Array.isArray(v) ? (v as z.infer<T>[]) : [v as z.infer<T>],
    );

/** §8.5 GET /nodes/{id}/search — subtree search within a data room or folder. */
export const searchQuerySchema = listQuerySchema.extend({
  q: z.string().trim().max(255).optional(),
  type: repeatable(filterableNodeTypeSchema),
  mimeType: repeatable(z.string().min(1)),
  minSize: z.coerce.number().int().nonnegative().optional(),
  maxSize: z.coerce.number().int().nonnegative().optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  updatedFrom: z.coerce.date().optional(),
  updatedTo: z.coerce.date().optional(),
});
export type SearchQuery = z.input<typeof searchQuerySchema>;

/** §8.5 — pathLabel is the human folder trail, truncated per §5.5. */
export type SearchResultDto = NodeDto & { pathLabel: string };
