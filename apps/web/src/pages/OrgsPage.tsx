import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Check, ClipboardCheck, Crosshair, Plus, Search, UserRound } from 'lucide-react';
import { useAuth } from '../store/auth.js';
import { api } from '../lib/api.js';
import { Badge, Button, Card, Empty, ErrorBanner, Field, Input, Spinner } from '../components/ui.js';

interface OrgRow {
  id: string;
  name: string;
  shortName: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  activeStatus?: string;
  createdAt?: string;
  role?: string | null;
}

interface PlatformStats {
  organizations: number;
  users: number;
  matches: number;
  shooters: number;
  scores: number;
  rulesets: number;
}

const CAPABILITIES: Record<string, string[]> = {
  PLATFORM_ADMIN: [
    'Create and manage organizations',
    'Manage organization members and roles',
    'Manage the shared shooters roster',
    'Manage rulesets and reference data',
    'Review the platform audit log',
    'See any organization’s matches and results',
  ],
  PLATFORM_SUPER_ADMIN: [
    'Everything a Platform Administrator can do',
    'Grant any platform or organization role',
    'Platform-wide statistics',
  ],
};

const greeting = (): string => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

const emptyDraft = () => ({ name: '', shortName: '', city: '', province: '', country: '', email: '', phone: '', website: '' });
type Draft = ReturnType<typeof emptyDraft>;

export default function OrgsPage() {
  const { user, roles } = useAuth();
  const [memberOrgs, setMemberOrgs] = useState<OrgRow[] | null>(null);
  const [allOrgs, setAllOrgs] = useState<OrgRow[] | null>(null);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [search, setSearch] = useState('');

  const platformRoles = roles.filter((r) => r.role === 'PLATFORM_SUPER_ADMIN' || r.role === 'PLATFORM_ADMIN').map((r) => r.role);
  const isPlatform = Boolean(user?.isSuperAdmin) || platformRoles.length > 0;
  const role = user?.isSuperAdmin ? 'PLATFORM_SUPER_ADMIN' : platformRoles.includes('PLATFORM_ADMIN') ? 'PLATFORM_ADMIN' : null;
  const capabilities = [...new Set(platformRoles.flatMap((r) => CAPABILITIES[r] ?? []))];

  const load = () => {
    setError('');
    Promise.all([
      api<OrgRow[]>('/api/orgs/me').then(setMemberOrgs),
      isPlatform ? api<OrgRow[]>('/api/platform/orgs').then(setAllOrgs) : Promise.resolve(),
      isPlatform ? api<PlatformStats>('/api/platform/stats').then(setStats).catch(() => undefined) : Promise.resolve(),
    ]).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load organizations'));
  };

  useEffect(load, []);

  const visibleOrgs = useMemo(() => {
    if (!allOrgs) return null;
    const q = search.trim().toLowerCase();
    if (!q) return allOrgs;
    return allOrgs.filter((o) => `${o.name} ${o.shortName ?? ''} ${o.city ?? ''} ${o.province ?? ''}`.toLowerCase().includes(q));
  }, [allOrgs, search]);

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim() || !draft.shortName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const created = await api<OrgRow>('/api/platform/orgs', {
        method: 'POST',
        json: {
          name: draft.name.trim(),
          shortName: draft.shortName.trim(),
          city: draft.city.trim() || null,
          province: draft.province.trim() || null,
          country: draft.country.trim() || null,
          email: draft.email.trim() || null,
          phone: draft.phone.trim() || null,
          website: draft.website.trim() || null,
        },
      });
      setNotice(`${created.name} was created.`);
      setCreatedId(created.id);
      setCreateOpen(false);
      setSearch('');
      setDraft(emptyDraft());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create organization');
    } finally {
      setBusy(false);
    }
  }

  if (error && memberOrgs === null) return <ErrorBanner message={error} />;
  if (!memberOrgs) return <Spinner />;

  // ── Non-platform view: simple member picker ───────────────────────────────
  if (!isPlatform) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[1.2px] text-brand">Dashboard</p>
          <h2 className="mt-0.5 text-2xl font-bold text-ink">{greeting()}, {user?.displayName ?? user?.username}.</h2>
          <p className="mt-1 text-sm text-muted">
            {memberOrgs.length === 0
              ? 'You are not a member of any organization yet. Ask your club administrator to add you.'
              : `Pick one of your ${memberOrgs.length} ${memberOrgs.length === 1 ? 'organization' : 'organizations'} to start.`}
          </p>
        </div>
        {memberOrgs.length === 0 ? (
          <Card className="p-4"><Empty>You are not a member of any organization yet.</Empty></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {memberOrgs.map((o) => {
              const r = o.role ?? roles.find((x) => x.organizationId === o.id)?.role;
              return (
                <Link key={o.id} to={`/orgs/${o.id}`} className="group">
                  <Card className="flex items-center justify-between gap-3 p-4 transition hover:border-accent hover:shadow-card">
                    <span className="font-medium text-ink group-hover:text-brand">{o.name}</span>
                    {r ? <Badge tone="sky">{r.replace(/_/g, ' ').toLowerCase()}</Badge> : null}
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Platform console ──────────────────────────────────────────────────────
  const statsTiles = stats
    ? [
        { label: 'Organizations', value: stats.organizations, icon: <Building2 className="h-4 w-4" /> },
        { label: 'Matches', value: stats.matches, icon: <Crosshair className="h-4 w-4" /> },
        { label: 'Shooters', value: stats.shooters, icon: <UserRound className="h-4 w-4" /> },
        { label: 'Score entries', value: stats.scores, icon: <ClipboardCheck className="h-4 w-4" /> },
      ]
    : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[1.2px] text-brand">Platform console</p>
        <h2 className="mt-0.5 text-2xl font-bold text-ink">{greeting()}, {user?.displayName ?? user?.username}.</h2>
        <p className="mt-1 text-sm text-muted">
          {role ? `You're signed in as ${role === 'PLATFORM_ADMIN' ? 'Platform Administrator' : 'Platform Super Administrator'}. Everything below is yours to use.` : ''}
        </p>
      </div>

      {statsTiles && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {statsTiles.map((t) => (
            <Card key={t.label} className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{t.label}</p>
                <p className="mt-0.5 text-2xl font-extrabold text-ink">{t.value.toLocaleString()}</p>
              </div>
              <span className="text-brand/60">{t.icon}</span>
            </Card>
          ))}
        </div>
      )}

      {capabilities.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-bold text-ink">
              As a {role?.replace(/_/g, ' ').toLowerCase()} you can:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {capabilities.map((c) => (
                <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-app px-2.5 py-1 text-[11px] font-semibold text-ink">
                  <Check className="h-3 w-3 text-green" /> {c}
                </span>
              ))}
            </div>
          </div>
        </Card>
      )}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-ink">Organizations</h3>
            <span className="text-xs text-muted">{allOrgs?.length ?? '…'} on platform</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input className="w-56 pl-8" placeholder="Search organizations…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Button kind="gold" onClick={() => setCreateOpen((v) => !v)}>
              <Plus className="h-4 w-4" /> {createOpen ? 'Cancel' : 'New organization'}
            </Button>
          </div>
        </div>

        {createOpen && (
          <Card className="mt-3 p-4">
            <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={createOrg}>
              <Field label="Organization name" required><Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} required autoFocus /></Field>
              <Field label="Short name" required><Input value={draft.shortName} onChange={(e) => setDraft((d) => ({ ...d, shortName: e.target.value }))} required placeholder="e.g. SJEPSC" /></Field>
              <Field label="City"><Input value={draft.city} onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))} /></Field>
              <Field label="Province"><Input value={draft.province} onChange={(e) => setDraft((d) => ({ ...d, province: e.target.value }))} /></Field>
              <Field label="Country"><Input value={draft.country} onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value }))} /></Field>
              <Field label="Email"><Input type="email" value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} /></Field>
              <Field label="Phone"><Input value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} /></Field>
              <Field label="Website"><Input value={draft.website} onChange={(e) => setDraft((d) => ({ ...d, website: e.target.value }))} /></Field>
              <div className="sm:col-span-2 lg:col-span-4 flex items-center justify-end">
                <Button type="submit" kind="gold" disabled={busy || !draft.name.trim() || !draft.shortName.trim()}>
                  {busy ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Create organization
                </Button>
              </div>
            </form>
            <p className="mt-2 text-xs text-muted">After creating, open the organization and add an administrator under Users — they take it from there.</p>
          </Card>
        )}

        {notice ? (
          <p className="mt-3 text-sm text-emerald-400">
            {notice}{' '}
            {createdId ? <Link to={`/orgs/${createdId}`} className="font-semibold underline">Open it to add an administrator →</Link> : null}
          </p>
        ) : null}
        {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}

        <div className="mt-3">
          {!visibleOrgs ? (
            <Card className="p-4"><Spinner /></Card>
          ) : visibleOrgs.length === 0 ? (
            <Card className="p-4"><Empty>{search ? `No organizations match “${search}”.` : 'No organizations yet. Create the first one.'}</Empty></Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {visibleOrgs.map((o) => (
                <Link key={o.id} to={`/orgs/${o.id}`} className="group">
                  <Card className="p-4 transition hover:border-accent hover:shadow-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#e5b842]/15 text-xs font-black text-[#f4cf6f]">{o.shortName?.slice(0, 2).toUpperCase() ?? '–'}</span>
                        <span className="truncate font-medium text-ink group-hover:text-brand">{o.name}</span>
                      </div>
                      <Badge tone={o.activeStatus === 'inactive' ? 'slate' : 'emerald'}>{o.activeStatus === 'inactive' ? 'Inactive' : 'Active'}</Badge>
                    </div>
                    <p className="mt-2 pl-[46px] text-xs text-muted">
                      {[o.city, o.province, o.country].filter(Boolean).join(', ') || '—'}
                    </p>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}