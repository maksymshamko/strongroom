'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Button, Card, ErrorNote, Input, Label } from '@/components/ui';

/**
 * Demonstration build: the form opens pre-filled with the seeded account
 * (`pnpm --filter @dataroom/api seed`) so a reviewer can sign in without being
 * handed credentials out of band. Remove both constants — and the prefill
 * below — before this is pointed at anything real.
 */
const DEMO_EMAIL = 'demo@strongroom.test';
const DEMO_PASSWORD = 'demo-password-001';

// §11.2 /login — email/password (§3.2) plus Google when the server has it configured.
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const next = params.get('next') ?? '/';

  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login(email, password);
      // Seed the cache from the response rather than invalidating it: an
      // invalidate leaves the stale `null` in place while the refetch runs,
      // and the destination page's session guard would bounce straight back
      // to /login — the "had to sign in twice" symptom.
      queryClient.setQueryData(['session'], user);
      router.replace(next.startsWith('/') ? next : '/');
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'RATE_LIMITED'
          ? 'Too many attempts. Try again in a few minutes.'
          : 'Email or password is incorrect.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 text-center">
          <p className="label-caps">Strongroom</p>
          <h1 className="mt-2 text-[22px] font-medium tracking-[-0.01em]">Sign in</h1>
          <p className="mt-1.5 text-[13px] text-ink-2">
            Secure document repository for due diligence.
          </p>
        </div>

        <Card className="p-5">
          <p className="mb-4 rounded-[6px] border border-line-2 bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-ink-3">
            Demo build — the seeded account is pre-filled. Just press{' '}
            <span className="font-medium text-ink-2">Sign in</span>.
          </p>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
              />
            </div>

            {error ? <ErrorNote>{error}</ErrorNote> : null}

            <Button type="submit" variant="primary" disabled={busy} className="h-9 w-full">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="text-[11px] uppercase tracking-[0.09em] text-ink-4">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <a
            href={api.googleUrl()}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-[6px] border border-line-2 bg-surface text-[13px] font-medium text-ink-1 hover:bg-surface-3"
          >
            <span className="text-[14px] font-semibold text-ink-2">G</span>
            Continue with Google
          </a>
        </Card>

        <p className="mt-4 text-center text-[12px] leading-relaxed text-ink-3">
          Accounts are provisioned by your administrator — there is no self-serve signup.
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
