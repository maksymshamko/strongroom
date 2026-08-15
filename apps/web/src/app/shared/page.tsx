'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useRequireSession } from '@/lib/session';
import { AppShell, PageHeader } from '@/components/app-shell';
import { Card, EmptyState, Spinner } from '@/components/ui';
import { formatDate, pluralize } from '@/lib/format';

/** §8.1 GET /shared-with-me — items shared with this account, including grants
 *  that predated it and were linked at first sign-in (§3.5). */
export default function SharedPage() {
  const session = useRequireSession();

  const shared = useQuery({
    queryKey: ['shared-with-me'],
    queryFn: () => api.sharedWithMe(),
    enabled: Boolean(session.data),
  });

  if (!session.data) return null;

  return (
    <AppShell>
      <PageHeader
        title="Shared with me"
        meta={shared.data ? pluralize(shared.data.items.length, 'item') : undefined}
      />

      <div className="px-4 py-6 md:px-6">
        {shared.isLoading ? <Spinner /> : null}

        {shared.data && shared.data.items.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing shared with you yet"
              body="When someone shares a data room, folder or file with your email address, it appears here — including anything shared before your account existed."
            />
          </Card>
        ) : null}

        {shared.data && shared.data.items.length > 0 ? (
          <Card className="overflow-hidden">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line">
                  {['Name', 'Shared by', 'Shared', 'Access'].map((heading) => (
                    <th key={heading} className="label-caps px-4 py-2 font-medium">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shared.data.items.map((item) => (
                  <tr key={item.shareId} className="h-row border-b border-line-2 last:border-0">
                    <td className="px-4">
                      <Link href={`/n/${item.id}`} className="row-primary no-underline hover:underline">
                        {item.name}
                      </Link>
                    </td>
                    <td className="px-4 text-[13px] text-ink-2">{item.sharedByEmail}</td>
                    <td className="px-4 text-[13px] text-ink-3">{formatDate(item.sharedAt)}</td>
                    <td className="px-4">
                      <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
                        View
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
