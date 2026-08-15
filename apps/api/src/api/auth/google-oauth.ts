import { Injectable } from '@nestjs/common';
import { DomainError } from '../../domain/errors';

type GoogleProfile = { googleId: string; email: string; name: string };

/**
 * §3.4 — Google OAuth, wired but inert when credentials are absent, so the app
 * runs locally with email/password alone.
 */
@Injectable()
export class GoogleOAuth {
  private readonly clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  private readonly callbackUrl =
    process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:3001/api/v1/auth/google/callback';

  get isConfigured(): boolean {
    return this.clientId !== '' && this.clientSecret !== '';
  }

  authorizationUrl(state = '/'): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchange(code: string): Promise<GoogleProfile> {
    if (!code) throw DomainError.validation('Missing authorization code');

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.callbackUrl,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResponse.ok) {
      throw new DomainError('INVALID_CREDENTIALS', 'Google sign-in failed');
    }
    const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!profileResponse.ok) {
      throw new DomainError('INVALID_CREDENTIALS', 'Google sign-in failed');
    }
    const profile = (await profileResponse.json()) as {
      sub: string;
      email: string;
      name?: string;
      email_verified?: boolean;
    };

    if (!profile.email) throw new DomainError('INVALID_CREDENTIALS', 'Google account has no email');
    return { googleId: profile.sub, email: profile.email, name: profile.name ?? profile.email };
  }
}
