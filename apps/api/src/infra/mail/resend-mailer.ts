import { Resend } from 'resend';
import type { Mailer, ShareInvite } from '../../application/ports/mailer';

/** §9 — share invites only; no password reset, no reminders in this pass. */
export class ResendMailer implements Mailer {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async sendShareInvite(invite: ShareInvite): Promise<void> {
    const subject = `${invite.inviterName} shared "${invite.nodeName}" with you`;
    const cta = invite.recipientHasAccount ? 'Open in Strongroom' : 'Sign in to view';

    await this.client.emails.send({
      from: this.from,
      to: invite.to,
      subject,
      html: `
        <div style="font-family:Helvetica,Arial,sans-serif;color:#18181b;line-height:1.5">
          <p style="font-size:15px">
            <strong>${escapeHtml(invite.inviterName)}</strong> shared
            <strong>${escapeHtml(invite.nodeName)}</strong> with you.
          </p>
          <p style="margin:24px 0">
            <a href="${invite.link}"
               style="background:#3d3a4f;color:#fff;padding:10px 18px;border-radius:8px;
                      text-decoration:none;font-size:14px">${cta}</a>
          </p>
          <p style="font-size:12px;color:#8e8e96">
            You are receiving this because someone shared a document with this address.
          </p>
        </div>
      `,
    });
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
