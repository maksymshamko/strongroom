'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api, ApiError } from './api';
import { identifyUser } from './observability';

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        const { user } = await api.me();
        // spec 004 §5 — identified by email once per session load.
        identifyUser(user);
        return user;
      } catch (error) {
        // An expired or absent session is a normal state, not a failure.
        if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') return null;
        throw error;
      }
    },
  });
}

/** Sends unauthenticated visitors to /login, preserving where they were headed. */
export function useRequireSession() {
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    // `isFetching`, not just `isLoading`: right after signing in the cached
    // session is still the stale `null` from before the login while the
    // refetch is in flight, and redirecting on that bounced the user back to
    // /login and made them sign in a second time.
    if (!session.isLoading && !session.isFetching && session.data === null) {
      const next = window.location.pathname + window.location.search;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [session.isLoading, session.isFetching, session.data, router]);

  return session;
}
