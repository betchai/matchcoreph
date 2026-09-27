import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { BarChart3, Maximize2, RefreshCw, Target, Trophy, Users, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { Badge, Card, Empty, ErrorBanner, PageHeader, Progress, Spinner, StatCard, Table, Td, Th } from '../components/ui.js';

type StandingsRow = {
  registrationId: string;
  rank: number;
  rankDisplay: string;
  shooterName: string;
  matchNumber: string | null;
  declaredPowerFactor: string;
  divisionName: string | null;
  categoryName: string | null;
  matchTotal: number;
  competitorStatus: string;
  hasScores: boolean;
  stagePoints: Record<string, number>;
};

type MatchStandings = {
  computedAt: string;
  overall: StandingsRow[];
  divisions: { divisionId: string | null; divisionName: string | null; rows: StandingsRow[] }[];
};

type StageSummary = {
  stageId: string;
  number: number;
  name: string;
  scoringMethod: string;
  maximumStagePoints: number;
  scoredCount: number;
  divisionWinnerHf: number | null;
  divisionWinnerFinalTime: number | null;
  divisionWinnerName: string | null;
  completed: boolean;
};

type MatchMeta = {
  name: string;
  status: string;
  registrationFee: number;
  registrationsPaid: number;
  feesCollected: number;
  registrationCount: number;
  stageCount: number;
  squadCount: number;
};

type RegistrationRow = {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  paid: boolean;
  divisionName: string | null;
  categoryName: string | null;
  declaredPowerFactor: string;
  squadName: string | null;
};

type ScoreRow = {
  registrationId: string;
  stageId: string;
  shooterName: string;
  status: string;
  misses: number;
  paperNoShoots: number;
  procedurals: number;
  penaltiesOther: number;
  penaltyPoints: number | null;
};

const money = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pct = (n: number) => `${n.toFixed(1)}%`;

const finite = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

type DisciplineShooter = { name: string; stages: number; misses: number; nos: number; proc: number; other: number; penPts: number };

function DisciplineRows({ rows }: { rows: DisciplineShooter[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Competitor</Th>
          <Th right>Stages</Th>
          <Th right>Misses</Th>
          <Th right>N/S</Th>
          <Th right>Proc</Th>
          <Th>Other</Th>
          <Th right>Penalty pts</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => {
          const heavy = d.penPts >= d.stages * 2;
          return (
            <tr key={d.name} className={d.penPts === 0 ? 'bg-brand/5' : heavy ? 'bg-rose-500/5' : undefined}>
              <Td className="font-semibold">
                {d.name}
                {d.penPts === 0 ? <span className="ml-2 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600">CLEAN</span> : null}
                {heavy ? <span className="ml-2 rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-400">PENALTY HEAVY</span> : null}
              </Td>
              <Td right>{d.stages}</Td>
              <Td right mono className={d.misses > 0 ? 'font-bold text-rose-400' : 'text-muted'}>{d.misses}</Td>
              <Td right mono className={d.nos > 0 ? 'font-bold text-amber' : 'text-muted'}>{d.nos}</Td>
              <Td right mono className={d.proc > 0 ? 'font-bold text-amber' : 'text-muted'}>{d.proc}</Td>
              <Td right mono className={d.other > 0 ? 'font-bold text-amber' : 'text-muted'}>{d.other}</Td>
              <Td right mono className={d.penPts > 0 ? 'font-semibold' : 'text-muted'}>{d.penPts}</Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function InsightsPopup({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-4 sm:items-center sm:p-8" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl rounded-2xl border border-amber/40 bg-[#26282b] shadow-2xl">
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 rounded-t-2xl border-b border-line bg-[#232527] px-5 py-4">
          <h3 className="flex items-center gap-2 text-lg font-bold text-ink">{title}</h3>
          <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-[#343639] hover:text-ink" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-auto rounded-b-2xl bg-[#26282b] p-5">{children}</div>
      </div>
    </div>
  );
}

export default function InsightsPage() {
  const { orgId = '', matchId = '' } = useParams();
  const [standings, setStandings] = useState<MatchStandings | null>(null);
  const [stageSummaries, setStageSummaries] = useState<StageSummary[] | null>(null);
  const [registrations, setRegistrations] = useState<RegistrationRow[] | null>(null);
  const [scores, setScores] = useState<ScoreRow[] | null>(null);
  const [match, setMatch] = useState<MatchMeta | null>(null);
  const [popup, setPopup] = useState<'distribution' | 'discipline' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError('');
      try {
        const [r, stages, regs, meta] = await Promise.all([
          api<MatchStandings>(`/api/orgs/${orgId}/matches/${matchId}/results`),
          api<StageSummary[]>(`/api/orgs/${orgId}/matches/${matchId}/results/stages`),
          api<RegistrationRow[]>(`/api/orgs/${orgId}/matches/${matchId}/registrations`),
          api<MatchMeta>(`/api/orgs/${orgId}/matches/${matchId}`).catch(() => null),
        ]);
        setStandings(r);
        setStageSummaries(stages);
        setRegistrations(regs);
        if (meta) setMatch(meta);
        void api<ScoreRow[]>(`/api/orgs/${orgId}/matches/${matchId}/scores`).then(setScores).catch(() => setScores(null));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load insights');
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [orgId, matchId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const insights = useMemo(() => {
    if (!standings || !stageSummaries || !registrations) return null;

    const scored = standings.overall.filter((r) => r.hasScores).map((r) => ({ ...r, points: Object.values(r.stagePoints ?? {}).filter(finite) }));
    const totals = scored.map((r) => r.matchTotal).filter(finite);
    const champion = scored.reduce<StandingsRow | null>((best, r) => (best === null || r.matchTotal > best.matchTotal ? r : best), null);

    const mean = (arr: number[]) => (arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length);

    const sorted = [...totals].sort((a, b) => a - b);
    const median = sorted.length === 0 ? 0 : (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;

    const bucketSpecs = [
      { label: '≥90% of champion', max: 1.0001, min: 0.9 },
      { label: '70–90%', max: 0.9, min: 0.7 },
      { label: '50–70%', max: 0.7, min: 0.5 },
      { label: '30–50%', max: 0.5, min: 0.3 },
      { label: '<30%', max: 0.3, min: -Infinity },
    ];
    const championTotal = champion ? champion.matchTotal : 1;
    const buckets = bucketSpecs.map((b) => ({ label: b.label, count: totals.filter((t) => t / championTotal >= b.min && t / championTotal < b.max).length }));

    const stageRows = stageSummaries
      .filter((s) => s.maximumStagePoints > 0 && s.scoredCount > 0)
      .map((s) => {
        const pts: number[] = [];
        for (const r of scored) {
          const v = r.stagePoints[s.stageId];
          if (finite(v)) pts.push(v);
        }
        const avg = pts.length ? mean(pts) : 0;
        const winnerPts = pts.length ? Math.max(...pts) : 0;
        const winner = scored.find((r) => finite(r.stagePoints[s.stageId]) && r.stagePoints[s.stageId] === winnerPts) ?? null;
        return {
          ...s,
          avgPct: s.maximumStagePoints > 0 ? (avg / s.maximumStagePoints) * 100 : 0,
          winnerPct: s.maximumStagePoints > 0 ? (winnerPts / s.maximumStagePoints) * 100 : 0,
          winnerName: winner?.shooterName ?? s.divisionWinnerName ?? null,
          winnerPts,
        };
      })
      .sort((a, b) => a.avgPct - b.avgPct);

    const hardest = stageRows[0] ?? null;
    const easiest = stageRows[stageRows.length - 1] ?? null;

    const stageWins = new Map<string, number>();
    for (const s of stageRows) {
      if (s.winnerName) stageWins.set(s.winnerName, (stageWins.get(s.winnerName) ?? 0) + 1);
    }
    const stageHunters = [...stageWins.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));

    const disciplineRows = (scores ?? []).filter((r) => r.status === 'VERIFIED');
    const disciplineSource = disciplineRows.length > 0 ? disciplineRows : scores ?? [];
    const discipline = (() => {
      const byReg = new Map<string, { name: string; stages: Set<string>; misses: number; nos: number; proc: number; other: number; penPts: number }>();
      for (const r of disciplineSource) {
        const e = byReg.get(r.registrationId) ?? { name: r.shooterName, stages: new Set<string>(), misses: 0, nos: 0, proc: 0, other: 0, penPts: 0 };
        e.name = r.shooterName;
        e.stages.add(r.stageId);
        e.misses += r.misses;
        e.nos += r.paperNoShoots;
        e.proc += r.procedurals;
        e.other += r.penaltiesOther;
        e.penPts += r.penaltyPoints ?? 0;
        byReg.set(r.registrationId, e);
      }
      return [...byReg.values()]
        .map((e) => ({ name: e.name, stages: e.stages.size, misses: e.misses, nos: e.nos, proc: e.proc, other: e.other, penPts: e.penPts }))
        .sort((a, b) => b.penPts - a.penPts);
    })();

    const podium = scored.sort((a, b) => b.matchTotal - a.matchTotal).slice(0, 5);

    const divisionStats = new Map<string, { count: number; scored: number; totals: number[]; withScoresNames: string[] }>();
    for (const r of registrations) {
      const key = r.divisionName ?? '—';
      const e = divisionStats.get(key) ?? { count: 0, scored: 0, totals: [] as number[], withScoresNames: [] as string[] };
      e.count += 1;
      const inScored = standings.overall.find((s) => s.registrationId === r.id);
      if (inScored && inScored.hasScores) {
        e.scored += 1;
        e.totals.push(inScored.matchTotal);
      }
      divisionStats.set(key, e);
    }
    const divisions = [...divisionStats.entries()].map(([name, e]) => ({
      name,
      count: e.count,
      scored: e.scored,
      avgTotal: e.totals.length ? mean(e.totals) : null,
      champion: e.totals.length ? Math.max(...e.totals) : null,
      championName: e.totals.length ? (standings.overall.find((s) => s.hasScores && s.divisionName === name && s.matchTotal === Math.max(...e.totals))?.shooterName ?? null) : null,
    })).sort((a, b) => b.count - a.count);

    const categoryStats = new Map<string, number>();
    for (const r of registrations) categoryStats.set(r.categoryName ?? '—', (categoryStats.get(r.categoryName ?? '—') ?? 0) + 1);
    const categories = [...categoryStats.entries()].sort((a, b) => b[1] - a[1]);

    const pfStats = new Map<string, number>();
    for (const r of registrations) pfStats.set(r.declaredPowerFactor ?? '—', (pfStats.get(r.declaredPowerFactor ?? '—') ?? 0) + 1);

    const paidCount = registrations.filter((r) => r.paid).length;
    const activeCount = registrations.filter((r) => !['REGISTERED', 'WAITLIST'].includes(r.status)).length;
    const dnfCount = registrations.filter((r) => r.status === 'COMPLETED' && !scored.some((s) => s.registrationId === r.id)).length;

    return {
      scored,
      totals,
      champion,
      championName: champion?.shooterName ?? '—',
      championTotal: champion?.matchTotal ?? 0,
      runnerUp: podium[1] ?? null,
      mean,
      median,
      buckets,
      stageRows,
      hardest,
      easiest,
      stageHunters,
      discipline,
      podium,
      divisions,
      categories,
      pfStats,
      paidCount,
      activeCount,
      dnfCount,
    };
  }, [standings, stageSummaries, registrations, scores]);

  if (!standings || !stageSummaries || !registrations) return error ? <ErrorBanner message={error} /> : <Spinner />;

  const totalRegistered = registrations.length;
  const scoredCount = insights?.totals.length ?? 0;
  const stagesWithScores = (stageSummaries ?? []).filter((s) => s.scoredCount > 0).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={match?.name ? `${match.name} · Insights` : 'Insights'}
        subtitle={`${match?.status ?? ''}${standings.computedAt ? ` · computed ${new Date(standings.computedAt).toLocaleString()}` : ''} · derived from match results`}
        actions={
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand transition hover:text-gold">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Competitors"
          value={totalRegistered}
          delta={`${insights?.paidCount ?? 0} paid · ${insights?.activeCount ?? 0} on the range`}
        />
        <StatCard
          label="Scored"
          value={`${scoredCount}/${totalRegistered}`}
          delta={scoredCount > 0 ? `${pct((scoredCount / totalRegistered) * 100)} of the field has scores` : 'waiting for score entry'}
          deltaTone={scoredCount > 0 ? 'green' : 'muted'}
        />
        <StatCard
          label="Champion total"
          value={insights ? insights.championTotal.toFixed(3) : '—'}
          delta={insights?.runnerUp ? `beats #2 by ${(insights.championTotal - insights.runnerUp.matchTotal).toFixed(3)}` : 'no scores yet'}
          deltaTone="amber"
        />
        <StatCard
          label="Fees collected"
          value={match ? money(match.feesCollected ?? 0) : '—'}
          delta={`${insights?.paidCount ?? 0} paid · ${match && match.registrationFee ? money(match.registrationFee) : 'no fee'} each`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="relative cursor-pointer border-amber/40 bg-amber/[0.04] p-5 transition hover:border-amber/70 hover:bg-amber/[0.08]" onClick={() => setPopup('distribution')}>
          <span className="absolute right-4 top-4 rounded bg-amber/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber">Key insight</span>
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink"><BarChart3 className="h-4 w-4 text-brand" /> Performance distribution</h3>
          {insights && insights.totals.length > 0 ? (
            <>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div><p className="text-xs font-bold text-muted">Mean</p><p className="mt-0.5 text-lg font-extrabold text-ink">{insights.mean(insights.totals).toFixed(3)}</p></div>
                <div><p className="text-xs font-bold text-muted">Median</p><p className="mt-0.5 text-lg font-extrabold text-ink">{insights.median.toFixed(3)}</p></div>
                <div><p className="text-xs font-bold text-muted">Range</p><p className="mt-0.5 text-lg font-extrabold text-ink">{(insights.championTotal - Math.min(...insights.totals)).toFixed(1)}</p></div>
              </div>
              <ul className="mt-4 space-y-2.5">
                {insights.buckets.map((b) => (
                  <li key={b.label}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-muted">{b.label}</span>
                      <span className="font-bold text-ink">{b.count} shooter{b.count === 1 ? '' : 's'}</span>
                    </div>
                    <Progress value={insights.totals.length ? (b.count / insights.totals.length) * 100 : 0} tone={b.count > 0 ? 'brand' : 'green'} />
                  </li>
                ))}
              </ul>
              <p className="mt-4 flex items-center gap-1.5 border-t border-line pt-3 text-[11px] font-semibold text-brand"><Maximize2 className="h-3.5 w-3.5" /> Click to expand</p>
            </>
          ) : (
            <Empty>No match totals yet — scores appear after the first stage is computed.</Empty>
          )}
        </Card>

        <Card className="relative cursor-pointer border-amber/40 bg-amber/[0.04] p-5 transition hover:border-amber/70 hover:bg-amber/[0.08]" onClick={() => setPopup('discipline')}>
          <span className="absolute right-4 top-4 rounded bg-amber/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber">Key insight</span>
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink"><Target className="h-4 w-4 text-brand" /> Shooting discipline</h3>
          <p className="mt-1 text-xs text-muted">
            Misses, no-shoot hits and procedural penalties in confirmed scores — lower is cleaner. Most penalties first.
          </p>
          {insights && insights.discipline.length > 0 ? (
            <div className="mt-4 max-h-72 overflow-auto">
              <DisciplineRows rows={insights.discipline.slice(0, 15)} />
            </div>
          ) : (
            <Empty>No confirmed scores yet to analyze shooting discipline.</Empty>
          )}
          {insights && insights.discipline.length > 0 ? (
            <p className="mt-4 flex items-center gap-1.5 border-t border-line pt-3 text-[11px] font-semibold text-brand"><Maximize2 className="h-3.5 w-3.5" /> Click to expand</p>
          ) : null}
        </Card>
      </div>

      <Card className="p-0">
        <div className="border-b border-line p-5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink"><Trophy className="h-4 w-4 text-brand" /> Stage difficulty</h3>
          <p className="mt-0.5 text-xs text-muted">
            Average points the field collected on each stage (win = 100%). Hardest stage shown first.
            {insights && insights.stageHunters.length > 0 ? <> · Stage hunters: {insights.stageHunters.map((h) => `${h.name} (${h.count})`).join(', ')}</> : null}
          </p>
        </div>
        {insights && insights.stageRows.length > 0 ? (
          <div className="max-h-[30rem] overflow-auto">
            <Table>
              <thead className="sticky top-0">
                <tr>
                  <Th>Stage</Th>
                  <Th>Method</Th>
                  <Th right>Max</Th>
                  <Th right>Scored</Th>
                  <Th>Field avg</Th>
                  <Th>Winner</Th>
                  <Th right>Winner pts</Th>
                </tr>
              </thead>
              <tbody>
                {insights.stageRows.map((s) => (
                  <tr key={s.stageId} className={s.stageId === insights.hardest?.stageId ? 'bg-rose-500/5' : s.stageId === insights.easiest?.stageId ? 'bg-emerald-500/5' : undefined}>
                    <Td>
                      <span className="font-semibold">{s.number}. {s.name}</span>
                      {s.stageId === insights.hardest?.stageId ? <Badge tone="rose" >Hardest</Badge> : null}
                      {s.stageId === insights.easiest?.stageId ? <Badge tone="emerald">Easiest</Badge> : null}
                    </Td>
                    <Td className="text-muted">{s.scoringMethod.replace(/_/g, ' ')}</Td>
                    <Td right mono>{s.maximumStagePoints}</Td>
                    <Td right>{s.scoredCount}</Td>
                    <Td className="min-w-[10rem]">
                      <div className="mb-1 flex justify-between text-xs text-muted"><span>{pct(s.avgPct)}</span></div>
                      <Progress value={s.avgPct} tone={s.avgPct < 50 ? 'green' : 'brand'} />
                    </Td>
                    <Td className="text-muted">{s.winnerName ?? '—'}</Td>
                    <Td right mono>{s.winnerPts.toFixed(3)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          <Empty>No scored stages to analyze yet.</Empty>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="border-b border-line p-5">
            <h3 className="flex items-center gap-2 text-sm font-bold text-ink"><Trophy className="h-4 w-4 text-brand" /> Podium & gap to champion</h3>
          </div>
          <div className="p-2">
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Competitor</Th>
                  <Th>Division</Th>
                  <Th right>Total</Th>
                  <Th right>Gap</Th>
                </tr>
              </thead>
              <tbody>
                {insights && insights.podium.length > 0 ? (
                  insights.podium.map((r, i) => (
                    <tr key={r.registrationId}>
                      <Td><Tag rank={r.rank} /></Td>
                      <Td className="font-semibold">{r.shooterName}{i === 0 ? <Badge tone="emerald">CHAMPION</Badge> : null}</Td>
                      <Td className="text-muted">{r.divisionName ?? '—'}</Td>
                      <Td right mono className="font-semibold">{r.matchTotal.toFixed(3)}</Td>
                      <Td right mono className={i === 0 ? 'text-muted' : 'text-amber'}>
                        {i === 0 ? '—' : `-${((insights.championTotal - r.matchTotal) / insights.championTotal) * 100 > 0 ? pct(((insights.championTotal - r.matchTotal) / insights.championTotal) * 100) : '0.0%'}`}
                      </Td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={5} className="px-4 py-6"><Empty>No rankings to show yet.</Empty></td></tr>
                )}
              </tbody>
            </Table>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink"><Users className="h-4 w-4 text-brand" /> Field composition</h3>
          <div className="mt-4 grid gap-6 sm:grid-cols-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted">Divisions</p>
              <ul className="mt-2 space-y-2">
                {insights && insights.divisions.map((d) => (
                  <li key={d.name} className="text-sm">
                    <div className="flex justify-between text-ink"><span className="font-semibold">{d.name}</span><span>{d.count}</span></div>
                    <p className="text-[11px] text-muted">
                      {d.scored}{d.championName ? <> · {d.championName}</> : null}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted">Categories</p>
              <ul className="mt-2 space-y-2">
                {insights && insights.categories.map(([name, count]) => (
                  <li key={name} className="flex justify-between text-sm text-ink"><span>{name}</span><span>{count}</span></li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted">Power factor</p>
              <ul className="mt-2 space-y-2">
                {insights && [...insights.pfStats.entries()].map(([pf, count]) => (
                  <li key={pf} className="flex justify-between text-sm text-ink"><span>{pf}</span><span>{count}</span></li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </div>

      {popup === 'distribution' && insights ? (
        <InsightsPopup title={<><BarChart3 className="h-5 w-5 text-brand" /> Performance distribution</>} onClose={() => setPopup(null)}>
          <div className="mb-5 grid grid-cols-3 gap-3 text-center">
            <div><p className="text-xs font-bold text-muted">Mean</p><p className="mt-0.5 text-2xl font-extrabold text-ink">{insights.mean(insights.totals).toFixed(3)}</p></div>
            <div><p className="text-xs font-bold text-muted">Median</p><p className="mt-0.5 text-2xl font-extrabold text-ink">{insights.median.toFixed(3)}</p></div>
            <div><p className="text-xs font-bold text-muted">Range</p><p className="mt-0.5 text-2xl font-extrabold text-ink">{(insights.championTotal - Math.min(...insights.totals)).toFixed(1)}</p></div>
          </div>
          <ul className="space-y-4">
            {insights.buckets.map((b) => (
              <li key={b.label}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="text-muted">{b.label}</span>
                  <span className="font-bold text-ink">{b.count} shooter{b.count === 1 ? '' : 's'} · {pct((b.count / insights.totals.length) * 100)}</span>
                </div>
                <Progress value={(b.count / insights.totals.length) * 100} tone={b.count > 0 ? 'brand' : 'green'} />
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs text-muted">Buckets are relative to the champion total ({insights.championTotal.toFixed(3)} pts). {insights.totals.length} shooters have confirmed match totals.</p>
        </InsightsPopup>
      ) : null}

      {popup === 'discipline' && insights ? (
        <InsightsPopup title={<><Target className="h-5 w-5 text-brand" /> Shooting discipline ({insights.discipline.length})</>} onClose={() => setPopup(null)}>
          <p className="mb-4 text-xs text-muted">
            Misses, no-shoot hits, procedurals and other penalties per shooter across all confirmed stage scores — sorted by total penalty points lost.
          </p>
          {insights.discipline.length > 0 ? <DisciplineRows rows={insights.discipline} /> : <Empty>No confirmed scores to analyze.</Empty>}
        </InsightsPopup>
      ) : null}
    </div>
  );
}

function Tag({ rank }: { rank: number }) {
  const chip = rank === 1 ? 'bg-[#59451a] text-[#f4cf6f]' : rank === 2 ? 'bg-[#4a4e55] text-[#d7dbe2]' : rank === 3 ? 'bg-[#5a3a2a] text-[#f0a878]' : 'bg-[#343639] text-muted';
  return <span className={`mr-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-black ${chip}`}>{rank}</span>;
}