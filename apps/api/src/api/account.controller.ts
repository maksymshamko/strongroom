import { Body, Controller, Delete, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  deleteAccountSchema,
  setPasswordSchema,
  type AccountSecurityDto,
} from '@dataroom/contracts';
import { AccountService } from '../application/account.service';
import { CurrentUserId } from './auth/viewer';
import { SessionService } from './auth/session.service';
import { GoogleOAuth } from './auth/google-oauth';
import { DomainError } from '../domain/errors';

// §8.6
@Controller('account')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly sessions: SessionService,
    private readonly google: GoogleOAuth,
  ) {}

  // spec 003 §1.2
  @Get('security')
  async security(@CurrentUserId() userId: string): Promise<AccountSecurityDto> {
    return this.account.security(userId);
  }

  // spec 003 §1.4 — starts the link flow; the shared callback finishes it.
  @Get('google/link')
  startGoogleLink(@Res() res: Response) {
    if (!this.google.isConfigured) {
      throw DomainError.validation('Google sign-in is not configured on this server');
    }
    res.redirect(this.google.authorizationUrl('/account'));
  }

  // spec 003 §1.5
  @Delete('google')
  @HttpCode(204)
  async unlinkGoogle(@CurrentUserId() userId: string) {
    await this.account.unlinkGoogle(userId);
  }

  @Post('password')
  @HttpCode(204)
  async setPassword(@CurrentUserId() userId: string, @Body() body: unknown) {
    const input = setPasswordSchema.parse(body);
    await this.account.setPassword(userId, input);
  }

  @Get('delete-preview')
  async deletePreview(@CurrentUserId() userId: string) {
    return this.account.deletePreview(userId);
  }

  @Delete()
  @HttpCode(204)
  async deleteAccount(
    @CurrentUserId() userId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { confirmEmail } = deleteAccountSchema.parse(body);
    await this.account.deleteAccount(userId, confirmEmail);
    this.sessions.clear(res);
  }
}
