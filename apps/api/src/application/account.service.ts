import { MIN_PASSWORD_LENGTH } from '@dataroom/contracts';
import { DomainError } from '../domain/errors';
import type { PasswordHasher } from './ports/services';
import type { Repositories, UnitOfWork } from './ports/repositories';
import type { StorageCleanup } from './storage-cleanup';

export class AccountService {
  /**
   * The Google address is not stored on `User` (only `googleId` is), so it is
   * remembered in-process purely to label the settings screen. A restart simply
   * falls back to the account email — display detail, never authorization.
   */
  private readonly googleEmails = new Map<string, string>();

  constructor(
    private readonly uow: UnitOfWork,
    private readonly hasher: PasswordHasher,
    private readonly cleanup: StorageCleanup,
  ) {}

  private async requireUser(repos: Repositories, userId: string) {
    const user = await repos.users.findById(userId);
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Session no longer valid');
    return user;
  }

  // §8.6 POST /account/password
  async setPassword(
    userId: string,
    input: { currentPassword?: string; newPassword: string },
  ): Promise<void> {
    if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
      throw DomainError.validation(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const user = await this.uow.read(async (repos) => repos.users.findById(userId));
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Session no longer valid');

    if (user.passwordHash !== null) {
      // §8.6 — required when the account has a password; the "add a password"
      // variant for Google-only accounts has nothing to confirm against.
      if (!input.currentPassword) {
        throw DomainError.validation('Current password is required');
      }
      if (!(await this.hasher.verify(input.currentPassword, user.passwordHash))) {
        throw new DomainError('INVALID_CREDENTIALS', 'Current password is incorrect');
      }
    }

    const hash = await this.hasher.hash(input.newPassword);
    await this.uow.run(async (repos) => repos.users.setPasswordHash(userId, hash));
  }

  // spec 003 §1.2 — GET /account/security
  async security(userId: string) {
    return this.uow.read(async (repos) => {
      const user = await this.requireUser(repos, userId);
      const googleEmail = user.googleId ? (this.googleEmails.get(user.id) ?? user.email) : null;
      return {
        hasPassword: user.passwordHash !== null,
        google: { connected: user.googleId !== null, email: user.googleId ? googleEmail : null },
      };
    });
  }

  /**
   * spec 003 §1.4 — links a Google identity to an already signed-in account.
   * A Google identity belongs to exactly one account and is not transferable.
   */
  async linkGoogle(
    userId: string,
    profile: { googleId: string; email: string; name: string },
  ): Promise<void> {
    await this.uow.run(async (repos) => {
      const user = await this.requireUser(repos, userId);

      if (user.googleId && user.googleId !== profile.googleId) {
        throw new DomainError(
          'IDENTITY_CONFLICT',
          'This account already has a Google account linked. Unlink it first.',
        );
      }

      const owner = await repos.users.findByGoogleId(profile.googleId);
      if (owner && owner.id !== userId) {
        throw new DomainError(
          'IDENTITY_CONFLICT',
          'That Google account is already linked to another account.',
        );
      }

      await repos.users.setGoogleId(userId, profile.googleId);
    });

    // The Google address may differ from the account address (§1.4); remembered
    // for display only, so the settings screen can name what is connected.
    this.googleEmails.set(userId, profile.email.toLowerCase());
  }

  /**
   * spec 003 §1.5 — unlinking must never leave an account with no way back in.
   */
  async unlinkGoogle(userId: string): Promise<void> {
    await this.uow.run(async (repos) => {
      const user = await this.requireUser(repos, userId);

      if (!user.googleId) throw DomainError.notFound('Google account');
      if (user.passwordHash === null) {
        throw new DomainError(
          'PASSWORD_REQUIRED',
          'Set a password before unlinking Google, or you will not be able to sign in.',
        );
      }

      await repos.users.clearGoogleId(userId);
    });
    this.googleEmails.delete(userId);
  }

  // §8.6 GET /account/delete-preview
  async deletePreview(userId: string) {
    return this.uow.read(async (repos) => {
      const user = await repos.users.findById(userId);
      if (!user) throw new DomainError('UNAUTHENTICATED', 'Session no longer valid');

      const roomIds = await repos.nodes.ownedDataRoomIds(userId);
      let documents = 0;
      for (const roomId of roomIds) {
        const room = await repos.nodes.findById(roomId);
        if (!room) continue;
        documents += (await repos.nodes.subtreeTotals(room.path)).files;
      }

      return {
        dataRooms: roomIds.length,
        documents,
        collaborators: await repos.shares.countCollaborators(userId),
        email: user.email,
      };
    });
  }

  // §8.6 DELETE /account
  async deleteAccount(userId: string, confirmEmail: string): Promise<void> {
    const keys = await this.uow.run(async (repos) => {
      const user = await repos.users.findById(userId);
      if (!user) throw new DomainError('UNAUTHENTICATED', 'Session no longer valid');

      if (confirmEmail.trim().toLowerCase() !== user.email) {
        throw DomainError.validation('The email you typed does not match this account');
      }

      // Collected before the cascade, since the rows disappear with the user.
      const roomIds = await repos.nodes.ownedDataRoomIds(userId);
      const storageKeys: string[] = [];
      for (const roomId of roomIds) {
        const room = await repos.nodes.findById(roomId);
        if (room) storageKeys.push(...(await repos.nodes.subtreeStorageKeys(room.path)));
      }

      // Cascades to nodes, versions, shares and grants (§2.1 onDelete: Cascade).
      await repos.users.delete(userId);
      return storageKeys;
    });

    await this.cleanup.purge(keys);
  }
}
