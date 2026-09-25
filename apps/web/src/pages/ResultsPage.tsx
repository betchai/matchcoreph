import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Pause, Play, Radio, RefreshCw, Trophy } from 'lucide-react';
import { api } from '../lib/api.js';
import { Badge, Button, Card, Empty, ErrorBanner, PageHeader, Progress, Select, Spinner, Table, Td, Th } from '../components/ui.js';

const REFRESH_MS = 10000;

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
  divisionWinnerFinalTime: number | null;
  divisionWinnerName: string | null;
  completed: boolean;
};

type StageRow = {
  registrationId: string;
  shooterName: string;
  competitorStatus: string;
  timeSeconds: number | null;
  rawPoints: number | null;
  penaltyPoints: number | null;
  netPoints: number | null;
  hitFactor: number | null;
  finalTimeSeconds: number | null;
  timeAdjustmentsSeconds: number | null;
  stagePoints: number | null;
  isWinner: boolean;
  status: string;
};

function isTimeScoringMethod(method: string) {
  return method.endsWith('_TIME');
}

type StageDetail = {
  stage: { id: string; number: number; name: string; scoringMethod: string; maximumStagePoints: number };
  divisions: { divisionId: string | null; divisionName: string | null; rows: StageRow[] }[];
};

type MatchMeta = { match: { name: string; status: string } };

function rankChip(rank: number) {
  if (rank === 1) return 'bg-[#59451a] text-[#f4cf6f]';
  if (rank === 2) return 'bg-[#4a4e55] text-[#d7dbe2]';
  if (rank === 3) return 'bg-[#5a3a2a] text-[#f0a878]';
  return 'bg-[#343639] text-muted';
}

export default function ResultsPage() {
  const { orgId = '', matchId = '' } = useParams();
  const [standings, setStandings] = useState<MatchStandings | null>(null);
  const [stageSummaries, setStageSummaries] = useState<StageSummary[] | null>(null);
  const [details, setDetails] = useState<Record<string, StageDetail>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [matchName, setMatchName] = useState('');
  const [matchStatus, setMatchStatus] = useState('');
  const [group, setGroup] = useState<'overall' | string>('overall');
  const [category, setCategory] = useState<'overall' | string>('overall');
  const [live, setLive] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const metaDone = useRef(false);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError('');
      try {
        const [r, stages] = await Promise.all([
          api<MatchStandings>(`/api/orgs/${orgId}/matches/${matchId}/results`),
          api<StageSummary[]>(`/api/orgs/${orgId}/matches/${matchId}/results/stages`),
        ]);
        setStandings(r);
        setStageSummaries(stages);
        setLastUpdate(new Date());
        if (!metaDone.current) {
          metaDone.current = true;
          const meta = await api<MatchMeta>(`/api/orgs/${orgId}/matches/${matchId}`).catch(() => null);
          if (meta) {
            setMatchName(String(meta.match?.name ?? ''));
            setMatchStatus(String(meta.match?.status ?? ''));
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load live results');
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [orgId, matchId],
  );

  useEffect(() => {
    void load(true);
    const id = window.setInterval(() => {
      if (live) void load(true);
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load, live]);

  async function toggleStage(stageId: string) {
    if (expanded === stageId) {
      setExpanded(null);
      return;
    }
    setExpanded(stageId);
    if (!details[stageId]) {
      try {
        const d = await api<StageDetail>(`/api/orgs/${orgId}/matches/${matchId}/results/stages/${stageId}`);
        setDetails((prev) => ({ ...prev, [stageId]: d }));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load stage results');
      }
    }
  }

  if (!standings || !stageSummaries) return error ? <ErrorBanner message={error} /> : <Spinner />;

  const rows =
    category !== 'overall'
      ? standings.categories.find((c) => (c.categoryId ?? '__NONE__') === category)?.rows ?? []
      : group === 'overall'
        ? standings.overall
        : standings.divisions.find((d) => (d.divisionId ?? '__NONE__') === group)?.rows ?? [];

  const scoredCount = stageSummaries.reduce((sum, s) => sum + s.scoredCount, 0);
  const stagesWithScores = stageSummaries.filter((s) => s.scoredCount > 0).length;
  const maxScored = Math.max(1, ...stageSummaries.map((s) => s.scoredCount));
  const rankedCount = rows.filter((r) => r.hasScores).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={matchName || 'Live Results'}
        subtitle={`${matchStatus ? `${matchStatus} · ` : ''}Updated ${(lastUpdate ?? (standings.computedAt ? new Date(standings.computedAt) : null))?.toLocaleTimeString() ?? '—'} · auto-refresh every ${REFRESH_MS / 1000}s`}
        actions={
          <>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${live ? 'border-[#5a3030] bg-[#3a2626] text-[#ff7b7b]' : 'border-line bg-panel text-muted'}`}>
              <Radio className="h-3.5 w-3.5" />
              <span className={`h-1.5 w-1.5 rounded-full ${live ? 'animate-pulse bg-red' : 'bg-[#6f7377]'}`} />
              {live ? 'LIVE' : 'PAUSED'}
            </span>
            <Button kind="secondary" onClick={() => setLive((v) => !v)}>
              {live ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {live ? 'Pause' : 'Resume'}
            </Button>
            <Button kind="secondary" onClick={() => load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-0 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
            <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
              <Trophy className="h-4 w-4 text-brand" /> Leaderboard
              <span className="text-xs font-semibold text-muted">
                {scoredCount > 0 ? `${rankedCount} ranked · ${stagesWithScores}/${stageSummaries.length} stages scored` : `${rankedCount} ranked · waiting for scores`}
              </span>
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={group} onChange={(e) => setGroup(e.target.value)} className="w-auto px-2 py-1.5 text-xs" disabled={category !== 'overall'}>
                <option value="overall">Overall</option>
                {standings.divisions.map((d) => (
                  <option key={d.divisionId ?? '__'} value={d.divisionId ?? '__NONE__'}>{d.divisionName ?? 'Overall'} division</option>
                ))}
              </Select>
              {standings.categories.length > 0 ? (
                <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto px-2 py-1.5 text-xs">
                  <option value="overall">Overall</option>
                  {standings.categories.map((c) => (
                    <option key={c.categoryId ?? '__'} value={c.categoryId ?? '__NONE__'}>{c.categoryName ?? 'Overall'}</option>
                  ))}
                </Select>
              ) : null}
            </div>
          </div>
          {rows.length === 0 ? (
            <Empty>Scores will appear here live as soon as results are computed.</Empty>
          ) : (
            <div className="max-h-[34rem] overflow-auto">
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
                  {rows.map((r) => (
                    <tr key={`${category}-${group}-${r.registrationId}`} className={r.rank <= 3 ? 'bg-brand/5' : undefined}>
                      <Td>
                        <span className={`mr-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-black ${rankChip(r.rank)}`}>{r.rankDisplay}</span>
                        {r.tie ? <span className="rounded bg-[#59451a] px-1 text-[10px] font-bold text-[#f2d27c]">TIE</span> : null}
                      </Td>
                      <Td>
                        <span className="font-semibold">{r.shooterName}</span>
                        {r.matchNumber ? <span className="ml-1.5 font-mono text-[10px] text-muted">{r.matchNumber}</span> : null}
                      </Td>
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

        <Card className="p-5">
          <h3 className="mb-4 text-sm font-bold text-ink">Stage progress</h3>
          {stageSummaries.length === 0 ? (
            <Empty>No stages configured yet.</Empty>
          ) : (
            <ul className="space-y-3.5">
              {stageSummaries.map((s) => (
                <li key={s.stageId}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-semibold text-ink">
                      {s.number}. {s.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted">{s.scoredCount} scored</span>
                  </div>
                  <Progress value={(s.scoredCount / maxScored) * 100} tone={s.completed ? 'green' : 'brand'} />
                  {s.divisionWinnerName ? (
                    <Badge tone="emerald">
                      {s.divisionWinnerName}
                      {isTimeScoringMethod(s.scoringMethod)
                        ? s.divisionWinnerFinalTime !== null
                          ? ` · ${Number(s.divisionWinnerFinalTime).toFixed(4)}s`
                          : ''
                        : s.divisionWinnerHf
                          ? ` · ${Number(s.divisionWinnerHf).toFixed(4)} HF`
                          : ''}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-0">
        <div className="border-b border-line p-5">
          <h3 className="text-sm font-bold text-ink">Stage results</h3>
          <p className="mt-0.5 text-xs text-muted">Click a stage to expand its live standings.</p>
        </div>
        <div className="divide-y divide-line">
          {stageSummaries.length === 0 ? (
            <Empty>No stages configured yet.</Empty>
          ) : (
            stageSummaries.map((s) => {
              const detail = details[s.stageId];
              return (
                <div key={s.stageId}>
                  <button
                    type="button"
                    onClick={() => void toggleStage(s.stageId)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition hover:bg-[#2c2e30]"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                      {s.number}. {s.name}
                      <span className="text-xs font-normal text-muted">({s.scoringMethod})</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      <span className="font-bold uppercase tracking-wide text-[#ff7b7b]">{s.scoredCount} scored</span>
                      {s.divisionWinnerName ? <Badge tone="emerald">{s.divisionWinnerName}</Badge> : null}
                      {expanded === s.stageId ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                  </button>
                  {expanded === s.stageId ? (
                    detail ? (
                      detail.divisions.length === 0 ? (
                        <Empty>No results computed for this stage yet.</Empty>
                      ) : (
                        detail.divisions.map((div) => (
                          <div key={div.divisionId ?? '__'} className="border-t border-line">
                            <p className="px-5 pt-3 text-[11px] font-bold uppercase tracking-wider text-muted">
                              {div.divisionName ?? (div.divisionId ? `Division: ${div.divisionId}` : 'Overall')}
                            </p>
                            <div className="px-2 pb-2">
                              <Table>
                                <thead>
                                  <tr>
                                    <Th>#</Th>
                                    <Th>Competitor</Th>
                                    <Th right>Time</Th>
                                    {isTimeScoringMethod(detail.stage.scoringMethod) ? (
                                      <>
                                        <Th right>Adjust</Th>
                                        <Th right>Final</Th>
                                      </>
                                    ) : (
                                      <>
                                        <Th right>Net</Th>
                                        <Th right>HF</Th>
                                        <Th right>Pts</Th>
                                      </>
                                    )}
                                  </tr>
                                </thead>
                                <tbody>
                                  {div.rows.map((r, i) => (
                                    <tr key={r.registrationId} className={r.stagePoints === null ? 'opacity-45' : r.isWinner ? undefined : undefined}>
                                      <Td>{r.isWinner ? <span className="rounded bg-[#59451a] px-1.5 py-0.5 text-[10px] font-bold text-[#f4cf6f]">WIN</span> : i + 1}</Td>
                                      <Td className={r.isWinner ? 'font-semibold' : ''}>{r.shooterName}</Td>
                                      <Td right mono>{r.timeSeconds !== null ? r.timeSeconds.toFixed(2) : '—'}</Td>
                                      {isTimeScoringMethod(detail.stage.scoringMethod) ? (
                                        <>
                                          <Td right mono>{r.timeAdjustmentsSeconds !== null ? `${r.timeAdjustmentsSeconds.toFixed(2)}s` : '—'}</Td>
                                          <Td right mono className={r.finalTimeSeconds !== null ? 'font-semibold text-ink' : 'text-muted'}>
                                            {r.finalTimeSeconds !== null ? `${r.finalTimeSeconds.toFixed(2)}s` : '—'}
                                          </Td>
                                        </>
                                      ) : (
                                        <>
                                          <Td right mono>{r.netPoints !== null ? r.netPoints.toFixed(2) : '—'}</Td>
                                          <Td right mono>{r.hitFactor !== null ? r.hitFactor.toFixed(4) : '—'}</Td>
                                          <Td right mono className={r.stagePoints !== null ? 'font-semibold text-ink' : 'text-muted'}>
                                            {r.stagePoints !== null ? r.stagePoints.toFixed(3) : '—'}
                                          </Td>
                                        </>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </Table>
                            </div>
                          </div>
                        ))
                      )
                    ) : (
                      <div className="flex justify-center px-5 py-6"><Spinner /></div>
                    )
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}