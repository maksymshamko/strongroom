'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NameConflictDetails, NodeDto } from '@dataroom/contracts'
import { api, ApiError, type Conflict } from '@/lib/api'
import { track } from '@/lib/observability'
import {
  Avatar,
  Button,
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogShell,
  ErrorNote,
  Input,
  Label,
  Spinner,
} from '@/components/ui'
import { TRASH_TTL_DAYS } from '@dataroom/contracts'
import { formatBytes, initials, pluralize } from '@/lib/format'
import { cn } from '@/lib/cn'

/**
 * §11.3 ConflictDialog — one component, three options, used by rename and move
 * alike (uploads answer the same question inline in the upload panel).
 */
export function ConflictDialog({
  conflict,
  onResolve,
  onCancel,
}: {
  conflict: NameConflictDetails | null
  onResolve: (resolution: Conflict) => void
  onCancel: () => void
}) {
  if (!conflict) return null

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogShell className='w-[min(460px,calc(100vw-32px))]'>
        <DialogHeader
          title='An item with that name already exists'
          subtitle={`Suggested name: ${conflict.suggestedName}`}
        />
        <div className='flex flex-col gap-2 px-5 py-4'>
          <ConflictOption
            title='Keep both'
            body={`The item being moved or renamed becomes “${conflict.suggestedName}”.`}
            onClick={() => onResolve('KEEP_BOTH')}
          />
          {conflict.versioningAvailable ? (
            <>
              <ConflictOption
                title='Add as new version'
                body="The incoming content becomes the next version of the existing file. The moved file's own earlier versions are discarded."
                onClick={() => onResolve('NEW_VERSION')}
              />
              <ConflictOption
                title='Replace'
                body="The existing file's entire version history is permanently deleted and the incoming content becomes version 1."
                danger
                onClick={() => onResolve('REPLACE')}
              />
            </>
          ) : (
            <p className='text-[12px] leading-relaxed text-ink-3'>
              A folder cannot become a version of a file, so only “keep both”
              applies here.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onCancel}>Cancel</Button>
        </DialogFooter>
      </DialogShell>
    </Dialog>
  )
}

function ConflictOption({
  title,
  body,
  danger,
  onClick,
}: {
  title: string
  body: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-[6px] border border-line-2 px-3 py-2.5 text-left transition-colors hover:border-accent-line hover:bg-surface-2',
        danger && 'hover:border-danger-line hover:bg-danger-soft',
      )}
    >
      <p className={cn('text-[13px] font-medium', danger && 'text-danger')}>
        {title}
      </p>
      <p className='mt-0.5 text-[12px] leading-relaxed text-ink-2'>{body}</p>
    </button>
  )
}

/** §11.3 DeleteDialog — names exactly what disappears; red appears once. */
export function DeleteDialog({
  node,
  open,
  onOpenChange,
  onDeleted,
}: {
  node: NodeDto
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted?: () => void
}) {
  const queryClient = useQueryClient()

  const preview = useQuery({
    queryKey: ['delete-preview', node.id],
    queryFn: () => api.deletePreview(node.id),
    enabled: open,
  })

  const remove = useMutation({
    mutationFn: () => api.remove(node.id),
    onSuccess: async () => {
      track('node_deleted', { type: node.type })
      await queryClient.invalidateQueries({
        queryKey: ['children', node.parentId ?? ''],
      })
      await queryClient.invalidateQueries({ queryKey: ['data-rooms'] })
      onOpenChange(false)
      onDeleted?.()
    },
  })

  const impact = preview.data?.shareImpact
  const isShared =
    (impact?.peopleCount ?? 0) > 0 || (impact?.activeLinkCount ?? 0) > 0
  const label =
    node.type === 'FILE'
      ? 'file'
      : node.type === 'FOLDER'
        ? 'folder'
        : 'data room'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogShell className='w-[min(480px,calc(100vw-32px))]'>
        <DialogHeader
          title={`Delete “${node.name}”?`}
          // spec 003 §2.9 — delete is a move into Trash now, so the copy says so.
          subtitle={
            node.type === 'FILE'
              ? `This file moves to Trash and is permanently removed after ${TRASH_TTL_DAYS} days.`
              : `This ${label} and everything inside it moves to Trash and is permanently removed after ${TRASH_TTL_DAYS} days.`
          }
        />

        <div className='px-5 py-4'>
          {preview.isLoading ? <Spinner /> : null}

          {preview.data ? (
            <>
              {/* A file has no contents to enumerate — its own size is the
                  only figure that means anything. */}
              {node.type === 'FILE' ? (
                <>
                  <p className='label-caps'>Size</p>
                  <div className='mt-2 text-[13px]'>
                    {formatBytes(preview.data.contents.size)}
                  </div>
                </>
              ) : (
                <>
                  <p className='label-caps'>Contents</p>
                  <div className='mt-2 flex gap-6 text-[13px]'>
                    <span>
                      {pluralize(preview.data.contents.files, 'file')}
                    </span>
                    <span>
                      {pluralize(preview.data.contents.folders, 'folder')}
                    </span>
                    <span>{formatBytes(preview.data.contents.size)}</span>
                  </div>
                </>
              )}

              {/* Deletion is also a revocation — counterparties will notice. */}
              {isShared ? (
                <div className='mt-4 rounded-[6px] border border-danger-line bg-danger-soft px-3 py-3'>
                  <p className='text-[13px] font-medium text-danger'>
                    Shared access will be revoked
                  </p>
                  <p className='mt-1 text-[12px] leading-relaxed text-ink-2'>
                    {pluralize(impact!.peopleCount, 'person', 'people')}
                    {impact!.activeLinkCount > 0
                      ? ` and ${pluralize(impact!.activeLinkCount, 'active public link')}`
                      : ''}{' '}
                    lose access immediately. Sharing is not restored if you put
                    this back — you would need to invite people again.
                  </p>
                  {impact!.people.length > 0 ? (
                    <div className='mt-2.5 flex items-center gap-1'>
                      {impact!.people.map((person) => (
                        <Avatar
                          key={person.email}
                          label={initials(person.name ?? person.email)}
                        />
                      ))}
                      {impact!.peopleCount > impact!.people.length ? (
                        <span className='ml-1 text-[11px] text-ink-3'>
                          +{impact!.peopleCount - impact!.people.length} other
                          {impact!.peopleCount - impact!.people.length === 1
                            ? ''
                            : 's'}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}

          {remove.error ? (
            <div className='mt-3'>
              <ErrorNote>{(remove.error as Error).message}</ErrorNote>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button
            variant='danger'
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {isShared ? 'Delete and revoke access' : `Delete ${label}`}
          </Button>
        </DialogFooter>
      </DialogShell>
    </Dialog>
  )
}

/** §11.3 MoveDialog — a tree picker; invalid destinations are not selectable. */
export function MoveDialog({
  node,
  open,
  onOpenChange,
}: {
  node: NodeDto
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [destination, setDestination] = useState<{
    id: string
    name: string
  } | null>(null)
  const [conflict, setConflict] = useState<NameConflictDetails | null>(null)

  const root = useQuery({
    queryKey: ['node', node.dataRoomId],
    queryFn: () => api.getNode(node.dataRoomId),
    enabled: open,
  })

  const move = useMutation({
    mutationFn: (onConflict?: Conflict) =>
      api.move(node.id, destination!.id, onConflict),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['children'] })
      setConflict(null)
      onOpenChange(false)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.conflict)
        setConflict(error.conflict)
    },
  })

  useEffect(() => {
    if (!open) {
      setDestination(null)
      setConflict(null)
    }
  }, [open])

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogShell>
          <DialogHeader
            title={`Move “${node.name}”`}
            subtitle='Choose a destination folder.'
          />

          <div className='max-h-[320px] overflow-y-auto px-3 py-3'>
            {root.data ? (
              <FolderTree
                nodeId={root.data.node.id}
                name={root.data.node.name}
                depth={0}
                movingId={node.id}
                currentParentId={node.parentId}
                selectedId={destination?.id ?? null}
                onSelect={(id, name) => setDestination({ id, name })}
              />
            ) : (
              <Spinner />
            )}
          </div>

          <div className='border-t border-line px-5 py-2.5 text-[12px] text-ink-2'>
            Destination:{' '}
            <span className='font-medium text-ink-1'>
              {destination?.name ?? '—'}
            </span>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button
              variant='primary'
              disabled={!destination || move.isPending}
              onClick={() => move.mutate(undefined)}
            >
              Move here
            </Button>
          </DialogFooter>
        </DialogShell>
      </Dialog>

      <ConflictDialog
        conflict={conflict}
        onResolve={(resolution) => move.mutate(resolution)}
        onCancel={() => setConflict(null)}
      />
    </>
  )
}

function FolderTree({
  nodeId,
  name,
  depth,
  movingId,
  currentParentId,
  selectedId,
  onSelect,
}: {
  nodeId: string
  name: string
  depth: number
  movingId: string
  currentParentId: string | null
  selectedId: string | null
  onSelect: (id: string, name: string) => void
}) {
  const [expanded, setExpanded] = useState(depth === 0)

  const children = useQuery({
    queryKey: ['children', nodeId, 'folders'],
    queryFn: () => api.listChildren(nodeId, { limit: 100 }),
    enabled: expanded,
  })

  // The moved node and its own subtree are not valid destinations (§6.3).
  const isSelf = nodeId === movingId
  const isSource = nodeId === currentParentId

  return (
    <div>
      <div
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-[6px] px-1.5',
          selectedId === nodeId && 'bg-accent-soft',
          isSelf && 'opacity-40',
        )}
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          className='w-3 shrink-0 text-[10px] text-ink-3'
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <button
          disabled={isSelf}
          onClick={() => onSelect(nodeId, name)}
          className='min-w-0 flex-1 truncate text-left text-[13px] disabled:cursor-not-allowed'
        >
          {name}
        </button>
        {isSource ? <span className='label-caps shrink-0'>source</span> : null}
      </div>

      {expanded
        ? children.data?.items
            .filter((child) => child.type !== 'FILE')
            .map((child) => (
              <FolderTree
                key={child.id}
                nodeId={child.id}
                name={child.name}
                depth={depth + 1}
                movingId={movingId}
                currentParentId={currentParentId}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))
        : null}
    </div>
  )
}

/** §11.3 ShareDialog — two tabs; revocation lives on the People tab. */
export function ShareDialog({
  node,
  open,
  onOpenChange,
}: {
  node: NodeDto
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'link' | 'people'>('people')
  const [emails, setEmails] = useState('')
  const [copied, setCopied] = useState(false)

  const state = useQuery({
    queryKey: ['shares', node.id],
    queryFn: () => api.shareState(node.id),
    enabled: open,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['shares', node.id] })

  const createLink = useMutation({
    mutationFn: () => api.createLink(node.id),
    onSuccess: async () => {
      track('share_link_created', { node_type: node.type })
      await invalidate()
    },
  })
  const revokeLink = useMutation({
    mutationFn: (shareId: string) => api.revokeShare(shareId),
    onSuccess: async () => {
      track('share_revoked', { kind: 'link' })
      await invalidate()
    },
  })
  const addPeople = useMutation({
    mutationFn: () =>
      api.addPeople(
        node.id,
        emails
          .split(/[,\s]+/)
          .map((e) => e.trim())
          .filter(Boolean),
      ),
    onSuccess: async (result) => {
      track('share_people_invited', {
        node_type: node.type,
        count: result.grants.length,
      })
      setEmails('')
      await invalidate()
    },
  })
  const revokeGrant = useMutation({
    mutationFn: (grantId: string) => api.revokeGrant(grantId),
    onSuccess: async () => {
      track('share_revoked', { kind: 'grant' })
      await invalidate()
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogShell>
        <DialogHeader title={`Share “${node.name}”`} />

        <div className='flex gap-1 border-b border-line px-5 pt-3'>
          {(['link', 'people'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                'rounded-t-[6px] px-3 py-2 text-[13px]',
                tab === value
                  ? 'border-b-2 border-accent font-medium text-ink-1'
                  : 'text-ink-3 hover:text-ink-1',
              )}
            >
              {value === 'link' ? 'Public link' : 'People'}
            </button>
          ))}
        </div>

        <div className='px-5 py-4'>
          {state.isLoading ? <Spinner /> : null}

          {tab === 'link' && state.data ? (
            <div className='flex flex-col gap-3'>
              <div>
                <p className='text-[13px] font-medium'>
                  Anyone with the link can view
                </p>
                <p className='mt-1 text-[12px] leading-relaxed text-ink-2'>
                  No sign-in required. Views are logged, and the link grants
                  read access to everything nested under this item.
                </p>
              </div>

              {state.data.link ? (
                <>
                  <div className='flex gap-2'>
                    <Input readOnly value={state.data.link.url} />
                    <Button
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          state.data!.link!.url,
                        )
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1500)
                      }}
                    >
                      {copied ? 'Copied' : 'Copy link'}
                    </Button>
                  </div>
                  <div>
                    <Button
                      variant='danger'
                      onClick={() =>
                        revokeLink.mutate(state.data!.link!.shareId)
                      }
                      disabled={revokeLink.isPending}
                    >
                      Disable link
                    </Button>
                  </div>
                </>
              ) : (
                <div>
                  <Button
                    variant='primary'
                    onClick={() => createLink.mutate()}
                    disabled={createLink.isPending}
                  >
                    Create public link
                  </Button>
                </div>
              )}
            </div>
          ) : null}

          {tab === 'people' && state.data ? (
            <div className='flex flex-col gap-3'>
              <form
                className='flex gap-2'
                onSubmit={(event) => {
                  event.preventDefault()
                  addPeople.mutate()
                }}
              >
                <Input
                  value={emails}
                  onChange={(event) => setEmails(event.target.value)}
                  placeholder='Add people by email'
                />
                <Button
                  type='submit'
                  variant='primary'
                  disabled={!emails.trim() || addPeople.isPending}
                >
                  Invite
                </Button>
              </form>

              <ul className='flex flex-col'>
                {state.data.grants.map((grant) => (
                  <li
                    key={grant.id}
                    className={cn(
                      'flex items-center gap-2.5 border-b border-line-2 py-2 last:border-0',
                      // A pending invite is a claim on access, not a person with
                      // access — the warm tint says so (design §5.2).
                      grant.status === 'PENDING' && 'bg-[#fdf9f1]',
                    )}
                  >
                    <Avatar label={initials(grant.name ?? grant.email)} />
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-[13px]'>
                        {grant.name ?? grant.email}
                        {grant.status === 'PENDING' ? (
                          <span className='ml-2 text-[10px] uppercase tracking-[0.08em] text-pending'>
                            Pending
                          </span>
                        ) : null}
                      </p>
                      {grant.name ? (
                        <p className='truncate text-[11px] text-ink-3'>
                          {grant.email}
                        </p>
                      ) : (
                        <p className='text-[11px] text-ink-3'>
                          Invited, not yet accepted (check SPAM folder for the
                          email)
                        </p>
                      )}
                    </div>
                    <span className='text-[12px] text-ink-3'>Viewer</span>
                    <button
                      onClick={() => revokeGrant.mutate(grant.id)}
                      className='rounded-[4px] px-1.5 py-0.5 text-[12px] text-ink-3 hover:bg-surface-3 hover:text-danger'
                    >
                      Revoke
                    </button>
                  </li>
                ))}
                {state.data.grants.length === 0 ? (
                  <li className='py-3 text-[12px] text-ink-3'>
                    No one has been invited yet.
                  </li>
                ) : null}
              </ul>

              {state.data.inheritedFrom ? (
                <p className='text-[12px] text-ink-3'>
                  Access inherits from “{state.data.inheritedFrom.name}”.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant='primary'>Done</Button>
          </DialogClose>
        </DialogFooter>
      </DialogShell>
    </Dialog>
  )
}
