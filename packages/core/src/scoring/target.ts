import type { ScoringRuleParams } from '../rules/parameterDefs.js';
import type { ScoringMethod, ScoringZone } from '../domain/enums.js';
import type { EngineTargetConfig, TargetScoreInput } from './types.js';
import type { PenaltyEvent } from './types.js';
import { ScoringConfigError } from './errors.js';

export interface TargetScoreDetail {
  targetId: string;
  targetType: EngineTargetConfig['targetType'];
  requiredHits: number | null;
  hitsRecorded: number;
  rawPoints: number;
  misses: number;
  noShootHits: number;
  extraHits: number;
  penaltyEvents: PenaltyEvent[];
  struckOn: 'A' | 'C' | 'D' | 'HIT' | null;
  remarks: string[];
  zoneCounts: { A: number; C: number; D: number };
}

const ZONE_RANK: Record<string, number> = { A: 0, C: 1, D: 2 };

export function requiredScoringHits(
  target: EngineTargetConfig,
  stageRequiredHits: number | null,
  params: ScoringRuleParams,
): number {
  if (target.requiredHits !== null && target.requiredHits !== undefined) return target.requiredHits;
  if (stageRequiredHits !== null && stageRequiredHits !== undefined) return stageRequiredHits;
  return params.paperDefaultRequiredHits;
}

/**
 * The maximum points a single target can contribute to raw points under the
 * current ruleset. Paper (and CUSTOM) score their stipulated number of hits at
 * the top zone value (A); steel/popper/plate score a single hit at the steel
 * point value; PAPER_NO_SHOOT targets never contribute points.
 */
export function targetMaxPoints(
  target: EngineTargetConfig,
  stageRequiredHits: number | null,
  params: ScoringRuleParams,
  scoringFactorMajor: boolean,
): number {
  if (target.targetType === 'PAPER_NO_SHOOT') return 0;
  const isPaper = target.targetType === 'PAPER' || target.targetType === 'CUSTOM';
  const requiredHits = isPaper ? requiredScoringHits(target, stageRequiredHits, params) : 1;
  if (isPaper) {
    const zone = scoringFactorMajor ? params.paperPointsMajor : params.paperPointsMinor;
    return requiredHits * zone.A;
  }
  return requiredHits * params.steelPointValue;
}

/** The maximum points the whole stage layout can produce (sum of per-target maxima). */
export function stageLayoutMaxPoints(
  targets: EngineTargetConfig[],
  stageRequiredHits: number | null,
  params: ScoringRuleParams,
  scoringFactorMajor: boolean,
): number {
  return targets.reduce((sum, t) => sum + targetMaxPoints(t, stageRequiredHits, params, scoringFactorMajor), 0);
}

export function scoreSingleTarget(
  target: EngineTargetConfig,
  input: TargetScoreInput | undefined,
  scoringFactorMajor: boolean,
  stageRequiredHits: number | null,
  params: ScoringRuleParams,
  scoringMethod: ScoringMethod = 'COMSTOCK',
): TargetScoreDetail {
  const remarks: string[] = [];
  const penaltyEvents: PenaltyEvent[] = [];

  if (target.targetType === 'PAPER_NO_SHOOT') {
    const noShootHits = input?.noShootHits ?? 0;
    if (noShootHits > 0) {
      penaltyEvents.push({
        type: 'NO_SHOOT',
        value: noShootHits * params.noShootPenalty,
        count: noShootHits,
        source: `target:${target.targetId}`,
      });
    }
    return {
      targetId: target.targetId,
      targetType: target.targetType,
      requiredHits: 0,
      hitsRecorded: noShootHits,
      rawPoints: 0,
      misses: 0,
      noShootHits,
      extraHits: 0,
      penaltyEvents,
      struckOn: null,
      remarks,
      zoneCounts: { A: 0, C: 0, D: 0 },
    };
  }

  const isPaper = target.targetType === 'PAPER' || target.targetType === 'CUSTOM';
  const requiredHits = isPaper ? requiredScoringHits(target, stageRequiredHits, params) : 1;

  if (isPaper) {
    const zoneHits = input?.zoneHits ?? [];
    // Hardening: only zones declared on the target (or the standard A/C/D set
    // when none are declared) may be recorded. Anything else is a fat-fingered
    // entry or a target misconfiguration — surface it, never guess.
    const allowedZones: ReadonlySet<ScoringZone> =
      target.scoringZones && target.scoringZones.length > 0
        ? new Set(target.scoringZones)
        : new Set<ScoringZone>(['A', 'C', 'D']);
    for (const z of zoneHits) {
      if (!allowedZones.has(z)) {
        throw new ScoringConfigError(
          'ZONE_NOT_RECORDABLE',
          `Target ${target.targetId} does not allow scoring zone ${z}. Configured scoring zones: ${[...allowedZones].join('/')}.`,
        );
      }
    }
    const counts = { A: 0, C: 0, D: 0 };
    for (const z of zoneHits) {
      if (z === 'A' || z === 'C' || z === 'D') counts[z] += 1;
    }
    const hitsRecorded = zoneHits.length;
    // Hardening: a paper target may record at most its stipulated scoring hits
    // (default 2 under the IPSC ruleset). More holes than stipulation is a
    // fat-fingered entry — surface it, never guess a penalty policy.
    if (hitsRecorded > requiredHits) {
      throw new ScoringConfigError(
        'TARGET_HITS_EXCEEDED',
        `Paper target ${target.targetId} recorded ${hitsRecorded} hits; a paper target may record at most ${requiredHits} scoring hit(s).`,
      );
    }
    const pointsTable = scoringFactorMajor ? params.paperPointsMajor : params.paperPointsMinor;

    // Consume up to `requiredHits` of the highest-value zones first (Comstock: only
    // the stipulated number of highest-value hits per target count).
    let consumed = 0;
    let rawPoints = 0;
    const struckOn = zoneHits.length > 0 ? (zoneHits[0] ?? null) : null;
    for (const zone of ['A', 'C', 'D'] as const) {
      const take = Math.min(counts[zone], requiredHits - consumed);
      rawPoints += take * pointsTable[zone];
      consumed += take;
    }

    // Hardening: a target can never score more points than its ceiling.
    const maxPoints = requiredHits * pointsTable.A;
    if (rawPoints > maxPoints) {
      throw new ScoringConfigError(
        'TARGET_POINTS_EXCEEDED',
        `Target ${target.targetId} produced ${rawPoints} points, exceeding its ${maxPoints} point maximum. Check the recorded zone hits.`,
      );
    }

    const extraHits = Math.max(0, hitsRecorded - requiredHits);
    const countMissingAsMiss =
      scoringMethod !== 'VIRGINIA_COUNT' || params.virginiaCountMissingShotsAsMiss;
    const misses = countMissingAsMiss ? Math.max(0, requiredHits - hitsRecorded) : 0;

    if (target.requiredHits === null && target.requiredHits === undefined && stageRequiredHits === null) {
      remarks.push(
        `Target ${target.targetId} required scoring hits resolved from the ruleset default (${requiredHits}).`,
      );
    }

    if (misses > 0) {
      penaltyEvents.push({
        type: 'MISS',
        value: misses * params.missPenalty,
        count: misses,
        source: `target:${target.targetId}`,
      });
    }

    if (extraHits > 0) {
      if (params.extraHitPolicy === 'TREAT_AS_MISS') {
        penaltyEvents.push({
          type: 'MISS',
          value: extraHits * params.missPenalty,
          count: extraHits,
          source: `target:${target.targetId}`,
          remark: 'extra hits beyond stipulated scoring hits treated as misses per ruleset',
        });
        remarks.push(
          `${extraHits} extra hit(s) on target ${target.targetId} beyond its ${requiredHits} stipulated scoring hit(s) treated as miss(es).`,
        );
      } else if (params.extraHitPolicy === 'REQUIRE_CONFIG') {
        throw new ScoringConfigError(
          'EXTRA_HITS_UNCONFIGURED',
          `Target ${target.targetId} recorded ${extraHits} extra hit(s) beyond its ${requiredHits} stipulated scoring hits. Configure the extra-hit policy for this ruleset before scoring.`,
        );
      } else {
        remarks.push(
          `${extraHits} extra hit(s) on target ${target.targetId} ignored (policy ${params.extraHitPolicy}).`,
        );
      }
    }

    const noShootHits = input?.noShootHits ?? 0;
    if (noShootHits > 0) {
      penaltyEvents.push({
        type: 'NO_SHOOT',
        value: noShootHits * params.noShootPenalty,
        count: noShootHits,
        source: `target:${target.targetId}`,
      });
    }

    return {
      targetId: target.targetId,
      targetType: target.targetType,
      requiredHits,
      hitsRecorded,
      rawPoints,
      misses,
      noShootHits,
      extraHits,
      penaltyEvents,
      struckOn,
      remarks,
      zoneCounts: counts,
    };
  }

  // Steel / Popper / Plate — all-or-nothing per stipulated hit (1 hit required).
  const hits = input?.hits ?? 0;
  const steelMisses = input?.steelMisses ?? Math.max(0, requiredHits - hits);
  const rawPoints = hits * params.steelPointValue;
  // Hardening: a target can never score more points than its ceiling.
  const maxPoints = requiredHits * params.steelPointValue;
  if (rawPoints > maxPoints) {
    throw new ScoringConfigError(
      'TARGET_POINTS_EXCEEDED',
      `Target ${target.targetId} produced ${rawPoints} points, exceeding its ${maxPoints} point maximum (steel targets score at most ${requiredHits} hit(s)).`,
    );
  }
  if (steelMisses > 0) {
    penaltyEvents.push({
      type: 'MISS',
      value: steelMisses * params.missPenalty,
      count: steelMisses,
      source: `target:${target.targetId}`,
    });
  }
  const noShootHits = input?.noShootHits ?? 0;
  if (noShootHits > 0) {
    penaltyEvents.push({
      type: 'NO_SHOOT',
      value: noShootHits * params.noShootPenalty,
      count: noShootHits,
      source: `target:${target.targetId}`,
    });
  }
  const extraHits = Math.max(0, hits - 1);
  if (extraHits > 0 && params.extraHitPolicy === 'TREAT_AS_MISS') {
    penaltyEvents.push({
      type: 'MISS',
      value: extraHits * params.missPenalty,
      count: extraHits,
      source: `target:${target.targetId}`,
      remark:
        'multiple hits recorded on a steel target that requires a single scoring hit; extras treated as misses per ruleset',
    });
  }
  return {
    targetId: target.targetId,
    targetType: target.targetType,
    requiredHits: 1,
    hitsRecorded: hits,
    rawPoints,
    misses: steelMisses + extraHits,
    noShootHits,
    extraHits,
    penaltyEvents,
    struckOn: hits > 0 ? 'HIT' : null,
    remarks,
    zoneCounts: { A: 0, C: 0, D: 0 },
  };
}

function sortZones(zoneHits: string[]): string[] {
  return [...zoneHits].sort((a, b) => (ZONE_RANK[a] ?? 9) - (ZONE_RANK[b] ?? 9));
}

/** Sort recorded hits A-first (greatest) regardless of input order. Exposed for UI preview parity. */
export { sortZones };