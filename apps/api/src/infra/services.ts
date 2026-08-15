import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { SESSION_TTL_SECONDS } from '@dataroom/contracts';
import type {
  Clock,
  IdGenerator,
  PasswordHasher,
  SessionClaims,
  TokenIssuer,
} from '../application/ports/services';

const BCRYPT_COST = 12;
/** Pre-computed hash of a throwaway value, used only to burn time (§3.3). */
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

export class BcryptPasswordHasher implements PasswordHasher {
  constructor(private readonly cost: number = BCRYPT_COST) {}

  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.cost);
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /**
   * §3.3 — an unknown email must not answer faster than a wrong password, or the
   * timing itself enumerates accounts.
   */
  async fakeVerify(): Promise<void> {
    await bcrypt.compare('dummy-password-for-timing', DUMMY_HASH);
  }
}

export class JwtTokenIssuer implements TokenIssuer {
  constructor(private readonly secret: string) {}

  sign(claims: SessionClaims): string {
    return jwt.sign(claims, this.secret, { expiresIn: SESSION_TTL_SECONDS, algorithm: 'HS256' });
  }

  verify(token: string): SessionClaims | null {
    try {
      const payload = jwt.verify(token, this.secret, { algorithms: ['HS256'] });
      if (typeof payload === 'string') return null;
      const { sub, email } = payload as jwt.JwtPayload & { email?: string };
      if (typeof sub !== 'string' || typeof email !== 'string') return null;
      return { sub, email };
    } catch {
      return null;
    }
  }

  randomToken(bytes: number): string {
    return randomBytes(bytes).toString('base64url').slice(0, 32);
  }
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  set(date: Date): void {
    this.current = date;
  }
}

export class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
