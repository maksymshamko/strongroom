/** Small supporting ports — each exists to keep a driver out of `application/`. */

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
  /**
   * Burns roughly the same time as a real verification, so a login against an
   * unknown email cannot be distinguished by timing (§3.3).
   */
  fakeVerify(): Promise<void>;
}

export type SessionClaims = { sub: string; email: string };

export interface TokenIssuer {
  sign(claims: SessionClaims): string;
  verify(token: string): SessionClaims | null;
  /** §8.3 — opaque public-link token. */
  randomToken(bytes: number): string;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  /** Ids are minted before insert because `path` embeds the node's own id (§2.2). */
  next(): string;
}
