import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { loginRequestSchema } from '@dataroom/contracts';
import { AuthService } from '../application/auth.service';
import { DomainError } from '../domain/errors';
import { CurrentUserId, CurrentViewer, Public } from './auth/viewer';
import { AccountService } from '../application/account.service';
import type { Viewer } from '../application/access.service';
import { SessionService } from './auth/session.service';
import { userDto } from './dto';
import { GoogleOAuth } from './auth/google-oauth';

// §3.2
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly google: GoogleOAuth,
    private readonly account: AccountService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { email, password } = loginRequestSchema.parse(body);
    const { user, token } = await this.auth.login(email, password);
    this.sessions.attach(res, token);
    return { user: userDto(user) };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    this.sessions.clear(res);
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUserId() userId: string) {
    return { user: userDto(await this.auth.me(userId)) };
  }

  @Public()
  @Get('google')
  startGoogle(@Res() res: Response) {
    if (!this.google.isConfigured) {
      throw DomainError.validation('Google sign-in is not configured on this server');
    }
    res.redirect(this.google.authorizationUrl());
  }

  @Public()
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @CurrentViewer() viewer: Viewer,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!this.google.isConfigured) {
      throw DomainError.validation('Google sign-in is not configured on this server');
    }
    const profile = await this.google.exchange(code);

    // spec 003 §1.4 — one callback, two meanings: with a session it links the
    // identity to the account already signed in; without one it signs in.
    if (viewer.userId) {
      await this.account.linkGoogle(viewer.userId, profile);
    } else {
      const { token } = await this.auth.loginWithGoogle(profile);
      this.sessions.attach(res, token);
    }

    const next = typeof req.query.state === 'string' && req.query.state.startsWith('/')
      ? req.query.state
      : '/';
    res.redirect(`${process.env.WEB_URL ?? 'http://localhost:3000'}${next}`);
  }
}
