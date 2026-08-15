import { LOGIN_RATE_LIMIT } from '@dataroom/contracts';
import { DomainError } from '../domain/errors';
import type { Clock, PasswordHasher, TokenIssuer } from './ports/services';
import type { UnitOfWork, UserRecord } from './ports/repositories';

export type AuthResult = { user: UserRecord; token: string };

export class AuthService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenIssuer,
    private readonly clock: Clock,
  ) {}

  // §3.2, §3.3
  async login(email: string, password: string): Promise<AuthResult> {
    const normalized = email.trim().toLowerCase();
    const since = new Date(this.clock.now().getTime() - LOGIN_RATE_LIMIT.windowSeconds * 1000);

    const user = await this.uow.read(async (repos) => {
      const failures = await repos.users.countFailedLogins(normalized, since);
      if (failures >= LOGIN_RATE_LIMIT.attempts) {
        throw new DomainError('RATE_LIMITED', 'Too many attempts. Try again later.');
      }
      return repos.users.findByEmail(normalized);
    });

    // Unknown email, wrong password, and password login against a Google-only
    // account are deliberately indistinguishable (§3.3) — including in timing.
    const ok =
      user?.passwordHash != null && (await this.hasher.verify(password, user.passwordHash));

    if (!ok) {
      if (user?.passwordHash == null) await this.hasher.fakeVerify();
      await this.uow.read(async (repos) => repos.users.recordFailedLogin(normalized));
      throw new DomainError('INVALID_CREDENTIALS', 'Email or password is incorrect');
    }

    await this.uow.run(async (repos) => {
      await repos.users.clearFailedLogins(normalized);
      // §3.5 — idempotent, so it runs on every auth rather than behind a flag.
      await repos.users.linkPendingGrants(user.id, user.email);
    });

    return { user, token: this.tokens.sign({ sub: user.id, email: user.email }) };
  }

  // §3.4 — match by googleId, then by email, else create.
  async loginWithGoogle(profile: {
    googleId: string;
    email: string;
    name: string;
  }): Promise<AuthResult> {
    const email = profile.email.trim().toLowerCase();

    const user = await this.uow.run(async (repos) => {
      const byGoogle = await repos.users.findByGoogleId(profile.googleId);
      if (byGoogle) return byGoogle;

      const byEmail = await repos.users.findByEmail(email);
      if (byEmail) {
        // §15.3 — MVP links by verified email, matching 001's grant-linking posture.
        await repos.users.setGoogleId(byEmail.id, profile.googleId);
        return { ...byEmail, googleId: profile.googleId };
      }

      return repos.users.create({
        email,
        name: profile.name || email,
        passwordHash: null,
        googleId: profile.googleId,
      });
    });

    await this.uow.run(async (repos) => repos.users.linkPendingGrants(user.id, user.email));
    return { user, token: this.tokens.sign({ sub: user.id, email: user.email }) };
  }

  async me(userId: string): Promise<UserRecord> {
    const user = await this.uow.read(async (repos) => repos.users.findById(userId));
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Session no longer valid');
    return user;
  }
}
