'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { track } from '@/lib/observability';
import { useRequireSession } from '@/lib/session';
import { AppShell, PageHeader } from '@/components/app-shell';
import {
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogShell,
  DialogTrigger,
  EmptyState,
  ErrorNote,
  Input,
  Label,
  Spinner,
} from '@/components/ui';
import { formatBytes, formatDate, formatRelative, pluralize } from '@/lib/format';

// §11.2 `/` — dashboard: data room cards plus the shared-with-me table (design §1.1/§1.2).
export default function DashboardPage() {
  const session = useRequireSession();

  const rooms = useQuery({
    queryKey: ['data-rooms'],
    queryFn: () => api.listDataRooms({ sort: 'updatedAt', dir: 'desc' }),
    enabled: Boolean(session.data),
  });

  const shared = useQuery({
    queryKey: ['shared-with-me'],
    queryFn: () => api.sharedWithMe(),
    enabled: Boolean(session.data),
  });

  if (!session.data) return null;

  const hasRooms = (rooms.data?.items.length ?? 0) > 0;

  return (
    <AppShell>
      <PageHeader
        title="Data rooms"
        meta={
          rooms.data
            ? `${pluralize(rooms.data.items.length, 'room')} · sorted by last updated`
            : undefined
        }
        actions={<CreateRoomDialog />}
      />

      <div className="px-4 py-6 md:px-6">
        {rooms.isLoading ? <Spinner /> : null}

        {rooms.data && !hasRooms ? (
          <Card>
            <EmptyState
              title="No data rooms yet"
              body="A data room is one deal: a folder tree, a permission list, and everything shared from it. Create one to start uploading diligence material."
              actions={<CreateRoomDialog label="Create data room" variant="primary" />}
            />
          </Card>
        ) : null}

        {hasRooms ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rooms.data!.items.map((room) => (
              <Link key={room.id} href={`/n/${room.id}`} className="no-underline">
                <Card className="flex h-full flex-col gap-3 p-4 transition-colors hover:border-accent-line">
                  <div>
                    <h2 className="truncate text-[15px] font-medium text-ink-1">{room.name}</h2>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.08em] text-ink-3">
                      {pluralize(room.itemCount, 'item')} · {formatBytes(room.size)}
                    </p>
                  </div>
                  <p className="mt-auto text-[12px] text-ink-3">
                    Updated {formatRelative(room.updatedAt)}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        ) : null}

        {/* Design §1.2 — pre-account shares are a table of individual items, not
            cards: they are not deals this user owns. */}
        {(shared.data?.items.length ?? 0) > 0 ? (
          <section className="mt-9">
            <p className="label-caps mb-2">
              Shared with you · {pluralize(shared.data!.items.length, 'item')}
            </p>
            <Card className="overflow-hidden">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-line">
                    {['Name', 'Shared by', 'Shared', ''].map((heading) => (
                      <th key={heading} className="label-caps px-4 py-2 font-medium">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shared.data!.items.map((item) => (
                    <tr key={item.shareId} className="h-row border-b border-line-2 last:border-0">
                      <td className="px-4">
                        <Link href={`/n/${item.id}`} className="row-primary no-underline">
                          {item.name}
                        </Link>
                      </td>
                      <td className="px-4 text-[13px] text-ink-2">{item.sharedByEmail}</td>
                      <td className="px-4 text-[13px] text-ink-3">{formatDate(item.sharedAt)}</td>
                      <td className="px-4 text-right">
                        <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
                          View
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function CreateRoomDialog({
  label = 'New data room',
  variant = 'primary',
}: {
  label?: string;
  variant?: 'primary' | 'secondary';
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const create = useMutation({
    mutationFn: () => api.createDataRoom(name),
    onSuccess: async (room) => {
      track('dataroom_created', { data_room_id: room.id });
      await queryClient.invalidateQueries({ queryKey: ['data-rooms'] });
      setOpen(false);
      setName('');
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant}>{label}</Button>
      </DialogTrigger>
      <DialogShell>
        <DialogHeader title="New data room" subtitle="Name it after the deal — one room, one deal." />
        <form
          className="flex flex-col gap-3 px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="room-name">Name</Label>
            <Input
              id="room-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Project Meridian"
            />
          </div>
          {create.error ? <ErrorNote>{(create.error as Error).message}</ErrorNote> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogShell>
    </Dialog>
  );
}
