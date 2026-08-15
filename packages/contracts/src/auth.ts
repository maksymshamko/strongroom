import { z } from 'zod';

/** §3.2 */
export const loginRequestSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

/**
 * spec 003 §1.1 — identity only. Password and Google state describe the
 * account's security posture and live behind GET /account/security instead of
 * riding on every authenticated response.
 */
export type UserDto = {
  id: string;
  email: string;
  name: string;
};

export type SessionResponse = { user: UserDto };

export const SESSION_COOKIE = 'dr_session';
export const ANON_COOKIE = 'dr_anon';
/** §3.1 */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** §3.3 */
export const LOGIN_RATE_LIMIT = { attempts: 10, windowSeconds: 15 * 60 };
