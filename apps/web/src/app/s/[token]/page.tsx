'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NodeDto } from '@dataroom/contracts';
import { api } from '@/lib/api';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { NodeTable } from '@/components/node-table';
import { FileViewer } from '@/components/pdf-viewer';
import { EmptyState, Spinner } from '@/components/ui';
import { formatBytes, pluralize } from '@/lib/format';

/**
 * §11.2 /s/[token] — the public-link view. Read-only, no session required, and
 * scoped to the shared node's subtree (§5.6).
 */
export default function PublicSharePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [preview, setPreview] = useState<NodeDto | null>(null);

  const share = useQuery({
    queryKey: ['public-share', token, currentId],
    queryFn: () => api.publicShare(token, currentId ?? undefined),
    retry: false,
  });

  const node = share.data?.node;

  const children = useQuery({
    queryKey: ['public-children', token, node?.id],
    queryFn: () => api.publicChildren(token, node!.id, { limit: 100 }),
    enabled: Boolean(node && node.type !== 'FILE'),
  });

  if (share.isError) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <EmptyState
          title="This link is no longer available"
          body="The item may have been deleted, or the link may have been revoked by its owner."
        />
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-line bg-surface px-6 py-4">
        <p className="label-caps">Shared with you · read only</p>
        <Breadcrumbs
          className="mt-1.5"
          segments={share.data?.breadcrumb ?? []}
          onNavigate={(segment) => setCurrentId(segment.id)}
        />
        {node && node.type !== 'FILE' ? (
          <p className="mt-2 text-[12px] text-ink-3">
            {pluralize(node.itemCount, 'item')} · {formatBytes(node.size)}
          </p>
        ) : null}
      </header>

      <div className="px-6 py-5">
        {share.isLoading ? <Spinner /> : null}

        {node?.type === 'FILE' ? (
          <FileViewer
            node={node}
            onClose={() => setCurrentId(share.data!.share.nodeId)}
            tokenFetcher={(nodeId, download) => api.publicContent(token, nodeId, download)}
          />
        ) : null}

        {node && node.type !== 'FILE' && children.data ? (
          children.data.items.length > 0 ? (
            <NodeTable
              items={children.data.items}
              canWrite={false}
              onOpenFile={setPreview}
              onOpenFolder={(folder) => setCurrentId(folder.id)}
            />
          ) : (
            <div className="rounded-card border border-line bg-surface">
              <EmptyState title="This folder is empty" body="Nothing has been shared here yet." />
            </div>
          )
        ) : null}
      </div>

      {preview ? (
        <FileViewer
          node={preview}
          onClose={() => setPreview(null)}
          tokenFetcher={(nodeId, download) => api.publicContent(token, nodeId, download)}
        />
      ) : null}
    </main>
  );
}
