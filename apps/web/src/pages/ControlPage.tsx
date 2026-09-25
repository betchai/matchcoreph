import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Clock, Download, Gauge, RefreshCw, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { useMatch } from '../lib/match.js';
import { Badge, Button, Card, Empty, ErrorBanner, PageHeader, Progress, Select, Spinner, StatCard, Table, Td, Th } from '../components/ui.js';

type ControlStats = {
  totalCompetitors: number;
  checkedIn: number;
  scored: number;
  verified: number;
  pendingVerification: number;
  disputed: number;
  stagesCompleted: number;
  overallCompletionPct: number;
  stageStatuses: { stageId: string; number: number; name: string; scoredCount: number; totalRegistrations: number }[];
};

type StandingsRow = {
  registrationId: string;
  rank: number;
  rankDisplay: string;
  tie: boolean;
  shooterName: string;
  matchNumber: string | null;
  declaredPowerFactor: string;
  divisionName: string | null;
  categoryName: string | null;
  matchTotal: number;
  competitorStatus: string;
  hasScores: boolean;
};

type MatchStandings = {
  computedAt: string;
  overall: StandingsRow[];
  divisions: { divisionId: string | null; divisionName: string | null; rows: StandingsRow[] }[];
  categories: { categoryId: string | null; categoryName: string | null; rows: StandingsRow[] }[];
};

type StageSummary = {
  stageId: string;
  number: number;
  name: string;
  scoringMethod: string;
  maximumStagePoints: number;
  scoredCount: number;
  divisionWinnerHf: number | null;
  divisionWinnerName: string | null;
  completed: boolean;
};

const REPORTS = [
  { label: 'Results CSV', file: 'results.csv' },
  { label: 'Scorecards CSV', file: 'scorecards.csv' },
  { label: 'Results HTML', file: 'results.html' },
  { label: 'Scorecards HTML', file: 'scorecards.html' },
  { label: 'Certificates HTML', file: 'certificates.html' },
];

export default function ControlPage() {
  const { orgId = '', matchId = '' } = useParams();
  const match = useMatch(orgId, matchId);
  const [stats, setStats] = useState<ControlStats | null>(null);
  const [standings, setStandings] = useState<MatchStandings | null>(null);
  const [stageSummaries, setStageSummaries] = useState<StageSummary[] | null>(null);
  const [group, setGroup] = useState<'overall' | string>('overall');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    Promise.all([
      api<ControlStats>(`/api/orgs/${orgId}/matches/${matchId}/control`),
      api<MatchStandings>(`/api/orgs/${orgId}/matches/${matchId}/results`),
      api<StageSummary[]>(`/api/orgs/${orgId}/matches/${matchId}/results/stages`),
    ])
      .then(([s, r, stages]) => {
        setStats(s);
        setStandings(r);
        setStageSummaries(stages);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load control data'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, matchId]);

  if (!stats || !standings) return error ? <ErrorBanner message={error} /> : <Spinner />;

  const rows = group === 'overall'
    ? standings.overall
    : standings.divisions.find((d) => (d.divisionId ?? '__NONE__') === group)?.rows ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Match Control Center"
        subtitle={`Match: ${match?.name ?? '…'} · Live activity · computed ${new Date(standings.computedAt).toLocaleTimeString()}`}
        actions={
          <Button kind="secondary" onClick={() => load()} disabled={loading}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Competitors" value={stats.totalCompetitors} delta={`${stats.checkedIn} checked in`} deltaTone="muted" />
        <StatCard label="Scored" value={stats.scored} delta="scores entered" deltaTone="muted" />
        <StatCard label="Verified" value={stats.verified} delta={stats.verified > 0 ? 'ready for results' : 'none yet'} />
        <StatCard label="Pending verify" value={stats.pendingVerification} delta="needs attention" deltaTone="amber" />
        <StatCard label="Open disputes" value={stats.disputed} delta="disputed scores" deltaTone={stats.disputed > 0 ? 'red' : 'muted'} />
        <StatCard label="Stages completed" value={stats.stagesCompleted} delta="of configured stages" deltaTone="muted" />
        <StatCard label="Completion" value={`${stats.overallCompletionPct}%`} delta="overall progress" deltaTone="muted" />
        <StatCard label="Checked in" value={stats.checkedIn} delta={`/ ${stats.totalCompetitors} competitors`} deltaTone="muted" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-bold text-ink">Stage progress</h3>
          {stageSummaries === null || stageSummaries.length === 0 ? (
            <Empty>No stages.</Empty>
          ) : (
            <ul className="space-y-3.5">
              {stageSummaries.map((s) => {
                const pct = stats.totalCompetitors === 0 ? 0 : Math.round((s.scoredCount / stats.totalCompetitors) * 100);
                return (
                  <li key={s.stageId}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-semibold text-ink">
                        {s.number}. {s.name} <span className="font-normal text-muted">({s.scoringMethod})</span>
                      </span>
                      <span className="text-xs text-muted">
                        {s.scoredCount}/{stats.totalCompetitors}
                        {s.divisionWinnerName ? <Badge tone="emerald">{s.divisionWinnerName}</Badge> : null}
                      </span>
                    </div>
                    <Progress value={pct} tone={s.completed ? 'green' : 'brand'} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-0">
          <div className="flex items-center justify-between gap-3 border-b border-line p-5">
            <h3 className="text-sm font-bold text-ink">Standings</h3>
            <Select value={group} onChange={(e) => setGroup(e.target.value)} className="w-auto px-2 py-1.5 text-xs">
              <option value="overall">Overall</option>
              {standings.divisions.map((d) => (
                <option key={d.divisionId ?? '__'} value={d.divisionId ?? '__NONE__'}>{d.divisionName ?? 'Overall'} division</option>
              ))}
            </Select>
          </div>
          {rows.length === 0 ? (
            <Empty>No standings yet.</Empty>
          ) : (
            <div className="max-h-96 overflow-auto">
              <Table>
                <thead className="sticky top-0">
                  <tr>
                    <Th>#</Th>
                    <Th>Competitor</Th>
                    <Th>Division</Th>
                    <Th>PF</Th>
                    <Th right>Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 60).map((r) => (
                    <tr key={`${group}-${r.registrationId}`}>
                      <Td mono>
                        {r.rankDisplay}
                        {r.tie ? <span className="ml-1 rounded bg-[#59451a] px-1 text-[10px] font-bold text-[#f2d27c]">TIE</span> : null}
                      </Td>
                      <Td className="font-semibold">{r.shooterName}</Td>
                      <Td className="text-muted">{r.divisionName ?? '—'}</Td>
                      <Td className="text-muted">{r.declaredPowerFactor}</Td>
                      <Td right mono className={r.hasScores ? 'font-semibold text-ink' : 'text-muted'}>{r.hasScores ? r.matchTotal.toFixed(3) : '–'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-ink">
          <Gauge className="h-4 w-4 text-brand" /> Match reports
        </h3>
        <div className="flex flex-wrap gap-2">
          {REPORTS.map(({ label, file }) => (
            <a
              key={file}
              href={`/api/orgs/${orgId}/matches/${matchId}/reports/${file}`}
              className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3.5 py-2 text-sm font-bold text-ink transition hover:border-brand hover:text-brand"
            >
              <Download className="h-4 w-4" /> {label}
            </a>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">CSV / HTML generated server-side on demand.</p>
      </Card>
    </div>
  );
}