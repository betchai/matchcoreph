import type { Db } from '../db/client.js';
import { uuid, notFound } from './utils.js';
import { listStages, getStage } from './stages.js';
import { listScores, paramsForMatch, type ScoreWithCompetitor } from './scores.js';
import type { Match } from '@blinkscore/core';
import {
  groupByKey,
  rankCompetitors,
  rankStage,
  rankStageByFinalTime,
  computeMatchTotal,
  isTimeScoringMethod,
  type RankedRow,
  type TotaledCompetitor,
} from '@blinkscore/core';

const UNRANKABLE = new Set(['DQ', 'DNS', 'DNF', 'WITHDRAWN']);

function rankable(status: string): boolean {
  return !UNRANKABLE.has(status);
}

export interface StageRowResult extends ScoreWithCompetitor {
  stagePoints: number | null;
  isWinner: boolean;
}

/**
 * Computes and persists stage results for a single stage, per division.
 * Stage points are awarded relative to the division's stage winner.
 */
export function computeStageResults(db: Db, match: Match, stageId: string, opts: { persist?: boolean } = {}): Record<string, StageRowResult[]> {
  const stage = getStage(db, match, stageId);
  const scores = listScores(db, match, { stageId: stage.id });
  const params = paramsForMatch(db, match);
  const precision = params.precisionStagePoints;
  const timePrecision = params.precisionTime;
  const minZero = params.stagePointsMinZero;
  const timeScoring = isTimeScoringMethod(stage.scoringMethod);

  const grouped = groupByKey(scores, (s) => s.divisionId);
  const out: Record<string, StageRowResult[]> = {};

  for (const group of grouped) {
    const rows: StageRowResult[] = group.rows.map((s) => ({
      ...s,
      stagePoints: null,
      isWinner: false,
    }));

    if (timeScoring) {
      // PSMOC Time Scoring: lowest final time wins; no stage points are awarded,
      // so time-scoring stages never contribute to an aggregate match ranking.
      const ranked = rankStageByFinalTime(
        rows.map((r) => ({
          registrationId: r.registrationId,
          competitorStatus: r.competitorStatus,
          competitorIsScored: rankable(r.competitorStatus) && r.finalTimeSeconds !== null,
          finalTimeSeconds: r.finalTimeSeconds,
          timeAdjustmentsSeconds: r.timeAdjustmentsSeconds ?? 0,
          stagePoints: null as number | null,
        })),
        timePrecision,
      );
      const minTime = Math.min(...ranked.map((r) => r.finalTimeSeconds ?? Infinity));
      for (const r of rows) {
        const rr = ranked.find((x) => x.registrationId === r.registrationId) ?? null;
        r.isWinner = rr !== null && rr.finalTimeSeconds !== null && rr.finalTimeSeconds === minTime && minTime !== Infinity;
        if (opts.persist) {
          db.prepare(
            `INSERT INTO stage_results (id, match_id, stage_id, division_id, registration_id, hit_factor, final_time_seconds, stage_points, rank, tie, calculated_at)
             VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, 0, ?)
             ON CONFLICT (stage_id, division_id, registration_id) DO UPDATE SET
               hit_factor = NULL, final_time_seconds = excluded.final_time_seconds, stage_points = NULL, calculated_at = excluded.calculated_at`,
          ).run(
            uuid(),
            match.id,
            stage.id,
            group.key ?? '__NO_DIVISION__',
            r.registrationId,
            rr?.finalTimeSeconds ?? null,
            new Date().toISOString(),
          );
        }
      }
      out[group.key ?? '__NO_DIVISION__'] = rows;
      continue;
    }

    const ranked = rankStage(
      rows.map((r) => ({
        registrationId: r.registrationId,
        competitorStatus: r.competitorStatus,
        competitorIsScored: rankable(r.competitorStatus) && r.hitFactor !== null,
        hitFactor: r.hitFactor,
        stagePoints: null as number | null,
        netPoints: r.netPoints,
      })),
      stage.maximumStagePoints,
      precision,
      minZero,
    );
    const byReg = new Map(ranked.map((r) => [r.registrationId, r]));
    const maxPoints = Math.max(0, ...ranked.map((r) => r.stagePoints ?? 0));
    const winnerHf = Math.max(0, ...ranked.map((r) => r.hitFactor ?? 0));
    for (const r of rows) {
      const rr = byReg.get(r.registrationId);
      const stagePoints = rr?.stagePoints ?? 0;
      const isWinner = rr !== undefined && rr.hitFactor !== null && rr.hitFactor === winnerHf && winnerHf > 0;
      r.stagePoints = stagePoints;
      r.isWinner = isWinner;
      if (opts.persist) {
        db.prepare(
          `INSERT INTO stage_results (id, match_id, stage_id, division_id, registration_id, hit_factor, final_time_seconds, stage_points, rank, tie, calculated_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, 0, ?)
           ON CONFLICT (stage_id, division_id, registration_id) DO UPDATE SET
             hit_factor = excluded.hit_factor, final_time_seconds = NULL, stage_points = excluded.stage_points, calculated_at = excluded.calculated_at`,
        ).run(
          uuid(),
          match.id,
          stage.id,
          group.key ?? '__NO_DIVISION__',
          r.registrationId,
          r.hitFactor,
          r.stagePoints,
          new Date().toISOString(),
        );
      }
    }
    out[group.key ?? '__NO_DIVISION__'] = rows;
  }
  return out;
}

export function recomputeStageResultsForMatch(db: Db, match: Match): void {
  // Purge previously persisted rows first: group upserts are keyed on
  // (stage_id, division_id, registration_id), so a competitor who moved
  // divisions would otherwise leave a stale row behind that standings read
  // nondeterministically.
  db.prepare('DELETE FROM stage_results WHERE match_id = ?').run(match.id);
  const stages = listStages(db, match);
  for (const stage of stages) {
    computeStageResults(db, match, stage.id, { persist: true });
  }
}

interface StandingsCompetitor {
  registrationId: string;
  divisionId: string | null;
  categoryId: string | null;
  competitorStatus: string;
  stagePoints: Record<string, number>;
  matchTotal: number;
  excluded: boolean;
  /** True once the competitor has at least one computed stage result. */
  hasScores: boolean;
  shooterName: string;
  matchNumber: string | null;
  declaredPowerFactor: string;
}

export interface StandingsRow extends RankedRow {
  shooterName: string;
  matchNumber: string | null;
  declaredPowerFactor: string;
  divisionName: string | null;
  categoryName: string | null;
  /** False while the competitor has no computed stage results yet. */
  hasScores: boolean;
}

export interface MatchStandings {
  computedAt: string;
  overall: StandingsRow[];
  divisions: { divisionId: string | null; divisionName: string | null; rows: StandingsRow[] }[];
  categories: { categoryId: string | null; categoryName: string | null; rows: StandingsRow[] }[];
}

/**
 * Computes match standings from persisted stage results.
 * Authoritative server-side ranking across overall, division and category groupings.
 */
export function computeMatchStandings(db: Db, match: Match, opts: { persist?: boolean } = {}): MatchStandings {
  recomputeStageResultsForMatch(db, match);
  const regs = db
    .prepare(
      `SELECT r.id AS registration_id, r.division_id, r.category_id, r.status, r.match_number, r.declared_power_factor,
              sh.first_name || ' ' || sh.last_name AS shooter_name
       FROM match_registrations r
       JOIN shooters sh ON sh.id = r.shooter_id
       WHERE r.match_id = ?`,
    )
    .all(match.id) as Record<string, unknown>[];

  const sr = db
    .prepare(
      `SELECT stage_id, division_id, registration_id, stage_points
       FROM stage_results WHERE match_id = ?`,
    )
    .all(match.id) as Record<string, unknown>[];

  const pointsByReg = new Map<string, Record<string, number>>();
  for (const row of sr) {
    const regId = String(row.registration_id);
    const map = pointsByReg.get(regId) ?? {};
    map[String(row.stage_id)] = Number(row.stage_points ?? 0);
    pointsByReg.set(regId, map);
  }

  const params = paramsForMatch(db, match);
  const precision = params.precisionStagePoints;

  const competitors: StandingsCompetitor[] = regs.map((r) => {
    const registrationId = String(r.registration_id);
    const stagePoints = pointsByReg.get(registrationId) ?? {};
    const status = String(r.status);
    return {
      registrationId,
      divisionId: (r.division_id as string) ?? null,
      categoryId: (r.category_id as string) ?? null,
      competitorStatus: status,
      stagePoints,
      matchTotal: computeMatchTotal(stagePoints, precision),
      excluded: !rankable(status),
      hasScores: pointsByReg.has(registrationId) && rankable(status),
      shooterName: String(r.shooter_name),
      matchNumber: (r.match_number as string) ?? null,
      declaredPowerFactor: String(r.declared_power_factor),
    };
  });

  // Ranked competitors first (ties only among those with results), then any
  // registrations that have no computed stage results yet at the bottom,
  // listed without a rank so they are never reported as tied at zero.
  const ordered = (comps: StandingsCompetitor[]): RankedRow[] => {
    const totaled: TotaledCompetitor[] = comps
      .filter((c) => !c.excluded)
      .map((c) => ({
        registrationId: c.registrationId,
        divisionId: c.divisionId,
        categoryId: c.categoryId,
        competitorStatus: c.competitorStatus,
        matchTotal: c.matchTotal,
        excluded: !c.hasScores,
        stagePoints: c.stagePoints,
      }));
    const ranked = rankCompetitors(totaled, precision, match.tieBreakMethod ?? 'NONE');
    const pending = comps
      .filter((c) => !c.excluded && !c.hasScores)
      .sort((a, b) => a.shooterName.localeCompare(b.shooterName));
    const unranked: RankedRow[] = pending.map((c) => ({
      registrationId: c.registrationId,
      divisionId: c.divisionId,
      categoryId: c.categoryId,
      competitorStatus: c.competitorStatus,
      matchTotal: 0,
      excluded: false,
      stagePoints: {},
      rank: 0,
      tie: false,
      tieCount: 1,
      rankDisplay: '–',
    }));
    return [...ranked, ...unranked];
  };

  const enrich = (rows: RankedRow[]): StandingsRow[] =>
    rows.map((row) => {
      const c = competitors.find((x) => x.registrationId === row.registrationId) ?? {
        registrationId: row.registrationId,
        divisionId: row.divisionId,
        categoryId: row.categoryId,
        competitorStatus: row.competitorStatus,
        stagePoints: row.stagePoints,
        matchTotal: row.matchTotal,
        excluded: false,
        hasScores: false,
        shooterName: 'Unknown',
        matchNumber: null,
        declaredPowerFactor: 'MINOR',
      };
      const divisionName = c.divisionId
        ? ((db.prepare('SELECT name FROM divisions WHERE id = ?').get(c.divisionId) as { name: string } | undefined)?.name ?? null)
        : null;
      const categoryName = c.categoryId
        ? ((db.prepare('SELECT name FROM categories WHERE id = ?').get(c.categoryId) as { name: string } | undefined)?.name ?? null)
        : null;
      return { ...row, shooterName: c.shooterName, matchNumber: c.matchNumber, declaredPowerFactor: c.declaredPowerFactor, divisionName, categoryName, hasScores: c.hasScores };
    });

  const overall = enrich(ordered(competitors));

  const divisionGroups = groupByKey(competitors, (c) => c.divisionId);
  const divisions = divisionGroups.map((g) => {
    const divisionId = g.key;
    const divName = divisionId
      ? ((db.prepare('SELECT name FROM divisions WHERE id = ?').get(divisionId) as { name: string } | undefined)?.name ?? 'Unknown')
      : 'Overall';
    return { divisionId, divisionName: divName, rows: enrich(ordered(g.rows)) };
  });

  const categoryGroups = groupByKey(competitors, (c) => c.categoryId);
  const categories = categoryGroups.map((g) => {
    const categoryId = g.key;
    const catName = categoryId
      ? ((db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId) as { name: string } | undefined)?.name ?? 'Unknown')
      : 'Overall';
    return { categoryId, categoryName: catName, rows: enrich(ordered(g.rows)) };
  });

  const computedAt = new Date().toISOString();

  if (opts.persist) {
    const upsert = db.prepare(
      `INSERT INTO match_results (id, match_id, division_id, registration_id, match_total, rank, tie, calculated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (match_id, division_id, registration_id) DO UPDATE SET
         match_total = excluded.match_total, rank = excluded.rank, tie = excluded.tie, calculated_at = excluded.calculated_at`,
    );
    const all = [overall, ...divisions.map((d) => d.rows)].flat();
    for (const row of all) {
      upsert.run(
        uuid(),
        match.id,
        row.divisionId,
        row.registrationId,
        row.matchTotal,
        row.rank,
        row.tie ? 1 : 0,
        computedAt,
      );
    }
  }

  return { computedAt, overall, divisions, categories };
}

export function getStageResults(db: Db, match: Match, stageId: string): Record<string, unknown> {
  const stage = getStage(db, match, stageId);
  const result = computeStageResults(db, match, stage.id, { persist: true });
  return {
    stage: {
      id: stage.id,
      number: stage.number,
      name: stage.name,
      scoringMethod: stage.scoringMethod,
      maximumStagePoints: stage.maximumStagePoints,
    },
    divisions: Object.entries(result).map(([key, rows]) => {
      const divisionName =
        key === '__NO_DIVISION__'
          ? 'Overall'
          : ((db.prepare('SELECT name FROM divisions WHERE id = ?').get(key) as { name: string } | undefined)?.name ?? key);
      return {
        divisionId: key === '__NO_DIVISION__' ? null : key,
        divisionName,
        rows: rows
          .map((r) => ({
            registrationId: r.registrationId,
            shooterName: r.shooterName,
            competitorStatus: r.competitorStatus,
            timeSeconds: r.timeSeconds,
            rawPoints: r.rawPoints,
            penaltyPoints: r.penaltyPoints,
            netPoints: r.netPoints,
            hitFactor: r.hitFactor,
            finalTimeSeconds: r.finalTimeSeconds,
            timeAdjustmentsSeconds: r.timeAdjustmentsSeconds,
            stagePoints: r.stagePoints,
            isWinner: r.isWinner,
            status: r.status,
          }))
          .sort((a, b) =>
            isTimeScoringMethod(stage.scoringMethod)
              ? (a.finalTimeSeconds ?? Number.POSITIVE_INFINITY) - (b.finalTimeSeconds ?? Number.POSITIVE_INFINITY)
              : (b.stagePoints ?? 0) - (a.stagePoints ?? 0),
          ),
      };
    }),
  };
}

export function listStageSummaries(db: Db, match: Match): Record<string, unknown>[] {
  const stages = listStages(db, match);
  return stages.map((stage) => {
    const timeScoring = isTimeScoringMethod(stage.scoringMethod);
    const rows = db
      .prepare(
        timeScoring
          ? `SELECT sr.registration_id, sr.stage_points, sr.hit_factor, sr.final_time_seconds, sh.first_name || ' ' || sh.last_name AS name
             FROM stage_results sr
             JOIN shooters sh ON sh.id = (SELECT shooter_id FROM match_registrations WHERE id = sr.registration_id)
             WHERE sr.stage_id = ? AND sr.final_time_seconds IS NOT NULL
             ORDER BY sr.final_time_seconds ASC LIMIT 50`
          : `SELECT sr.registration_id, sr.stage_points, sr.hit_factor, sr.final_time_seconds, sh.first_name || ' ' || sh.last_name AS name
             FROM stage_results sr
             JOIN shooters sh ON sh.id = (SELECT shooter_id FROM match_registrations WHERE id = sr.registration_id)
             WHERE sr.stage_id = ? AND sr.hit_factor IS NOT NULL
             ORDER BY sr.stage_points DESC LIMIT 50`,
      )
      .all(stage.id) as Record<string, unknown>[];
    const scoredCount = (
      db
        .prepare(
          timeScoring
            ? 'SELECT count(*) c FROM stage_results WHERE stage_id = ? AND final_time_seconds IS NOT NULL'
            : 'SELECT count(*) c FROM stage_results WHERE stage_id = ? AND hit_factor IS NOT NULL',
        )
        .get(stage.id) as { c: number }
    ).c;
    const winner = rows[0] ?? null;
    return {
      stageId: stage.id,
      number: stage.number,
      name: stage.name,
      scoringMethod: stage.scoringMethod,
      maximumStagePoints: stage.maximumStagePoints,
      scoredCount,
      divisionWinnerHf: !timeScoring && winner ? Number(winner.hit_factor) : null,
      divisionWinnerFinalTime: timeScoring && winner ? Number(winner.final_time_seconds) : null,
      divisionWinnerName: winner ? String(winner.name) : null,
      completed: scoredCount > 0,
    };
  });
}

export function getMatchResults(db: Db, match: Match): MatchStandings {
  return computeMatchStandings(db, match, { persist: true });
}

export function getStoredMatchResults(db: Db, matchId: string): Record<string, unknown> {
  const row = db
    .prepare('SELECT calculated_at FROM match_results WHERE match_id = ? LIMIT 1')
    .get(matchId) as Record<string, unknown> | undefined;
  if (!row) throw notFound('No results computed for this match yet.');
  return { calculatedAt: String(row.calculated_at) };
}

export function getCategoryStandings(db: Db, match: Match, categoryId: string): StandingsRow[] {
  const standings = computeMatchStandings(db, match);
  return standings.categories.find((c) => c.categoryId === categoryId)?.rows ?? [];
}

export function getDivisionStandings(db: Db, match: Match, divisionId: string): StandingsRow[] {
  if (divisionId === 'OVERALL') return computeMatchStandings(db, match).overall;
  return computeMatchStandings(db, match).divisions.find((d) => d.divisionId === divisionId)?.rows ?? [];
}