import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, Ban, Radio, Undo2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { fmtDate } from '../lib/format.js';
import { useOrg } from '../lib/org.js';
import { useOrgPerm } from '../store/auth.js';
import { Badge, Button, Card, Empty, ErrorBanner, Field, Input, Spinner } from '../components/ui.js';

interface MatchRow {
  id: string;
  name: string;
  status: string;
  startDate?: string;
  endDate?: string;
}

const HIDDEN = ['ARCHIVED', 'CANCELLED'];

export default function MatchesPage() {
  const { orgId = '' } = useParams();
  const navigate = useNavigate();
  const canHide = useOrgPerm(orgId, 'match.manage') || useOrgPerm(orgId, 'match.archive');
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    api<MatchRow[]>(`/api/orgs/${orgId}/matches`)
      .then(setMatches)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load matches'));
  }, [orgId]);

  const org = useOrg(orgId);

  const { active, hidden } = useMemo(() => {
    const list = matches ?? [];
    return {
      active: list.filter((m) => !HIDDEN.includes(m.status)),
      hidden: list.filter((m) => HIDDEN.includes(m.status)),
    };
  }, [matches]);

  async function createMatch(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError('');
    try {
      const created = await api<{ id: string }>(`/api/orgs/${orgId}/matches`, {
        method: 'POST',
        json: {
          name: name.trim(),
          startDate: startDate || new Date().toISOString().slice(0, 10),
          matchType: 'CLUB_SHOOT',
          matchLevel: 1,
          sanctioningStatus: 'CLUB',
        },
      });
      navigate(`/orgs/${orgId}/matches/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create match');
      setCreating(false);
    }
  }

  async function setStatus(m: MatchRow, status: string) {
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${m.id}/status`, { method: 'POST', json: { status } });
      setMatches((prev) => (prev ? prev.map((x) => (x.id === m.id ? { ...x, status } : x)) : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update match');
    }
  }

  function cancelMatch(m: MatchRow) {
    if (window.confirm(`Cancel “${m.name}”? It leaves the dashboard but stays in the archive and can be restored.`)) void setStatus(m, 'CANCELLED');
  }

  const blocker =
    (action: (m: MatchRow) => void, m: MatchRow) =>
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        action(m);
      };

  if (error) return <ErrorBanner message={error} />;
  if (!matches) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[1.2px] text-brand">{org?.shortName ?? org?.name ?? 'Your club'}</p>
          <h2 className="mt-0.5 text-2xl font-bold text-ink">Matches</h2>
        </div>
        {hidden.length > 0 ? (
          <button
            onClick={() => setShowHidden((v) => !v)}
            className="text-xs font-semibold text-brand hover:underline"
          >
            {showHidden ? 'Hide archived' : `Show archived (${hidden.length})`}
          </button>
        ) : null}
      </div>
      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={createMatch}>
          <Field label="New match" required hint="Create the shell, then finish the wizard.">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. San Juan Club Shoot" className="w-72" required />
          </Field>
          <Field label="Start date">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-44" />
          </Field>
          <Button type="submit" disabled={creating || !name.trim()}>Create match</Button>
        </form>
      </Card>

      {error ? <ErrorBanner message={error} /> : null}

      {matches.length === 0 ? (
        <Empty>No matches yet. Create one above.</Empty>
      ) : (
        <>
          {active.length === 0 && !showHidden ? (
            <Card className="p-4">
              <Empty>No active matches. {hidden.length > 0 ? 'All matches are archived — toggle “Show archived” to see them.' : ''}</Empty>
            </Card>
          ) : null}
          {active.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {active.map((m) => (
                <Link key={m.id} to={`/orgs/${orgId}/matches/${m.id}`} className="group">
                  <Card className="p-4 transition hover:border-accent hover:shadow-card">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-ink group-hover:text-brand">{m.name}</span>
                      <Badge tone={m.status === 'PUBLISHED' ? 'emerald' : m.status === 'OPEN' ? 'sky' : 'slate'}>{m.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted">{fmtDate(m.startDate)}{m.endDate ? ` – ${fmtDate(m.endDate)}` : ''}</p>
                    <div className="mt-2 flex items-center justify-between gap-1.5 border-t border-line pt-2">
                      <Button kind="ghost" className="px-2 py-1 text-xs text-brand" title="Open live results for this match" onClick={blocker((x) => navigate(`/orgs/${orgId}/matches/${x.id}/results`), m)}>
                        <Radio className="h-3.5 w-3.5" /> Live results
                      </Button>
                      {canHide ? (
                        <span className="flex items-center gap-1.5">
                          <Button kind="ghost" className="px-2 py-1 text-xs" title="Archive — remove from the dashboard" onClick={blocker((x) => void setStatus(x, 'ARCHIVED'), m)}>
                            <Archive className="h-3.5 w-3.5" /> Archive
                          </Button>
                          <Button kind="ghost" className="px-2 py-1 text-xs text-[#ff6b6b]" title="Cancel the match" onClick={blocker((x) => cancelMatch(x), m)}>
                            <Ban className="h-3.5 w-3.5" /> Cancel
                          </Button>
                        </span>
                      ) : null}
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          ) : null}

          {showHidden && hidden.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-[1.2px] text-muted">Archived & cancelled</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {hidden.map((m) => (
                  <Link key={m.id} to={`/orgs/${orgId}/matches/${m.id}`} className="group">
                    <Card className="p-4 opacity-75 transition hover:border-accent hover:opacity-100">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-ink group-hover:text-brand">{m.name}</span>
                        <Badge tone={m.status === 'CANCELLED' ? 'rose' : 'slate'}>{m.status}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted">{fmtDate(m.startDate)}</p>
                      {canHide ? (
                        <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-line pt-2">
                          <Button kind="ghost" className="px-2 py-1 text-xs" title="Bring the match back (status → PUBLISHED)" onClick={blocker((x) => void setStatus(x, 'PUBLISHED'), m)}>
                            <Undo2 className="h-3.5 w-3.5" /> Restore
                          </Button>
                        </div>
                      ) : null}
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}