'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MIN_PASSWORD_LENGTH, type AccountSecurityDto } from '@dataroom/contracts';
import { Link as LinkIcon, Unlink } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useRequireSession } from '@/lib/session';
import { AppShell, PageHeader } from '@/components/app-shell';
import { ThemeControl } from '@/components/theme-control';
import { Button, Card, ErrorNote, Input, Label, Spinner } from '@/components/ui';

// §11.2 /account — §8.6 password + danger zone (design §9.1–9.3).
export default function AccountPage() {
  const session = useRequireSession();
  const user = session.data;

  // spec 003 §1.2 — password and Google state come from the account-scoped
  // endpoint, not from the session payload.
  const security = useQuery({
    queryKey: ['account-security'],
    queryFn: () => api.accountSecurity(),
    enabled: Boolean(user),
  });

  if (!user) return null;

  return (
    <AppShell>
      <PageHeader title="Account" meta={user.email} />

      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 py-8 md:px-6">
        <AppearanceSection />
        {security.data ? (
          <>
            <SignInMethod security={security.data} />
            <PasswordSection hasPassword={security.data.hasPassword} />
          </>
        ) : (
          <Spinner />
        )}
        <DangerZone email={user.email} />
      </div>
    </AppShell>
  );
}

/** spec 003 §3.4 — the second of the two places theme can be set. */
function AppearanceSection() {
  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-medium">Appearance</h2>
      <p className="mt-1 text-[12px] text-ink-3">
        Applies to this device. “System” follows your operating system setting.
      </p>
      <div className="mt-4 max-w-[280px]">
        <ThemeControl />
      </div>
    </Card>
  );
}

function SignInMethod({ security }: { security: AccountSecurityDto }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const unlink = useMutation({
    mutationFn: () => api.unlinkGoogle(),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['account-security'] });
    },
    onError: (caught) => {
      // spec 003 §1.5 — the guard that stops an account locking itself out.
      setError(
        caught instanceof ApiError && caught.code === 'PASSWORD_REQUIRED'
          ? 'Add a password below before unlinking Google, or you will not be able to sign in.'
          : (caught as Error).message,
      );
    },
  });

  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-medium">Sign-in method</h2>
      <p className="mt-1 text-[12px] text-ink-3">How you access this account</p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line-2 px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="font-semibold text-ink-2">G</span>
          <span className="min-w-0">
            <span className="block">Google</span>
            {security.google.connected ? (
              <span className="block truncate text-[11px] text-ink-3">{security.google.email}</span>
            ) : null}
          </span>
        </span>

        {security.google.connected ? (
          <Button onClick={() => unlink.mutate()} disabled={unlink.isPending}>
            <Unlink size={14} aria-hidden />
            Unlink
          </Button>
        ) : (
          <a href={api.googleLinkUrl()} className="no-underline">
            <Button variant="primary">
              <LinkIcon size={14} aria-hidden />
              Connect Google
            </Button>
          </a>
        )}
      </div>

      {error ? (
        <div className="mt-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * §8.6 — the same section in two variants. For a Google-only account the copy
 * explains why the "current password" field is missing rather than leaving a
 * suspicious gap (design §9.2).
 */
function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      api.setPassword({
        currentPassword: hasPassword ? current : undefined,
        newPassword: next,
      }),
    onSuccess: async () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
      await queryClient.invalidateQueries({ queryKey: ['account-security'] });
    },
  });

  const mismatch = confirm.length > 0 && confirm !== next;
  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const canSubmit =
    next.length >= MIN_PASSWORD_LENGTH && next === confirm && (!hasPassword || current.length > 0);

  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-medium">{hasPassword ? 'Password' : 'Add a password'}</h2>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
        {hasPassword
          ? `At least ${MIN_PASSWORD_LENGTH} characters.`
          : `You sign in with Google, so there is no current password to confirm. Adding one lets you sign in directly — useful if your organisation revokes Google access mid-deal.`}
      </p>

      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setDone(false);
          save.mutate();
        }}
      >
        {hasPassword ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="current">Current password</Label>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="next">New password</Label>
          <Input
            id="next"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          />
          {tooShort ? (
            <p className="text-[11px] text-pending">
              {MIN_PASSWORD_LENGTH - next.length} more character
              {MIN_PASSWORD_LENGTH - next.length === 1 ? '' : 's'} needed
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          {mismatch ? <p className="text-[11px] text-danger">Passwords do not match</p> : null}
        </div>

        {save.error ? (
          <ErrorNote>
            {save.error instanceof ApiError && save.error.code === 'INVALID_CREDENTIALS'
              ? 'Current password is incorrect.'
              : (save.error as Error).message}
          </ErrorNote>
        ) : null}
        {done ? <p className="text-[12px] text-done">Password updated.</p> : null}

        <div>
          <Button type="submit" variant="primary" disabled={!canSubmit || save.isPending}>
            {hasPassword ? 'Update password' : 'Add password'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * §8.6 / design §9.3 — quarantined, last, and gated behind typing the account
 * email *and* ticking the acknowledgement. Expanding in place rather than
 * opening a modal keeps the consequences and the input on one surface.
 */
function DangerZone({ email }: { email: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [typed, setTyped] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  const preview = useQuery({
    queryKey: ['account-delete-preview'],
    queryFn: () => api.accountDeletePreview(),
    enabled: expanded,
  });

  const remove = useMutation({
    mutationFn: () => api.deleteAccount(typed),
    onSuccess: () => {
      queryClient.clear();
      router.replace('/login');
    },
  });

  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  return (
    <Card className="border-danger-line p-5">
      <p className="label-caps text-danger">Danger zone</p>
      <h2 className="mt-1.5 text-[15px] font-medium">Delete account</h2>

      {!expanded ? (
        <>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-2">
            Removes your profile and every data room you own. Rooms you own become inaccessible to
            everyone you shared them with.
          </p>
          <div className="mt-4">
            <Button variant="danger" onClick={() => setExpanded(true)}>
              Delete account
            </Button>
          </div>
        </>
      ) : (
        <>
          {preview.isLoading ? <Spinner /> : null}

          {preview.data ? (
            <ul className="mt-3 flex flex-col gap-1 text-[12px] leading-relaxed text-ink-2">
              <li>
                · {preview.data.dataRooms} data room{preview.data.dataRooms === 1 ? '' : 's'} and{' '}
                {preview.data.documents.toLocaleString()} document
                {preview.data.documents === 1 ? '' : 's'} are permanently deleted
              </li>
              <li>
                · {preview.data.collaborators} collaborator
                {preview.data.collaborators === 1 ? '' : 's'} lose access immediately
              </li>
              <li>· Files are removed from storage and cannot be recovered</li>
            </ul>
          ) : null}

          <div className="mt-4 flex flex-col gap-2.5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-email">Type {email} to confirm</Label>
              <Input
                id="confirm-email"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Enter your account email"
              />
            </div>

            <label className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-2">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-0.5"
              />
              I understand that collaborators on rooms I own will lose access.
            </label>

            {remove.error ? <ErrorNote>{(remove.error as Error).message}</ErrorNote> : null}

            <div className="flex items-center gap-2">
              <Button onClick={() => setExpanded(false)}>Cancel</Button>
              {/* Disabled until both the typed email matches and the box is ticked. */}
              <Button
                variant="danger"
                disabled={!matches || !acknowledged || remove.isPending}
                onClick={() => remove.mutate()}
              >
                Permanently delete
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
