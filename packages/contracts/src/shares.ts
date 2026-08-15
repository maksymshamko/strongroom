import { z } from 'zod';
import { idSchema } from './primitives';

/** §8.3 */
export type ShareGrantDto = {
  id: string;
  email: string;
  name: string | null;
  role: 'VIEWER';
  status: 'ACCEPTED' | 'PENDING';
  invitedAt: string;
  acceptedAt: string | null;
};

export type ShareStateDto = {
  link: { shareId: string; token: string; url: string; createdAt: string } | null;
  grants: ShareGrantDto[];
  /** §8.3 — design §5.2 "Access inherits from …". Null when the share is on this node. */
  inheritedFrom: { nodeId: string; name: string } | null;
};

export const addPeopleSchema = z.object({
  emails: z
    .array(z.string().email().transform((e) => e.toLowerCase()))
    .min(1)
    .max(50),
});

export type CreateLinkResponse = {
  shareId: string;
  token: string;
  url: string;
};

/** §8.4 public link resolution */
export type PublicShareResponse = {
  node: import('./nodes').NodeDto;
  breadcrumb: import('./nodes').BreadcrumbSegment[];
  share: { mode: 'PUBLIC_LINK'; nodeId: string };
};

export const shareTokenParamSchema = z.string().min(16).max(64);
export const shareIdParamSchema = idSchema;
export const SHARE_TOKEN_BYTES = 24;
