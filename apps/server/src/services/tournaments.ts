import type { Db } from '../db/client.js';
import { uuid, notFound, conflict, badRequest } from './utils.js';
import { audit } from './audit.js';
import { getMatch, matchView } from './matches.js';
import { computeMatchStandings, recomputeStageResultsForMatch } from './results.js';
import type { Match, TournamentAggregationMethod } from '@blinkscore/core';

export interface TournamentComponentRow {
  id: string;
  tournamentMatchId: string;
  componentMatchId: string;
  weight: number;
  sortOrder: number;
}

export function listComponents(db: Db, tournament: Match): (TournamentComponentRow & { name: string; date: string; status: string })[] {
  const rows = db
    .prepare(
      `SELECT tc.*, m.name, m.start_date, m.status FROM tournament_components tc
       JOIN matches m ON m.id = tc.component_match_id
       WHERE tc.tournament_match_id = ? ORDER BY tc.sort_order`,
    )
    .all(tournament.id) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    tournamentMatchId: String(r.tournament_match_id),
    componentMatchId: String(r.component_match_id),
    weight: Number(r.weight),
    sortOrder: Number(r.sort_order),
    name: String(r.name),
    date: String(r.start_date),
    status: String(r.status),
  }));
}

export function addComponent(
  db: Db,
  tournament: Match,
  componentMatchId: string,
  weight: number,
  actor: { userId: string; username: string | null },
): void {
  if (tournament.matchType !== 'TOURNAMENT') {
    throw badRequest('NOT_TOURNAMENT', 'Only a tournament (Championship) match can have component matches.');
  }
  if (componentMatchId === tournament.id) throw badRequest('SELF_COMPONENT', 'A tournament cannot contain itself.');
  const component = getMatch(db, tournament.organizationId, componentMatchId);
  if (component.matchType === 'TOURNAMENT') throw badRequest('NESTED_TOURNAMENT', 'A tournament cannot be a component of another tournament.');
  if (component.status === 'DRAFT') throw conflict('COMPONENT_NOT_SCORED', 'Component matches must be at least CONFIGURED before adding.');
  const dup = db.prepare('SELECT id FROM tournament_components WHERE tournament_match_id = ? AND component_match_id = ?').get(tournament.id, componentMatchId);
  if (dup) throw conflict('COMPONENT_EXISTS', 'This match is already a component of the tournament.');
  const count = (db.prepare('SELECT count(*) c FROM tournament_components WHERE tournament_match_id = ?').get(tournament.id) as { c: number }).c;
  db.prepare(
    'INSERT INTO tournament_components (id, tournament_match_id, component_match_id, weight, sort_order) VALUES (?, ?, ?, ?, ?)',
  ).run(uuid(), tournament.id, componentMatchId, weight, Number(count));
  audit(db, {
    organizationId: tournament.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'MATCH_MODIFIED',
    entity: 'tournament_components',
    entityId: tournament.id,
    newValue: { componentMatchId, weight },
  });
}

export function updateComponentWeight(
  db: Db,
  tournament: Match,
  componentId: string,
  weight: number,
  actor: { userId: string; username: string | null },
): void {
  db.prepare('UPDATE tournament_components SET weight = ? WHERE id = ? AND tournament_match_id = ?').run(
    weight,
    componentId,
    tournament.id,
  );
  audit(db, {
    organizationId: tournament.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'MATCH_MODIFIED',
    entity: 'tournament_components',
    entityId: componentId,
    newValue: { weight },
  });
}

export function removeComponent(db: Db, tournament: Match, componentId: string, actor: { userId: string; username: string | null }): void {
  db.prepare('DELETE FROM tournament_components WHERE id = ? AND tournament_match_id = ?').run(componentId, tournament.id);
  audit(db, {
    organizationId: tournament.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'MATCH_MODIFIED',
    entity: 'tournament_components',
    entityId: componentId,
    oldValue: 'removed',
  });
}

export interface TournamentStanding {
  registrationId: string;
  shooterName: string;
  divisionId: string | null;
  categoryId: string | null;
  aggregatePoints: number;
  rank: number | null;
  tieCount: number | null;
  componentTotals: Record<string, number>;
  componentPercents: Record<string, number>;
  competitorStatus: string;
}

/**
 * Computes the tournament aggregation from component match results.
 * SUM_POINTS: plain addition of each component's match total.
 * SUM_PERCENT: each component's total as a percentage of that component's overall winner.
 * CUSTOM_WEIGHTED: SUM_PERCENT multiplied by the configured component weight.
 */
export function computeTournamentStandings(db: Db, tournament: Match, method: TournamentAggregationMethod = tournament.aggregateMethod ?? 'SUM_POINTS'): TournamentStanding[] {
  const components = listComponents(db, tournament);
  const mapping = tournamentRegistrationMap(db, tournament);
  const byReg = new Map<
    string,
    { registrationId: string; shooterName: string; divisionId: string | null; categoryId: string | null; competitorStatus: string; totals: Record<string, number>; percents: Record<string, number>; weight: Record<string, number> }
  >();

  for (const component of components) {
    recomputeStageResultsForMatch(db, getMatch(db, tournament.organizationId, component.componentMatchId));
    const standings = computeMatchStandings(db, getMatch(db, tournament.organizationId, component.componentMatchId));
    const overallWinnerTotal = standings.overall[0]?.matchTotal ?? 0;

    for (const row of standings.overall) {
      const mapped = mapping.get(row.shooterName);
      const registrationId = mapped?.registrationId ?? row.registrationId;
      const entry = byReg.get(registrationId) ?? {
        registrationId,
        shooterName: row.shooterName,
        divisionId: mapped?.divisionId ?? row.divisionId,
        categoryId: mapped?.categoryId ?? row.categoryId,
        competitorStatus: mapped?.competitorStatus ?? row.competitorStatus,
        totals: {},
        percents: {},
        weight: {},
      };
      entry.totals[component.componentMatchId] = row.matchTotal;
      entry.percents[component.componentMatchId] = overallWinnerTotal > 0 ? (row.matchTotal / overallWinnerTotal) * 100 : 0;
      entry.weight[component.componentMatchId] = component.weight;
      byReg.set(registrationId, entry);
    }
  }

  const rows: TournamentStanding[] = [...byReg.values()].map((e) => {
    let aggregatePoints = 0;
    if (method === 'SUM_POINTS') {
      aggregatePoints = Object.values(e.totals).reduce((a, b) => a + b, 0);
    } else {
      aggregatePoints = Object.keys(e.percents).reduce((a, k) => {
        const p = e.percents[k];
        const w = e.weight[k];
        return a + (p === undefined ? 0 : p) * (w === undefined ? 1 : w);
      }, 0);
    }
    return {
      registrationId: e.registrationId,
      shooterName: e.shooterName,
      divisionId: e.divisionId,
      categoryId: e.categoryId,
      aggregatePoints: Number(aggregatePoints.toFixed(4)),
      rank: null,
      tieCount: null,
      componentTotals: e.totals,
      componentPercents: e.percents,
      competitorStatus: e.competitorStatus,
    };
  });

  const sorted = rows
    .filter((r) => !['DQ', 'DNS', 'DNF', 'WITHDRAWN'].includes(r.competitorStatus))
    .sort((a, b) => b.aggregatePoints - a.aggregatePoints);
  let prevTotal: number | null = null;
  let prevRank = 0;
  let streak = 0;
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]!;
    const same = prevTotal !== null && Math.abs(row.aggregatePoints - prevTotal) < 1e-9;
    if (same) {
      row.rank = prevRank;
      streak++;
      row.tieCount = streak + 1;
    } else {
      row.rank = i + 1;
      prevRank = row.rank;
      streak = 0;
      row.tieCount = 1;
    }
    prevTotal = row.aggregatePoints;
  }
  persistTournamentResults(db, tournament, sorted);
  return sorted;
}

function tournamentRegistrationMap(
  db: Db,
  tournament: Match,
): Map<string, { registrationId: string; divisionId: string | null; categoryId: string | null; competitorStatus: string }> {
  const rows = db
    .prepare(
      `SELECT r.id AS registration_id, r.division_id, r.category_id, r.status,
              sh.first_name || ' ' || sh.last_name AS shooter_name
       FROM match_registrations r JOIN shooters sh ON sh.id = r.shooter_id
       WHERE r.match_id = ?`,
    )
    .all(tournament.id) as Record<string, unknown>[];
  return new Map(
    rows.map((r) => [
      String(r.shooter_name),
      {
        registrationId: String(r.registration_id),
        divisionId: (r.division_id as string) ?? null,
        categoryId: (r.category_id as string) ?? null,
        competitorStatus: String(r.status),
      },
    ]),
  );
}

function persistTournamentResults(db: Db, tournament: Match, rows: TournamentStanding[]): void {
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO tournament_results (id, tournament_match_id, registration_id, aggregate_points, rank, tie_count, calculated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tournament_match_id, registration_id) DO UPDATE SET
       aggregate_points = excluded.aggregate_points, rank = excluded.rank, tie_count = excluded.tie_count, calculated_at = excluded.calculated_at`,
  );
  for (const row of rows) {
    upsert.run(uuid(), tournament.id, row.registrationId, row.aggregatePoints, row.rank ?? null, row.tieCount ?? null, now);
  }
}

export function getTournamentView(db: Db, tournament: Match): Record<string, unknown> {
  const base = matchView(db, tournament);
  const components = listComponents(db, tournament);
  const standings = computeTournamentStandings(db, tournament);
  return { ...base, components, standings };
}

export function setAggregateMethod(
  db: Db,
  tournament: Match,
  method: TournamentAggregationMethod,
  actor: { userId: string; username: string | null },
): void {
  if (!['SUM_POINTS', 'SUM_PERCENT', 'CUSTOM_WEIGHTED'].includes(method)) throw badRequest('BAD_METHOD', 'Invalid aggregation method.');
  db.prepare('UPDATE matches SET aggregate_method = ?, updated_at = ? WHERE id = ?').run(method, new Date().toISOString(), tournament.id);
  audit(db, {
    organizationId: tournament.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'MATCH_MODIFIED',
    entity: 'matches',
    entityId: tournament.id,
    newValue: { aggregateMethod: method },
  });
}