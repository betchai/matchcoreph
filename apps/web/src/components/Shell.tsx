import { Link, useLocation, useParams } from 'react-router-dom';
import { CalendarDays, ClipboardCheck, Gauge, LayoutGrid, ListChecks, LogOut, Radio, Settings2, Target, Users, UserRound } from 'lucide-react';
import { useAuth } from '../store/auth.js';
import { Button } from './ui.js';
import { useOrg } from '../lib/org.js';
import { useMatch } from '../lib/match.js';
import type { ReactNode } from 'react';

interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
  exact?: boolean;
  mobile?: boolean;
}

function initials(name?: string | null): string {
  const base = (name || '').trim();
  if (!base) return '?';
  const parts = base.split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : base.slice(0, 2)).toUpperCase();
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      to={item.to}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition ${
        active ? 'border-l-2 border-pink bg-pink/15 text-[#ff7ab0]' : 'text-muted hover:bg-white/5 hover:text-ink'
      }`}
    >
      {item.icon}
      <span>{item.label}</span>
    </Link>
  );
}

export default function Shell({ title, children }: { title: string; children: ReactNode }) {
  const { user, roles, logout } = useAuth();
  const { pathname } = useLocation();
  const { orgId = '', matchId = '' } = useParams();

  const orgRole = roles.find((r) => r.organizationId === orgId)?.role;
  const orgContext = orgId ? (orgRole ? orgRole.replace(/_/g, ' ').toLowerCase() : 'organization member') : 'platform';
  const org = useOrg(orgId);
  const match = useMatch(orgId, matchId);

  const active = (to: string, exact?: boolean) => (exact ? pathname === to : pathname.startsWith(to));

  const orgNav: NavItem[] = orgId
    ? [
        { label: 'Matches', to: `/orgs/${orgId}`, icon: <CalendarDays className="h-4 w-4" />, exact: true, mobile: true },
        ...(matchId
          ? [
              { label: 'Match', to: `/orgs/${orgId}/matches/${matchId}`, icon: <Target className="h-4 w-4" />, exact: true, mobile: true },
              { label: 'Setup wizard', to: `/orgs/${orgId}/matches/${matchId}/configure`, icon: <Settings2 className="h-4 w-4" />, mobile: true },
              { label: 'Stages', to: `/orgs/${orgId}/matches/${matchId}/stages`, icon: <ListChecks className="h-4 w-4" /> },
              { label: 'Score entry', to: `/orgs/${orgId}/matches/${matchId}/scoring`, icon: <ClipboardCheck className="h-4 w-4" />, mobile: true },
              { label: 'Live results', to: `/orgs/${orgId}/matches/${matchId}/results`, icon: <Radio className="h-4 w-4" />, mobile: true },
              { label: 'Control center', to: `/orgs/${orgId}/matches/${matchId}/control`, icon: <Gauge className="h-4 w-4" />, mobile: true },
            ]
          : []),
        { label: 'Shooters', to: `/orgs/${orgId}/shooters`, icon: <UserRound className="h-4 w-4" /> },
        { label: 'Users', to: `/orgs/${orgId}/users`, icon: <Users className="h-4 w-4" /> },
      ]
    : [];

  const isPlatformAdmin =
    Boolean(user?.isSuperAdmin) ||
    roles.some((r) => r.role === 'PLATFORM_SUPER_ADMIN' || r.role === 'PLATFORM_ADMIN');

  const platformGroups: { label: string; items: NavItem[] }[] = [
    {
      label: 'Platform',
      items: [
        { label: 'Dashboard', to: '/', icon: <LayoutGrid className="h-4 w-4" />, exact: true, mobile: true },
        ...(isPlatformAdmin
          ? [
              { label: 'Shooters', to: '/platform/shooters', icon: <UserRound className="h-4 w-4" />, mobile: true },
              { label: 'Audit log', to: '/platform/audit', icon: <ClipboardCheck className="h-4 w-4" /> },
            ]
          : []),
      ],
    },
    ...(orgNav.length
      ? [
          {
            label: 'Competition',
            items: orgNav,
          },
        ]
      : []),
  ];

  const mobileNav = [...platformGroups.flatMap((g) => g.items)].filter((i) => i.mobile).filter((n, idx, arr) => arr.findIndex((x) => x.to === n.to) === idx);

  return (
    <div className="min-h-screen bg-app">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col bg-navy px-4 py-5 text-ink lg:flex">
        <a href="/landing" className="flex items-center gap-3 border-b border-white/10 px-1 pb-5">
          <img src="/ico.png" alt="MatchCorePH logo" className="h-10 w-10 rounded-xl object-cover" />
          <span>
            <b className="block text-[15px] leading-tight">MatchCore<span className="text-[#ff7ab0]">PH</span></b>
            <small className="block text-[11px] text-muted">by BLink Services</small>
          </span>
        </a>

        <nav className="mt-4 flex-1 overflow-y-auto">
          {platformGroups.map((g) => (
            <div key={g.label} className="mb-2">
              <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[1.3px] text-muted/70">{g.label}</p>
              <div className="space-y-1">
                {g.items.map((item) => (
                  <NavRow key={item.label} item={item} active={active(item.to, item.exact)} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <p className="border-t border-white/10 px-1 pt-4 text-[11px] text-muted/70">Offline-first scoring · © {new Date().getFullYear()}</p>
      </aside>

      <div className="lg:ml-60">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-line bg-panel px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="hidden text-muted sm:inline">{title}</span>
            {orgId ? (
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className="text-line">|</span>
                <span className="truncate font-semibold text-ink">{org?.shortName ?? org?.name ?? orgContext}</span>
                {matchId ? (
                  <>
                    <span className="text-line">|</span>
                    <span className="truncate font-semibold text-ink">{match?.name ?? '…'}</span>
                    {match?.status ? <span className="hidden text-xs text-muted md:inline">{match.status.replace(/_/g, ' ').toLowerCase()}</span> : null}
                  </>
                ) : null}
                {orgRole ? <span className="hidden text-xs text-muted md:inline">{orgRole.replace(/_/g, ' ').toLowerCase()}</span> : null}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {user ? (
              <span className="flex items-center gap-2.5 rounded-lg border border-line bg-app px-2 py-1">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[#e5b842]/15 text-xs font-bold text-[#f4cf6f]">{initials(user.displayName ?? user.username)}</span>
                <span className="hidden text-[13px] font-semibold text-ink sm:inline">{user.displayName ?? user.username}</span>
              </span>
            ) : null}
            <Button kind="ghost" onClick={() => void logout().then(() => (window.location.href = '/login'))}>
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-4 py-6 pb-24 sm:px-6 lg:pb-8">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex items-stretch justify-around border-t border-white/10 bg-navy px-2 py-1.5 text-ink lg:hidden">
        {mobileNav.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            className={`flex min-w-[64px] flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-[10px] font-semibold ${
              active(item.to, item.exact) ? 'bg-pink/15 text-[#ff7ab0]' : 'text-muted'
            }`}
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}