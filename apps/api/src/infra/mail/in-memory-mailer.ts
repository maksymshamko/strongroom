import type { Mailer, ShareInvite } from '../../application/ports/mailer';

export type SentMail = { to: string; subject: string; body: string };

/** §9 — the mailer's test/dev adapter. No network, asserted against in tests. */
export class InMemoryMailer implements Mailer {
  readonly sent: SentMail[] = [];

  /** Test hook: makes the next send throw, to prove §9's best-effort rule. */
  failNext = false;

  async sendShareInvite(invite: ShareInvite): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('mail provider unavailable');
    }
    this.sent.push({
      to: invite.to,
      subject: `${invite.inviterName} shared "${invite.nodeName}" with you`,
      body: invite.link,
    });
  }

  reset(): void {
    this.sent.length = 0;
    this.failNext = false;
  }
}
