import type { UserRecord, UserRepository } from '../../application/ports/repositories';
import type { Tx } from './unit-of-work';

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly tx: Tx) {}

  async findById(id: string): Promise<UserRecord | null> {
    return this.tx.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    return this.tx.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async findByGoogleId(googleId: string): Promise<UserRecord | null> {
    return this.tx.user.findUnique({ where: { googleId } });
  }

  async findManyByEmail(emails: string[]): Promise<UserRecord[]> {
    if (emails.length === 0) return [];
    return this.tx.user.findMany({ where: { email: { in: emails.map((e) => e.toLowerCase()) } } });
  }

  async create(input: {
    email: string;
    name: string;
    passwordHash: string | null;
    googleId: string | null;
  }): Promise<UserRecord> {
    return this.tx.user.create({ data: { ...input, email: input.email.toLowerCase() } });
  }

  async setPasswordHash(id: string, hash: string): Promise<void> {
    await this.tx.user.update({ where: { id }, data: { passwordHash: hash } });
  }

  async setGoogleId(id: string, googleId: string): Promise<void> {
    await this.tx.user.update({ where: { id }, data: { googleId } });
  }

  async clearGoogleId(id: string): Promise<void> {
    await this.tx.user.update({ where: { id }, data: { googleId: null } });
  }

  async delete(id: string): Promise<void> {
    await this.tx.user.delete({ where: { id } });
  }

  /** §3.5 — idempotent, so it can run on every authentication. */
  async linkPendingGrants(userId: string, email: string): Promise<void> {
    await this.tx.shareGrant.updateMany({
      where: { email: email.toLowerCase(), userId: null, revokedAt: null },
      data: { userId },
    });
  }

  async countFailedLogins(email: string, since: Date): Promise<number> {
    return this.tx.loginAttempt.count({
      where: { email: email.toLowerCase(), attemptedAt: { gte: since } },
    });
  }

  async recordFailedLogin(email: string): Promise<void> {
    await this.tx.loginAttempt.create({ data: { email: email.toLowerCase() } });
  }

  async clearFailedLogins(email: string): Promise<void> {
    await this.tx.loginAttempt.deleteMany({ where: { email: email.toLowerCase() } });
  }
}
