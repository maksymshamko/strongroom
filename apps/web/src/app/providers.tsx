'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ThemeProvider } from '@/lib/theme';
import { initObservability } from '@/lib/observability';

export function Providers({ children }: { children: React.ReactNode }) {
  // spec 004 §4, §5 — both inert without credentials.
  useEffect(() => initObservability(), []);

  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // A diligence room changes under you; stale-while-revalidate is the
            // right default, but a hard refetch on focus would fight uploads.
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}
