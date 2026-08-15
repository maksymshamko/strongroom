'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  LayoutGrid,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';
import { resetIdentity } from '@/lib/observability';
import { ThemeControl } from '@/components/theme-control';

/**
 * spec 003 §4 — the app frame.
 *
 * Nav is deliberately short: the design's Recent / Personal / audit-log entries
 * are outside spec 001 (002 §11.5) and are not built. Trash is here because
 * spec 003 §2 added it.
 */
const NAV = [
  { href: '/', label: 'Data rooms', Icon: LayoutGrid },
  { href: '/shared', label: 'Shared with me', Icon: Users },
  { href: '/trash', label: 'Trash', Icon: Trash2 },
];

const SIDEBAR_STORAGE_KEY = 'dr.sidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // §4.1 — read after mount; the server has no way to know this preference.
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed');
  }, []);

  // §4.4 — the drawer closes on navigation and on Escape.
  useEffect(() => setDrawerOpen(false), [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? 'collapsed' : 'expanded');
      return next;
    });
  }

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar (§4.1) */}
      <aside
        className={cn(
          'hidden shrink-0 flex-col border-r border-line bg-surface transition-[width] md:flex',
          collapsed ? 'w-[56px]' : 'w-[200px]',
        )}
      >
        <div className={cn('flex items-center px-3 py-4', collapsed && 'justify-center px-0')}>
          <Link href="/" className="label-caps text-ink-1 no-underline" aria-label="Strongroom">
            {collapsed ? 'S' : 'Strongroom'}
          </Link>
        </div>

        <SidebarNav collapsed={collapsed} pathname={pathname} label="Sidebar" />

        <div className="mt-auto flex flex-col gap-1 border-t border-line p-2">
          <UserMenu collapsed={collapsed} />
          <button
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-[12px] text-ink-3 hover:bg-surface-3 hover:text-ink-1',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            {!collapsed ? 'Collapse' : null}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header (§4.4) */}
        <header className="flex items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2.5 md:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="rounded-[6px] p-1.5 text-ink-2 hover:bg-surface-3"
          >
            <Menu size={18} />
          </button>
          <span className="label-caps truncate">Strongroom</span>
          <UserMenu compact />
        </header>

        {children}
      </div>

      {/* Mobile drawer (§4.4) */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 h-full w-full bg-[#18181b]/40"
          />
          <nav className="absolute inset-y-0 left-0 flex w-[240px] flex-col border-r border-line bg-surface">
            <div className="flex items-center justify-between px-3 py-4">
              <span className="label-caps">Strongroom</span>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="rounded-[6px] p-1 text-ink-3 hover:bg-surface-3"
              >
                <X size={16} />
              </button>
            </div>
            <SidebarNav collapsed={false} pathname={pathname} label="Navigation drawer" />
          </nav>
        </div>
      ) : null}
    </div>
  );
}

function SidebarNav({
  collapsed,
  pathname,
  label,
}: {
  collapsed: boolean;
  pathname: string;
  /** Distinguishes the sidebar from the drawer — both are landmarks. */
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex flex-col gap-0.5 px-2">
      {NAV.map(({ href, label, Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            // §4.1 — collapsed items keep their label as a tooltip, on hover and
            // on keyboard focus, so the icon is never the only affordance.
            title={collapsed ? label : undefined}
            aria-label={collapsed ? label : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-[13px] no-underline',
              collapsed && 'justify-center px-0',
              active
                ? 'bg-accent-soft font-medium text-accent'
                : 'text-ink-2 hover:bg-surface-3 hover:text-ink-1',
            )}
          >
            <Icon size={16} aria-hidden />
            {!collapsed ? label : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** §4.3 — sign-out lives here rather than on the sidebar surface. */
function UserMenu({ collapsed = false, compact = false }: { collapsed?: boolean; compact?: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();

  async function signOut() {
    await api.logout();
    queryClient.clear();
    // §5 — a shared machine must not keep attributing events to the last user.
    resetIdentity();
    router.replace('/login');
  }

  const label = session.data?.name ?? session.data?.email ?? '?';

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Account menu"
        className={cn(
          'flex items-center gap-2 rounded-[6px] p-1.5 text-left hover:bg-surface-3',
          collapsed && 'justify-center',
        )}
      >
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">
          {initials(label)}
        </span>
        {!collapsed && !compact ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-ink-1">
              {session.data?.name ?? '—'}
            </span>
            <span className="block truncate text-[11px] text-ink-3">
              {session.data?.email ?? ''}
            </span>
          </span>
        ) : null}
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          side={compact ? 'bottom' : 'top'}
          sideOffset={6}
          className="z-50 w-[240px] rounded-[8px] border border-line bg-surface p-1 shadow-[0_8px_24px_rgba(24,24,27,0.16)]"
        >
          <div className="px-2 py-2">
            <p className="truncate text-[13px] font-medium">{session.data?.name ?? '—'}</p>
            <p className="truncate text-[11px] text-ink-3">{session.data?.email ?? ''}</p>
          </div>

          <DropdownMenu.Separator className="my-1 h-px bg-line" />

          <DropdownMenu.Item asChild>
            <Link
              href="/account"
              className="flex cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-[13px] text-ink-1 no-underline outline-none data-[highlighted]:bg-surface-3"
            >
              <Settings size={15} aria-hidden />
              Settings
            </Link>
          </DropdownMenu.Item>

          <div className="px-2 py-2">
            <p className="label-caps mb-1.5">Theme</p>
            <ThemeControl />
          </div>

          <DropdownMenu.Separator className="my-1 h-px bg-line" />

          <DropdownMenu.Item
            onSelect={signOut}
            className="flex cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-[13px] text-ink-1 outline-none data-[highlighted]:bg-surface-3"
          >
            <LogOut size={15} aria-hidden />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-4 md:px-6">
      <div className="min-w-0">
        <h1 className="screen-title truncate">{title}</h1>
        {meta ? <div className="mt-1 text-[12px] text-ink-3">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
