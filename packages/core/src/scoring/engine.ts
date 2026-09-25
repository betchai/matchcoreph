import type { LoadType, ScoringMethod, PowerFactor, ScoringZone } from '../domain/enums.js';
import type { ScoringRuleParams } from '../rules/parameterDefs.js';
import { ScoringConfigError } from './errors.js';
import type { ConfigIssue } from './errors.js';
import { scoreSingleTarget, stageLayoutMaxPoints } from './target.js';
import { roundTo } from './precision.js';
import type {
  CalculatedStageScore,
  StageScoreInput,
  StageScoringContext,
  TargetDetail,
} from './types.js';

/**
 * The scoring engine is a pure, deterministic function of its inputs.
 * Given the same {ruleset params, stage config, targets, hits, penalties, time}
 * it MUST always produce the same result. No randomness, no wall clock, no IO.
 */

export interface StageScoreArgs {
  context: StageScoringContext;
  input: StageScoreInput;
  params: ScoringRuleParams;
}

/**
 * PSMOC target loading: when a stage declares a load type (Full Load or
 * Minimum Load), the corresponding point-value table governs paper scoring for
 * that stage regardless of the competitor's power factor. Returns the original
 * params unchanged when no load type is set (IPSC/PPSA, power factor governs).
 */
export function resolveLoadTypeParams(
  params: ScoringRuleParams,
  loadType: LoadType | null | undefined,
): ScoringRuleParams {
  if (!loadType) return params;
  const table = loadType === 'FULL_LOAD' ? params.paperPointsFullLoad : params.paperPointsMinimumLoad;
  const zoneMap: Record<ScoringZone, number> = { A: table.A, C: table.C, D: table.D };
  return { ...params, paperPointsMajor: zoneMap, paperPointsMinor: zoneMap };
}

export function calculateStageScore(args: StageScoreArgs): CalculatedStageScore {
  const { context, input, params } = args;
  const configErrors: ConfigIssue[] = [];
  const warnings: string[] = [];
  const penaltyEvents: CalculatedStageScore['penaltyEvents'] = [];
  const targetDetails: TargetDetail[] = [];

  const emptyTimeAdjustments = (): CalculatedStageScore['timeAdjustments'] => ({
    alpha: 0,
    charlie: 0,
    delta: 0,
    miss: 0,
    noShoot: 0,
    procedural: 0,
    other: 0,
  });

  const scoringFactorMajor = context.scoringFactor === 'MAJOR';
  const isTimeScoring = context.scoringMethod === 'PSMOC_TIME';
  // PSMOC load type selects the paper point-value table for the whole stage.
  const effectiveParams = resolveLoadTypeParams(params, context.loadType);

  let rawPoints = 0;
  let misses = 0;
  let noShootHits = 0;

  const byTarget = new Map(input.targetScores.map((t) => [t.targetId, t]));

  for (const target of input.targets) {
    let detail;
    try {
      detail = scoreSingleTarget(
        target,
        byTarget.get(target.targetId),
        scoringFactorMajor,
        context.stageRequiredHits,
        effectiveParams,
        context.scoringMethod,
      );
    } catch (err) {
      if (err instanceof ScoringConfigError) {
        configErrors.push({ code: err.code, targetId: target.targetId, message: err.message });
        continue;
      }
      throw err;
    }
    rawPoints += detail.rawPoints;
    misses += detail.misses;
    noShootHits += detail.noShootHits;
    targetDetails.push({
      targetId: detail.targetId,
      targetType: detail.targetType,
      requiredHits: detail.requiredHits,
      hitsRecorded: detail.hitsRecorded,
      rawPoints: detail.rawPoints,
      misses: detail.misses,
      noShootHits: detail.noShootHits,
      extraHits: detail.extraHits,
      zoneCounts: detail.zoneCounts,
    });
    penaltyEvents.push(...detail.penaltyEvents);
    warnings.push(...detail.remarks);
  }

  // Hardening: the declared stage maximum is the contract for stage-point
  // scaling. A score can never produce more raw points than that declared
  // maximum, and a declared maximum that disagrees with the layout's true
  // ceiling is surfaced so the designer can correct the stage definition.
  // Point-based hardening does not apply to Time Scoring stages, where points
  // play no role and only the final (penalty-adjusted) time matters.
  if (!isTimeScoring) {
    const layoutMaxPoints = stageLayoutMaxPoints(input.targets, context.stageRequiredHits, effectiveParams, scoringFactorMajor);
    if (layoutMaxPoints > 0 && layoutMaxPoints !== context.maximumStagePoints) {
      warnings.push(
        `Stage declares ${context.maximumStagePoints} maximum points but its layout supports ${layoutMaxPoints} points. Fix the stage's declared maximum stage points.`,
      );
    }
    if (rawPoints > context.maximumStagePoints) {
      configErrors.push({
        code: 'STAGE_POINTS_EXCEEDED',
        message: `Raw points (${rawPoints}) exceed the stage's declared maximum of ${context.maximumStagePoints} points.`,
      });
    }
  }

  // Stage-level supplemental events (misses / no-shoots / procedurals not tied to a single target).
  if (input.misses > 0) {
    penaltyEvents.push({
      type: 'MISS',
      value: input.misses * params.missPenalty,
      count: input.misses,
      source: 'stage',
    });
    misses += input.misses;
  }
  if (input.paperNoShoots > 0) {
    penaltyEvents.push({
      type: 'NO_SHOOT',
      value: input.paperNoShoots * params.noShootPenalty,
      count: input.paperNoShoots,
      source: 'stage',
    });
    noShootHits += input.paperNoShoots;
  }
  let procedurals = input.procedurals;
  if (procedurals > 0) {
    penaltyEvents.push({
      type: 'PROCEDURAL',
      value: procedurals * params.proceduralPenalty,
      count: procedurals,
      source: 'stage',
    });
  }
  if (input.penaltiesOther > 0) {
    penaltyEvents.push({
      type: 'OTHER',
      value: input.penaltiesOther * params.otherPenalty,
      count: input.penaltiesOther,
      source: 'stage',
    });
  }

  // Extra shots beyond the stage maximum → procedural per extra shot, per method.
  const maxRounds = context.maximumRounds;
  if (maxRounds !== null && input.shotsFired !== null && input.shotsFired > maxRounds) {
    const extraShots = input.shotsFired - maxRounds;
    if (context.scoringMethod === 'VIRGINIA_COUNT' && params.virginiaCountExtraShotsProcedural) {
      penaltyEvents.push({
        type: 'PROCEDURAL',
        value: extraShots * params.proceduralPenalty,
        count: extraShots,
        source: 'stage',
        remark: 'shots fired in excess of the Virginia Count maximum',
      });
      procedurals += extraShots;
      warnings.push(
        `${extraShots} extra shot(s) fired beyond the ${maxRounds} round maximum; procedural penalty applied per Virginia Count rules.`,
      );
    } else if (context.scoringMethod === 'COMSTOCK') {
      penaltyEvents.push({
        type: 'PROCEDURAL',
        value: extraShots * params.proceduralPenalty,
        count: extraShots,
        source: 'stage',
        remark: 'shots fired in excess of the stage maximum round count',
      });
      procedurals += extraShots;
      warnings.push(
        `${extraShots} shot(s) fired beyond the stage's ${maxRounds} maximum rounds; procedural penalty applied.`,
      );
    } else if (isPsmocMethod(context.scoringMethod)) {
      // PSMOC rulesets permit unlimited shots on targets. Shots fired beyond the
      // stipulated maximum are disclosed but do not incur an additional procedural
      // unless the selected ruleset version expressly restricts them.
      if (params.psmocUnlimitedShots) {
        warnings.push(
          `${extraShots} extra shot(s) fired beyond the ${maxRounds} round maximum; no procedural penalty under PSMOC unlimited-shots rules.`,
        );
      } else {
        penaltyEvents.push({
          type: 'PROCEDURAL',
          value: extraShots * params.proceduralPenalty,
          count: extraShots,
          source: 'stage',
          remark: 'shots fired in excess of the stage maximum under a restricted PSMOC ruleset',
        });
        procedurals += extraShots;
        warnings.push(
          `${extraShots} shot(s) fired beyond the stage's ${maxRounds} maximum rounds; procedural penalty applied under the selected PSMOC ruleset.`,
        );
      }
    }
  }

  // In Virginia Count, required shots not fired are misses — derived per target
  // inside scoreSingleTarget (gated by virginiaCountMissingShotsAsMiss), so no
  // additional stage-level pass is performed to avoid double counting.

  const penaltyPoints = penaltyEvents.reduce((sum, e) => sum + e.value, 0);

  if (configErrors.length > 0) {
    return {
      method: context.scoringMethod,
      rawPoints: null,
      penaltyPoints,
      netPoints: null,
      timeSeconds: input.timeSeconds,
      hitFactor: null,
      stagePoints: null,
      misses,
      noShootHits,
      procedurals,
      valid: false,
      penaltyEvents,
      targetDetails,
      configErrors,
      warnings,
      finalTimeSeconds: null,
      timeAdjustmentsSeconds: 0,
      timeAdjustments: emptyTimeAdjustments(),
    };
  }

  const finalNet = rawPoints - penaltyPoints;

  // Time resolution.
  let timeSeconds = input.timeSeconds;
  if (context.scoringMethod === 'FIXED_TIME' && params.fixedTimeStopsAtFixedTime) {
    if (context.fixedTimeSeconds !== null && context.fixedTimeSeconds !== undefined) {
      timeSeconds = context.fixedTimeSeconds;
    } else {
      configErrors.push({
        code: 'FIXED_TIME_NOT_CONFIGURED',
        message: 'Fixed Time stage has no fixed stage time configured.',
      });
      timeSeconds = null;
    }
  }

  if (timeSeconds === null || timeSeconds === undefined) {
    // Time is required for a scored (usable) result in a time-based method.
    configErrors.push({
      code: 'TIME_REQUIRED',
      message: 'A valid time is required to calculate hit factor.',
    });
    return {
      method: context.scoringMethod,
      rawPoints,
      penaltyPoints,
      netPoints: finalNet,
      timeSeconds: null,
      hitFactor: null,
      stagePoints: null,
      misses,
      noShootHits,
      procedurals,
      valid: false,
      penaltyEvents,
      targetDetails,
      configErrors,
      warnings,
      finalTimeSeconds: null,
      timeAdjustmentsSeconds: 0,
      timeAdjustments: emptyTimeAdjustments(),
    };
  }

  const effectiveTime = roundTo(timeSeconds, params.precisionTime);
  if (effectiveTime <= 0 && !params.allowZeroTime) {
    configErrors.push({ code: 'INVALID_TIME', message: 'Time must be greater than zero.' });
    return {
      method: context.scoringMethod,
      rawPoints,
      penaltyPoints,
      netPoints: finalNet,
      timeSeconds: effectiveTime,
      hitFactor: null,
      stagePoints: null,
      misses,
      noShootHits,
      procedurals,
      valid: false,
      penaltyEvents,
      targetDetails,
      configErrors,
      warnings,
      finalTimeSeconds: null,
      timeAdjustmentsSeconds: 0,
      timeAdjustments: emptyTimeAdjustments(),
    };
  }

  // PSMOC Time Scoring: derive the final time from the raw time plus per-zone
  // and per-penalty adjustments taken from the selected ruleset version.
  if (isTimeScoring) {
    const timeAdjustments = emptyTimeAdjustments();
    for (const td of targetDetails) {
      timeAdjustments.alpha += td.zoneCounts.A * params.timeAdjustAlpha;
      timeAdjustments.charlie += td.zoneCounts.C * params.timeAdjustCharlie;
      timeAdjustments.delta += td.zoneCounts.D * params.timeAdjustDelta;
      timeAdjustments.miss += td.misses * params.timePenaltyMiss;
      timeAdjustments.noShoot += td.noShootHits * params.timePenaltyNoShoot;
    }
    timeAdjustments.miss += input.misses * params.timePenaltyMiss;
    timeAdjustments.noShoot += input.paperNoShoots * params.timePenaltyNoShoot;
    timeAdjustments.procedural += procedurals * params.timePenaltyProcedural;
    timeAdjustments.other += input.penaltiesOther * params.timePenaltyOther;
    const timeAdjustmentsSeconds = roundTo(
      timeAdjustments.alpha + timeAdjustments.charlie + timeAdjustments.delta + timeAdjustments.miss + timeAdjustments.noShoot + timeAdjustments.procedural + timeAdjustments.other,
      params.precisionTime,
    );
    const finalTimeSeconds = roundTo(effectiveTime + timeAdjustmentsSeconds, params.precisionTime);
    return {
      method: context.scoringMethod,
      rawPoints,
      penaltyPoints,
      netPoints: finalNet,
      timeSeconds: effectiveTime,
      hitFactor: null,
      stagePoints: null,
      misses,
      noShootHits,
      procedurals,
      valid: true,
      penaltyEvents,
      targetDetails,
      configErrors,
      warnings,
      finalTimeSeconds,
      timeAdjustmentsSeconds,
      timeAdjustments,
    };
  }

  const hitFactor = finalNet / effectiveTime;

  return {
    method: context.scoringMethod,
    rawPoints,
    penaltyPoints,
    netPoints: finalNet,
    timeSeconds: effectiveTime,
    hitFactor,
    // Stage points are allocated relative to the division's stage winner and
    // are therefore computed separately (see computeStagePoints/rankStage).
    stagePoints: null,
    misses,
    noShootHits,
    procedurals,
    valid: configErrors.length === 0,
    penaltyEvents,
    targetDetails,
    configErrors,
    warnings,
    finalTimeSeconds: null,
    timeAdjustmentsSeconds: 0,
    timeAdjustments: emptyTimeAdjustments(),
  };
}

export function computeStagePoints(
  hitFactor: number,
  stageWinnerHitFactor: number,
  maximumStagePoints: number,
  precision: number,
  minZero: boolean,
): number {
  if (stageWinnerHitFactor <= 0) return 0;
  const points = (hitFactor / stageWinnerHitFactor) * maximumStagePoints;
  const clamped = minZero ? Math.max(0, points) : points;
  return roundTo(clamped, precision);
}

export interface DivisionStageResult {
  registrationId: string;
  competitorStatus: string;
  /** True when the competitor actually completed the stage and may earn stage points. */
  competitorIsScored: boolean;
  hitFactor: number | null;
  stagePoints: number | null;
  netPoints: number | null;
}

export function rankStage(
  rows: DivisionStageResult[],
  maximumStagePoints: number,
  precision: number,
  minZero: boolean,
): DivisionStageResult[] {
  const valid = rows.filter((r) => r.competitorIsScored && r.hitFactor !== null && r.hitFactor !== undefined);
  const winnerHf = valid.length > 0 ? Math.max(...valid.map((r) => r.hitFactor as number)) : null;
  if (winnerHf === null || winnerHf <= 0) {
    return rows.map((r) => ({ ...r, stagePoints: (r.stagePoints ?? 0) }));
  }
  return rows.map((r) => {
    if (r.hitFactor === null) return { ...r, stagePoints: 0 };
    return {
      ...r,
      stagePoints: computeStagePoints(r.hitFactor, winnerHf, maximumStagePoints, precision, minZero),
    };
  });
}

export function isTimedMethod(method: ScoringMethod): boolean {
  return method === 'COMSTOCK' || method === 'VIRGINIA_COUNT' || method === 'FIXED_TIME' || method === 'PSMOC_POINTS_FACTOR' || method === 'PSMOC_TIME';
}

export function isPsmocMethod(method: ScoringMethod): boolean {
  return method === 'PSMOC_POINTS_FACTOR' || method === 'PSMOC_TIME';
}

export function isTimeScoringMethod(method: ScoringMethod): boolean {
  return method === 'PSMOC_TIME';
}

export interface TimeStageResult {
  registrationId: string;
  competitorStatus: string;
  competitorIsScored: boolean;
  finalTimeSeconds: number | null;
  timeAdjustmentsSeconds: number;
  stagePoints: number | null;
}

/**
 * PSMOC Time Scoring stage ranking: the competitor with the lowest correctly
 * calculated final time receives the highest stage result. Equal final times
 * sort adjacent (a tie is disclosed by the caller); competitors without a
 * usable time are listed after the timed field. Time-scoring stages award no
 * stage points, so stagePoints stays null.
 */
export function rankStageByFinalTime(rows: TimeStageResult[], precision: number): TimeStageResult[] {
  const scored = rows
    .filter((r) => r.competitorIsScored && r.finalTimeSeconds !== null && r.finalTimeSeconds !== undefined)
    .map((r) => ({ ...r, finalTimeSeconds: roundTo(r.finalTimeSeconds as number, precision) }))
    .sort((a, b) => a.finalTimeSeconds - b.finalTimeSeconds);
  const unranked = rows.filter(
    (r) => !scored.some((s) => s.registrationId === r.registrationId),
  );
  return [...scored, ...unranked];
}

export function scoringFactorLabel(pf: PowerFactor): string {
  return pf === 'MAJOR' ? 'Major' : pf === 'MINOR' ? 'Minor' : 'n/a';
}