import { randomUUID } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ANON_COOKIE, SESSION_COOKIE } from '@dataroom/contracts';
import { DomainError } from '../../domain/errors';
import type { Viewer } from '../../application/access.service';
import { SessionService } from './session.service';

export const IS_PUBLIC = 'dr:public';

/** §8.4 — public share routes read an optional session but never require one. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

type RequestWithViewer = Request & { viewer?: Viewer };

function readViewer(request: RequestWithViewer, sessions: SessionService, response: Response): Viewer {
  const cookies = (request.cookies ?? {}) as Record<string, string | undefined>;
  const claims = cookies[SESSION_COOKIE] ? sessions.verify(cookies[SESSION_COOKIE]!) : null;

  // Anonymous viewers get a stable id so their public-link views can be logged
  // without identifying them (§8.4).
  let anonId = cookies[ANON_COOKIE] ?? null;
  if (!claims && !anonId) {
    anonId = randomUUID();
    response.cookie(ANON_COOKIE, anonId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }

  const token =
    (request.query?.t as string | undefined) ??
    (request.headers['x-share-token'] as string | undefined) ??
    (request.params?.token as string | undefined) ??
    null;

  return { userId: claims?.sub ?? null, token, anonId };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithViewer>();
    const response = context.switchToHttp().getResponse<Response>();
    request.viewer = readViewer(request, this.sessions, response);

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (!request.viewer.userId) {
      throw new DomainError('UNAUTHENTICATED', 'Sign in required');
    }
    return true;
  }
}

export const CurrentViewer = createParamDecorator((_data: unknown, context: ExecutionContext): Viewer => {
  const request = context.switchToHttp().getRequest<RequestWithViewer>();
  return request.viewer ?? { userId: null, token: null, anonId: null };
});

export const CurrentUserId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest<RequestWithViewer>();
  if (!request.viewer?.userId) throw new DomainError('UNAUTHENTICATED', 'Sign in required');
  return request.viewer.userId;
});
