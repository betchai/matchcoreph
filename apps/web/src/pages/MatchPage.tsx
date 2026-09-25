import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ClipboardList, Crosshair, LayoutDashboard, Radio, Settings2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { fmtDate } from '../lib/format.js';
import { useOrg } from '../lib/org.js';
import { Badge, Button, Card, Empty, ErrorBanner, Input, Spinner } from '../components/ui.js';

type StageRow = { id: string; number: number; name: string; scoringMethod: string; loadType?: string | null };
type SquadRow = { id: string; name: string; memberCount: number };
type RegistrationRow = { id: string; firstName: string; lastName: string; divisionName: string | null; squadName: string | null; status: string };

type MatchView = {
  match: Record<string, unknown>;
  wizard: Record<string, unknown>;
  stages: StageRow[];
  squads: SquadRow[];
  registrations: RegistrationRow[];
};

const NAV_LINKS = [
  { to: 'configure', label: 'Wizard & setup', icon: Settings2 },
  { to: 'scoring', label: 'Score entry', icon: Crosshair },
  { to: 'results', label: 'Live results', icon: Radio },
  { to: 'control', label: 'Control center', icon: LayoutDashboard },
];

export default function MatchPage() {
  const { orgId = '', matchId = '' } = useParams();
  const [data, setData] = useState<MatchView | null>(null);
  const [error, setError] = useState('');
  const [stageName, setStageName] = useState('');
  const [squadName, setSquadName] = useState('');
  const [creating, setCreating] = useState('');

  const load = () => {
    setError('');
    Promise.all([
      api<MatchView['match'] & { wizard: MatchView['wizard'] }>(`/api/orgs/${orgId}/matches/${matchId}`),
      api<StageRow[]>(`/api/orgs/${orgId}/matches/${matchId}/stages`),
      api<SquadRow[]>(`/api/orgs/${orgId}/matches/${matchId}/squads/overview`),
      api<RegistrationRow[]>(`/api/orgs/${orgId}/matches/${matchId}/registrations`),
    ])
      .then(([view, stages, squads, registrations]) => setData({ match: view, wizard: view.wizard, stages, squads, registrations }))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load match'));
  };

  const org = useOrg(orgId);

  useEffect(load, [orgId, matchId]);

  async function addStage(e: React.FormEvent) {
    e.preventDefault();
    if (!stageName.trim() || !data) return;
    setCreating('S');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/stages`, {
        method: 'POST',
        json: {
          number: data.stages.length + 1,
          name: stageName.trim(),
          courseType: 'SHORT',
          scoringMethod: 'COMSTOCK',
          minimumRounds: 8,
          maximumRounds: 8,
          maximumStagePoints: 40,
        },
      });
      setStageName('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add stage');
    } finally {
      setCreating('');
    }
  }

  async function addSquad(e: React.FormEvent) {
    e.preventDefault();
    if (!squadName.trim()) return;
    setCreating('Q');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/squads`, { method: 'POST', json: { name: squadName.trim() } });
      setSquadName('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add squad');
    } finally {
      setCreating('');
    }
  }

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <Spinner />;

  const m = data.match;
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[1.2px] text-brand">{org?.shortName ?? org?.name ?? 'Match'}</p>
          <h2 className="mt-0.5 truncate text-2xl font-bold text-ink">{String(m.name ?? '')}</h2>
          <p className="mt-1 text-sm text-muted">
            {fmtDate(String(m.startDate ?? ''))} · {(Array.isArray(m.disciplineCodes) ? m.disciplineCodes[0] : m.discipline) ?? '—'} · {(() => {
              const rs = (m as { ruleset?: { organizationCode?: string; version?: string } | null }).ruleset;
              return rs ? `${rs.organizationCode} v${rs.version}` : 'no ruleset';
            })()}
          </p>
        </div>
        <Badge tone={m.status === 'PUBLISHED' ? 'emerald' : m.status === 'OPEN' ? 'sky' : 'amber'}>{String(m.status ?? '')}</Badge>
      </div>

      <nav className="flex flex-wrap gap-2">
        {NAV_LINKS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3.5 py-2 text-sm text-ink transition hover:border-brand hover:text-brand hover:shadow-card"
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>

      {(m as { ruleset?: { organizationCode?: string; discipline?: string; version?: string } | null }).ruleset ||
      Array.isArray(m.disciplineCodes) ||
      data.stages.length > 0 ? (
        <Card className="p-4">
          <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[1.2px] text-muted">Match setup</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted">Ruleset</p>
              {(() => {
                const rs = (m as { ruleset?: { organizationCode?: string; discipline?: string; version?: string; name?: string } | null }).ruleset ?? null;
                return rs ? (
                  <>
                    <p className="mt-0.5 text-sm font-semibold text-ink">
                      {rs.organizationCode} {rs.discipline} v{rs.version}
                    </p>
                    {rs.name ? <p className="text-xs text-muted">{rs.name}</p> : null}
                  </>
                ) : (
                  <p className="mt-0.5 text-sm text-muted">Not selected yet</p>
                );
              })()}
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted">Discipline</p>
              <p className="mt-0.5 text-sm font-semibold text-ink">
                {Array.isArray(m.disciplineCodes) && (m.disciplineCodes as string[]).length
                  ? (m.disciplineCodes as string[]).join(', ')
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted">Scoring method</p>
              {data.stages.length > 0 ? (
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                  {[...new Set(data.stages.map((s) => `${s.scoringMethod}${s.loadType ? ` · ${s.loadType.replace(/_/g, ' ')}` : ''}`))].map((method) => (
                    <span key={method} className="rounded-md border border-brand/30 bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
                      {method.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-0.5 text-sm text-muted">No stages yet</p>
              )}
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Stages</h3>
            <Link to="stages" className="text-xs font-medium text-brand hover:text-gold">Configure</Link>
          </div>
          <form className="mb-3 flex gap-2" onSubmit={addStage}>
            <Input value={stageName} onChange={(e) => setStageName(e.target.value)} placeholder="Add stage…" />
            <Button type="submit" disabled={creating === 'S' || !stageName.trim()}>Add</Button>
          </form>
          {data.stages.length === 0 ? (
            <Empty>No stages yet.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {data.stages.map((s) => (
                <li key={s.id} className="flex justify-between text-sm text-ink">
                  <span>
                    {s.number} · {s.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {s.scoringMethod.replace(/_/g, ' ')}
                    {s.loadType ? <span className="ml-1 rounded bg-amber/15 px-1.5 py-0.5 font-semibold text-amber">{s.loadType.replace(/_/g, ' ')}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">Squads</h3>
          <form className="mb-3 flex gap-2" onSubmit={addSquad}>
            <Input value={squadName} onChange={(e) => setSquadName(e.target.value)} placeholder="Add squad…" />
            <Button type="submit" disabled={creating === 'Q' || !squadName.trim()}>Add</Button>
          </form>
          {data.squads.length === 0 ? (
            <Empty>No squads yet.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {data.squads.map((q) => (
                <li key={q.id} className="flex justify-between text-sm text-ink">
                  <span>{q.name}</span>
                  <span className="text-xs text-muted">{q.memberCount} member{q.memberCount === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
          <ClipboardList className="h-4 w-4" /> Registrations ({data.registrations.length})
        </h3>
        {data.registrations.length === 0 ? (
          <Empty>No registrations yet — add them from the wizard.</Empty>
        ) : (
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <tbody>
                {data.registrations.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="py-1.5 text-ink">
                      {r.lastName}, {r.firstName}
                    </td>
                    <td className="py-1.5 text-xs text-muted">{r.divisionName ?? '—'}</td>
                    <td className="py-1.5 text-right text-xs text-muted">{r.squadName ?? null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}