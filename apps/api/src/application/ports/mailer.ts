/** §9 — one template in this pass: the share invite. */
export type ShareInvite = {
  to: string;
  inviterName: string;
  nodeName: string;
  /** Deep link to the shared node, or to sign-in when the recipient has no account. */
  link: string;
  recipientHasAccount: boolean;
};

export interface Mailer {
  sendShareInvite(invite: ShareInvite): Promise<void>;
}
