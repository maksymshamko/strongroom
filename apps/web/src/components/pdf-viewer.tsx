'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NodeDto } from '@dataroom/contracts';
import { api } from '@/lib/api';
import { Button, Spinner } from '@/components/ui';
import { formatBytes, formatDate, isPdf } from '@/lib/format';

/**
 * §11.3 PdfViewer — documents open in place rather than downloading, so access
 * stays logged. Chrome is dark so the page is the brightest thing on screen;
 * sharing is one click from here (design §4.1).
 */
export function FileViewer({
  node,
  onClose,
  onShare,
  tokenFetcher,
}: {
  node: NodeDto;
  onClose: () => void;
  onShare?: () => void;
  /** Public-link viewers resolve content through the token route instead. */
  tokenFetcher?: (nodeId: string, download?: boolean) => Promise<{ url: string }>;
}) {
  // `undefined` means "whatever is current" — the same request the server
  // answers with the latest version, so opening the viewer never depends on
  // the version list having loaded.
  const [selected, setSelected] = useState<number | undefined>(undefined);

  const content = useQuery({
    queryKey: ['content', node.id, selected ?? 'latest'],
    queryFn: () =>
      tokenFetcher
        ? tokenFetcher(node.id)
        : api.contentUrl(node.id, { version: selected, download: false }),
  });

  const versions = useQuery({
    queryKey: ['versions', node.id],
    queryFn: () => api.versions(node.id),
    enabled: !tokenFetcher,
  });

  const items = versions.data?.items ?? [];
  const latestNumber = items[0]?.versionNumber;
  const showing = items.find((v) => v.versionNumber === (selected ?? latestNumber));
  const viewingOlder = selected !== undefined && selected !== latestNumber;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function download() {
    // Downloads follow what is on screen: reading v2 and being handed v5 is
    // the kind of mix-up a diligence trail cannot afford.
    const result = tokenFetcher
      ? await tokenFetcher(node.id, true)
      : await api.contentUrl(node.id, { version: selected, download: true });
    window.open(result.url, '_blank', 'noopener');
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#1a1a1e]">
      <header className="flex items-center gap-3 border-b border-[#2e2e35] px-4 py-2.5">
        <button
          onClick={onClose}
          className="rounded-[4px] px-2 py-1 text-[13px] text-[#a8a8b0] hover:bg-[#26262c] hover:text-white"
        >
          ←
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-white">{node.name}</p>
          <p className="truncate text-[11px] text-[#8e8e96]">
            {showing
              ? `${formatBytes(showing.size)} · ${formatDate(showing.createdAt)}`
              : `${formatBytes(node.size)} · updated ${formatDate(node.updatedAt)}`}
          </p>
        </div>

        {/* An older version looks exactly like the current one on screen, so
            the difference has to be stated, not implied. */}
        {viewingOlder ? (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[#4a3a12] px-2 py-0.5 text-[11px] font-medium text-[#f0c674]">
              Viewing v{selected}
            </span>
            <button
              onClick={() => setSelected(undefined)}
              className="text-[11px] text-[#a8a8b0] underline hover:text-white"
            >
              Back to latest
            </button>
          </div>
        ) : null}

        <Button
          onClick={download}
          className="h-7 border-[#3a3a42] bg-[#26262c] text-[#e2e2e5] hover:bg-[#32323a]"
        >
          Download
        </Button>
        {onShare ? (
          <Button onClick={onShare} variant="primary" className="h-7">
            Share
          </Button>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex-1 overflow-auto p-6">
          {content.isLoading ? (
            <div className="text-[#8e8e96]">
              <Spinner label="Preparing document" />
            </div>
          ) : null}

          {content.data && isPdf(node.mimeType) ? (
            // The browser's own PDF engine renders the signed URL directly —
            // no proxying through the API (§7.6).
            <iframe
              title={node.name}
              src={content.data.url}
              className="mx-auto h-full min-h-[70vh] w-full max-w-[900px] rounded-[6px] bg-white"
            />
          ) : null}

          {content.data && !isPdf(node.mimeType) ? (
            <div className="mx-auto flex max-w-[520px] flex-col items-center gap-3 rounded-card border border-[#2e2e35] bg-[#212127] px-6 py-14 text-center">
              <p className="text-[14px] text-white">No in-app preview for this file type</p>
              <p className="text-[12px] leading-relaxed text-[#8e8e96]">
                PDFs render here. Everything else can be downloaded — access is logged either way.
              </p>
              <Button onClick={download} variant="primary" className="mt-1">
                Download
              </Button>
            </div>
          ) : null}
        </div>

        <aside className="hidden w-[260px] shrink-0 border-l border-[#2e2e35] p-4 lg:block">
          <p className="text-[11px] uppercase tracking-[0.09em] text-[#8e8e96]">Details</p>
          <dl className="mt-3 flex flex-col gap-2 text-[12px]">
            <Detail label="Uploaded by" value={node.ownerName} />
            <Detail label="Updated" value={formatDate(node.updatedAt)} />
            <Detail label="Size" value={formatBytes(node.size)} />
            {versions.data ? (
              <Detail
                label="Version"
                value={`${selected ?? latestNumber ?? 1} of ${versions.data.items.length}`}
              />
            ) : null}
          </dl>

          {items.length > 1 ? (
            <>
              <p className="mt-6 text-[11px] uppercase tracking-[0.09em] text-[#8e8e96]">
                Version history
              </p>
              {/* Each entry loads that version in place. Superseded drafts are
                  the reason versions are kept at all, so reaching one should
                  not require a download. */}
              <ul className="mt-2 flex flex-col gap-1">
                {items.map((version) => {
                  const active = version.versionNumber === (selected ?? latestNumber);
                  return (
                    <li key={version.id}>
                      <button
                        onClick={() =>
                          setSelected(
                            version.versionNumber === latestNumber
                              ? undefined
                              : version.versionNumber,
                          )
                        }
                        aria-current={active}
                        className={
                          'w-full rounded-[4px] px-2 py-1.5 text-left text-[12px] ' +
                          (active
                            ? 'bg-[#2e2e35] text-white'
                            : 'text-[#c9c9cf] hover:bg-[#26262c] hover:text-white')
                        }
                      >
                        <span className="font-medium">v{version.versionNumber}</span>
                        {version.versionNumber === latestNumber ? (
                          <span className="ml-1.5 text-[10px] uppercase tracking-[0.08em] text-[#8e8e96]">
                            latest
                          </span>
                        ) : null}
                        <span className="mt-0.5 block text-[11px] text-[#8e8e96]">
                          {formatBytes(version.size)} · {formatDate(version.createdAt)}
                        </span>
                        <span className="block text-[11px] text-[#8e8e96]">
                          {version.createdByName}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[#8e8e96]">{label}</dt>
      <dd className="truncate text-[#e2e2e5]">{value}</dd>
    </div>
  );
}
