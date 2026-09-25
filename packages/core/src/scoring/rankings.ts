import type { TieBreakMethod } from '../domain/enums.js';
import { roundTo, approxEqual } from './precision.js';

export interface TotaledCompetitor {
  registrationId: string;
  divisionId: string | null;
  categoryId: string | null;
  competitorStatus: string;
  matchTotal: number;
  /** Competitors with no scoreable stages (DNS/DNF/DQ/WITHDRAWN) are excluded from ranking. */
  excluded: boolean;
  stagePoints: Record<string, number>;
}

export interface RankedRow extends TotaledCompetitor {
  rank: number;
  tie: boolean;
  tieCount: number;
  rankDisplay: string;
}

/**
 * Ranks competitors within a group by descending match total.
 * Tie handling is configurable per ruleset. With method NONE, equal totals
 * are disclosed as "TIE" rather than assigning an arbitrary winner.
 *
 * A tie is only ever disclosed among competitors in the SAME division. Two
 * competitors with equal totals in different divisions are each the winner of
 * their own division, so they are never reported as tied; they receive
 * distinct ranks in a deterministic order (division, then registration).
 *
 * Totals are rounded to the declared precision and compared with a small
 * tolerance so that floats which are equal at the working precision are ties.
 */
export function rankCompetitors(
  rows: TotaledCompetitor[],
  precision: number,
  tieBreak: TieBreakMethod,
): RankedRow[] {
  const scored = rows
    .filter((r) => !r.excluded)
    .map((r) => ({ ...r, matchTotal: roundTo(r.matchTotal, precision) }));

  const sorted = [...scored].sort((a, b) => {
    const d = b.matchTotal - a.matchTotal;
    if (!approxEqual(d, 0, 1e-9)) return d;
    const stageDiff = Object.keys(b.stagePoints).length - Object.keys(a.stagePoints).length;
    if (stageDiff !== 0) return stageDiff;
    if (a.divisionId !== b.divisionId) return (a.divisionId ?? '').localeCompare(b.divisionId ?? '');
    return a.registrationId.localeCompare(b.registrationId);
  });

  const result: RankedRow[] = [];
  for (const row of sorted) {
    const prev = result[result.length - 1] ?? null;
    const tied =
      prev !== null &&
      prev.divisionId === row.divisionId &&
      approxEqual(prev.matchTotal, row.matchTotal, 1e-9);

    let rank: number;
    let tieCount = 1;
    if (!tied) {
      rank = result.length + 1;
    } else {
      // Contiguous same-total group within the same division: everyone equal
      // to the current total shares the first row's rank (standard competition
      // numbering).
      const groupFirst = result.findIndex((r) => approxEqual(r.matchTotal, row.matchTotal, 1e-9) && r.divisionId === row.divisionId);
      rank = groupFirst >= 0 ? result[groupFirst]!.rank : result.length + 1;
      tieCount = result.filter((r) => approxEqual(r.matchTotal, row.matchTotal, 1e-9) && r.divisionId === row.divisionId).length + 1;
      for (const r of result) {
        if (approxEqual(r.matchTotal, row.matchTotal, 1e-9) && r.divisionId === row.divisionId) {
          r.tie = true;
          r.tieCount = tieCount;
          r.rankDisplay = tieBreak === 'NONE' ? 'TIE' : String(r.rank);
        }
      }
    }

    const discloseTie = tied && tieBreak === 'NONE';
    result.push({
      ...row,
      rank,
      tie: discloseTie,
      tieCount,
      rankDisplay: discloseTie ? 'TIE' : String(rank),
    });
  }

  return result;
}

export function computeMatchTotal(stagePointsByStage: Record<string, number | null>, precision: number): number {
  let total = 0;
  for (const v of Object.values(stagePointsByStage)) {
    if (typeof v === 'number' && Number.isFinite(v)) total += v;
  }
  return roundTo(total, precision);
}

export interface Grouping<T> {
  key: string | null;
  rows: T[];
}

export function groupByKey<T>(rows: T[], keyOf: (row: T) => string | null): Grouping<T>[] {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const groupKey = key ?? '__NONE__';
    const arr = map.get(groupKey) ?? [];
    arr.push(row);
    map.set(groupKey, arr);
  }
  return [...map.entries()].map(([key, group]) => ({ key: key === '__NONE__' ? null : key, rows: group }));
}