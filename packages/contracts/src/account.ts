import { z } from 'zod';

/** §8.6 — design §9.1/§9.2 copy: "At least 12 characters". */
export const MIN_PASSWORD_LENGTH = 12;

export const setPasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200).optional(),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});

/** spec 003 §1.2 — account-scoped; never describes another user. */
export type AccountSecurityDto = {
  hasPassword: boolean;
  google: { connected: boolean; email: string | null };
};

export type AccountDeletePreviewDto = {
  dataRooms: number;
  documents: number;
  collaborators: number;
  email: string;
};

export const deleteAccountSchema = z.object({
  confirmEmail: z.string().email().transform((e) => e.toLowerCase()),
});
