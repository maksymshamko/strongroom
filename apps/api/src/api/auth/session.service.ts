import { Inject, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from '@dataroom/contracts';
import { TOKEN_ISSUER } from '../../application/ports/tokens';
import type { SessionClaims, TokenIssuer } from '../../application/ports/services';

/** §3.1 — the session cookie's shape lives here, in the interface layer. */
@Injectable()
export class SessionService {
  constructor(@Inject(TOKEN_ISSUER) private readonly tokens: TokenIssuer) {}

  sign(claims: SessionClaims): string {
    return this.tokens.sign(claims);
  }

  verify(token: string): SessionClaims | null {
    return this.tokens.verify(token);
  }

  attach(response: Response, token: string): void {
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_TTL_SECONDS * 1000,
      path: '/',
    });
  }

  clear(response: Response): void {
    response.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}
