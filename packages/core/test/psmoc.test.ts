import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCORING_RULE_PARAMS,
  buildScoringRuleParams,
  calculateStageScore,
  rankStage,
  rankStageByFinalTime,
  computeStagePoints,
  isTimeScoringMethod,
  resolveLoadTypeParams,
} from '../src/index.js';
import type { EngineTargetConfig, StageScoreInput, StageScoringContext } from '../src/scoring/types.js';

/**
 * PSMOC (Philippine Shooters and Match Officers Confederation) ruleset tests.
 * The PSMOC Handgun ruleset parameters live in RULESET_DEFAULTS['PSMOC-HANDGUN-2026'];
 * DEFAULT_SCORING_RULE_PARAMS carries the same representative values:
 *   full load  A=5/C=4/D=2, minimum load A=5/C=3/D=1, steel 5, miss/NS/proc 10
 *   time scoring: alpha +0s, charlie +1s, delta +3s, miss +5s, NS +5s, proc +5s, other +5s
 */
const params = buildScoringRuleParams([
  { key: 'scoring.paper.minor', value: 'A:5,C:3,D:1' },
  { key: 'scoring.paper.major', value: 'A:5,C:4,D:2' },
  { key: 'scoring.steel.pointValue', value: '5' },
]);
// params filled from DEFAULT_SCORING_RULE_PARAMS → verify representative PSMOC values present.
expect(DEFAULT_SCORING_RULE_PARAMS.timeAdjustCharlie).toBe(1);
expect(DEFAULT_SCORING_RULE_PARAMS.timeAdjustDelta).toBe(3);
expect(DEFAULT_SCORING_RULE_PARAMS.timePenaltyMiss).toBe(5);

function paper(id: string, requiredHits: number): EngineTargetConfig {
  return { targetId: id, targetType: 'PAPER', requiredHits };
}
function steel(id: string, type: 'POPPER' | 'PLATE' = 'POPPER'): EngineTargetConfig {
  return { targetId: id, targetType: type, requiredHits: 1 };
}

function ctx(over: Partial<StageScoringContext> = {}): StageScoringContext {
  return {
    scoringMethod: 'PSMOC_POINTS_FACTOR',
    scoringFactor: 'MAJOR',
    maximumStagePoints: 130,
    maximumRounds: null,
    minimumRounds: null,
    stageRequiredHits: null,
    fixedTimeSeconds: null,
    rulesetVersion: 'PSMOC-HANDGUN-1.0',
    ...over,
  };
}

function inp(over: Partial<StageScoreInput> = {}): StageScoreInput {
  return {
    timeSeconds: null,
    targets: [],
    targetScores: [],
    misses: 0,
    paperNoShoots: 0,
    procedurals: 0,
    penaltiesOther: 0,
    shotsFired: null,
    ...over,
  };
}

/** Spec example: 10 paper (2 scoring hits each) + 6 scoring metal targets (1 hit each) → 26 scoring hits. */
function specStageTargets(): { targets: EngineTargetConfig[]; perfect: (t: string) => { targetId: string; zoneHits: string[] } | { targetId: string; hits: number } } {
  const targets: EngineTargetConfig[] = [
    ...Array.from({ length: 10 }, (_, i) => paper(`p${i + 1}`, 2)),
    ...Array.from({ length: 6 }, (_, i) => steel(`m${i + 1}`)),
  ];
  return {
    targets,
    perfect: (id: string) => (id.startsWith('p') ? { targetId: id, zoneHits: ['A', 'A'] } : { targetId: id, hits: 1 }),
  };
}

describe('PSMOC: method classification', () => {
  it('classifies the two PSMOC scoring methods', () => {
    expect(isTimeScoringMethod('PSMOC_TIME')).toBe(true);
    expect(isTimeScoringMethod('PSMOC_POINTS_FACTOR')).toBe(false);
    expect(isTimeScoringMethod('COMSTOCK')).toBe(false);
  });
});

describe('PSMOC Points Factor scoring', () => {
  it('1. perfect score: 26 scoring hits × 5 = 130 points, PF = 130 / 10 = 13', () => {
    const { targets, perfect } = specStageTargets();
    const result = calculateStageScore({
      context: ctx({ maximumStagePoints: 130 }),
      input: inp({ targets, targetScores: targets.map((t) => perfect(t.targetId)), timeSeconds: 10 }),
      params,
    });
    expect(result.valid).toBe(true);
    expect(result.rawPoints).toBe(130);
    expect(result.penaltyPoints).toBe(0);
    expect(result.netPoints).toBe(130);
    expect(result.misses).toBe(0);
    expect(result.procedurals).toBe(0);
    expect(result.noShootHits).toBe(0);
    expect(result.hitFactor).toBeCloseTo(13, 10);
  });

  it('2. Points Factor with misses: one paper hit short → 5 raw shaved + 10 miss penalty → PF = 115 / 10 = 11.5', () => {
    const { targets } = specStageTargets();
    // p2 loses one of its two hits.
    const ts = targets.map((t) => (t.targetId === 'p2' ? { targetId: t.targetId, zoneHits: ['A'] } : t.targetId.startsWith('p') ? { targetId: t.targetId, zoneHits: ['A', 'A'] } : { targetId: t.targetId, hits: 1 }));
    const result = calculateStageScore({ context: ctx(), input: inp({ targets, targetScores: ts, timeSeconds: 10 }), params });
    expect(result.valid).toBe(true);
    expect(result.rawPoints).toBe(125);
    expect(result.misses).toBe(1);
    expect(result.penaltyPoints).toBe(10);
    expect(result.netPoints).toBe(115);
    expect(result.hitFactor).toBeCloseTo(11.5, 10);
  });

  it('3. Points Factor with no-shoot/penalty target hit: net 120 → PF 12', () => {
    const { targets, perfect } = specStageTargets();
    const result = calculateStageScore({
      context: ctx(),
      input: inp({ targets, targetScores: targets.map((t) => perfect(t.targetId)), paperNoShoots: 1, timeSeconds: 10 }),
      params,
    });
    expect(result.valid).toBe(true);
    expect(result.rawPoints).toBe(130);
    expect(result.penaltyPoints).toBe(10);
    expect(result.netPoints).toBe(120);
    expect(result.hitFactor).toBeCloseTo(12, 10);
  });

  it('4. Points Factor with procedural penalties: net 110 → PF 11', () => {
    const { targets, perfect } = specStageTargets();
    const result = calculateStageScore({
      context: ctx(),
      input: inp({ targets, targetScores: targets.map((t) => perfect(t.targetId)), procedurals: 2, timeSeconds: 10 }),
      params,
    });
    expect(result.valid).toBe(true);
    expect(result.penaltyPoints).toBe(20);
    expect(result.netPoints).toBe(110);
    expect(result.hitFactor).toBeCloseTo(11, 10);
  });

  it('5. full-load values (A=5, C=4, D=2) score a 2-hit paper target', () => {
    const result = calculateStageScore({
      context: ctx({ scoringFactor: 'MAJOR', maximumStagePoints: 20 }),
      input: inp({ targets: [paper('p1', 2)], targetScores: [{ targetId: 'p1', zoneHits: ['A', 'C'] }], timeSeconds: 5 }),
      params,
    });
    // A + C under full load = 5 + 4 = 9.
    expect(result.valid).toBe(true);
    expect(result.rawPoints).toBe(9);
  });

  it('6. minimum-load values (A=5, C=3, D=1) score a 2-hit paper target', () => {
    const result = calculateStageScore({
      context: ctx({ scoringFactor: 'MINOR', maximumStagePoints: 20 }),
      input: inp({ targets: [paper('p1', 2)], targetScores: [{ targetId: 'p1', zoneHits: ['A', 'C'] }], timeSeconds: 5 }),
      params,
    });
    expect(result.rawPoints).toBe(8);
  });

  it('7. metal targets score at the configured value; a knocked-down miss incurs the miss penalty', () => {
    const hit = calculateStageScore({
      context: ctx({ maximumStagePoints: 10 }),
      input: inp({ targets: [steel('m1')], targetScores: [{ targetId: 'm1', hits: 1 }], timeSeconds: 5 }),
      params,
    });
    expect(hit.rawPoints).toBe(5);
    expect(hit.penaltyPoints).toBe(0);

    const missed = calculateStageScore({
      context: ctx({ maximumStagePoints: 10 }),
      input: inp({ targets: [steel('m1')], targetScores: [{ targetId: 'm1', hits: 0 }], timeSeconds: 5 }),
      params,
    });
    expect(missed.rawPoints).toBe(0);
    expect(missed.misses).toBe(1);
    expect(missed.penaltyPoints).toBe(10);
  });

  it('8 & 9. mixed paper+metal stage: 10×2 + 6×1 = 26 scoring hits, max = 130', () => {
    const { targets } = specStageTargets();
    const stageDetails = calculateStageScore({
      context: ctx(),
      input: inp({ targets, targetScores: targets.map((t) => ({ targetId: t.targetId, ...(t.targetType === 'PAPER' ? { zoneHits: ['A', 'A'] } : { hits: 1 }) })), timeSeconds: 12 }),
      params,
    });
    expect(stageDetails.valid).toBe(true);
    expect(stageDetails.rawPoints).toBe(130);
    expect(stageDetails.warnings.some((w) => w.includes('maximum points'))).toBe(false);
  });

  it('points factor uses proportional stage points like a timed method', () => {
    // winner PF 13 → 130 points; a 11.5 run → 115.
    expect(computeStagePoints(11.5, 13, 130, 4, false)).toBeCloseTo(115.0, 4);
    const ranked = rankStage(
      [
        { registrationId: 'a', competitorStatus: 'COMPLETED', competitorIsScored: true, hitFactor: 13, stagePoints: null, netPoints: 130 },
        { registrationId: 'b', competitorStatus: 'COMPLETED', competitorIsScored: true, hitFactor: 11.5, stagePoints: null, netPoints: 115 },
      ],
      130,
      4,
      false,
    );
    expect(ranked.find((r) => r.registrationId === 'a')!.stagePoints).toBeCloseTo(130, 4);
    expect(ranked.find((r) => r.registrationId === 'b')!.stagePoints).toBeCloseTo(115, 4);
  });
});

describe('PSMOC Time Scoring', () => {
  const tctx = (over: Partial<StageScoringContext> = {}): StageScoringContext => ctx({ scoringMethod: 'PSMOC_TIME', maximumStagePoints: 130, ...over });

  it('10. perfect Alpha run: no time adjustments, final time = raw time', () => {
    const result = calculateStageScore({
      context: tctx(),
      input: inp({ targets: [paper('p1', 2)], targetScores: [{ targetId: 'p1', zoneHits: ['A', 'A'] }], timeSeconds: 20 }),
      params,
    });
    expect(result.valid).toBe(true);
    expect(result.finalTimeSeconds).toBe(20);
    expect(result.timeAdjustmentsSeconds).toBe(0);
    expect(result.timeAdjustments.alpha).toBe(0);
    expect(result.hitFactor).toBeNull();
  });

  it('11. Charlie hit: +1s per Charlie → final time 21', () => {
    const result = calculateStageScore({
      context: tctx(),
      input: inp({ targets: [paper('p1', 2)], targetScores: [{ targetId: 'p1', zoneHits: ['A', 'C'] }], timeSeconds: 20 }),
      params,
    });
    expect(result.finalTimeSeconds).toBe(21);
    expect(result.timeAdjustments.charlie).toBe(1);
  });

  it('12. Delta hits: +3s per Delta → final time 26', () => {
    const result = calculateStageScore({
      context: tctx(),
      input: inp({ targets: [paper('p1', 2)], targetScores: [{ targetId: 'p1', zoneHits: ['D', 'D'] }], timeSeconds: 20 }),
      params,
    });
    expect(result.finalTimeSeconds).toBe(26);
    expect(result.timeAdjustments.delta).toBe(6);
  });

  it('13. required hit absent counts as a miss: +5s → final time 25', () => {
    const result = calculateStageScore({
      context: tctx(),
      input: inp({ targets: [paper('p1', 2)], targetScores: [{ targetId: 'p1', zoneHits: ['A'] }], timeSeconds: 20 }),
      params,
    });
    expect(result.misses).toBe(1);
    expect(result.timeAdjustments.miss).toBe(5);
    expect(result.finalTimeSeconds).toBe(25);
  });

  it('14. procedural penalty: +5s each → final time 25', () => {
    const result = calculateStageScore({
      context: tctx(),
      input: inp({ targets: [paper('p1', 2)], targetScores: [{ targetId: 'p1', zoneHits: ['A', 'A'] }], procedurals: 1, timeSeconds: 20 }),
      params,
    });
    expect(result.timeAdjustments.procedural).toBe(5);
    expect(result.finalTimeSeconds).toBe(25);
  });

  it('applies a no-shoot time penalty (+5s per hit)', () => {
    const result = calculateStageScore({
      context: tctx(),
      input: inp({ targets: [paper('p1', 2)], targetScores: [{ targetId: 'p1', zoneHits: ['A', 'A'] }], paperNoShoots: 1, timeSeconds: 20 }),
      params,
    });
    expect(result.timeAdjustments.noShoot).toBe(5);
    expect(result.finalTimeSeconds).toBe(25);
  });

  it('15. ties: identical final times rank adjacent (stable ascending order)', () => {
    const ranked = rankStageByFinalTime(
      [
        { registrationId: 'a', competitorStatus: 'COMPLETED', competitorIsScored: true, finalTimeSeconds: 21.0, timeAdjustmentsSeconds: 0, stagePoints: null },
        { registrationId: 'b', competitorStatus: 'COMPLETED', competitorIsScored: true, finalTimeSeconds: 18.5, timeAdjustmentsSeconds: 0, stagePoints: null },
        { registrationId: 'c', competitorStatus: 'COMPLETED', competitorIsScored: true, finalTimeSeconds: 21.0, timeAdjustmentsSeconds: 0, stagePoints: null },
      ],
      2,
    );
    expect(ranked.map((r) => r.registrationId)).toEqual(['b', 'a', 'c']);
  });

  it('DNF/DNS/DQ competitors are excluded from the timed order and listed last', () => {
    const ranked = rankStageByFinalTime(
      [
        { registrationId: 'a', competitorStatus: 'COMPLETED', competitorIsScored: true, finalTimeSeconds: 20, timeAdjustmentsSeconds: 0, stagePoints: null },
        { registrationId: 'dns', competitorStatus: 'DNS', competitorIsScored: false, finalTimeSeconds: null, timeAdjustmentsSeconds: 0, stagePoints: null },
        { registrationId: 'dq', competitorStatus: 'DQ', competitorIsScored: false, finalTimeSeconds: null, timeAdjustmentsSeconds: 0, stagePoints: null },
        { registrationId: 'b', competitorStatus: 'COMPLETED', competitorIsScored: true, finalTimeSeconds: 18, timeAdjustmentsSeconds: 0, stagePoints: null },
      ],
      2,
    );
    expect(ranked[0]!.registrationId).toBe('b');
    expect(ranked[1]!.registrationId).toBe('a');
    expect(new Set(ranked.slice(2).map((r) => r.registrationId))).toEqual(new Set(['dns', 'dq']));
  });

  it('requires a usable time (no zero time in time scoring)', () => {
    const result = calculateStageScore({
      context: tctx(),
      input: inp({ targets: [paper('p1', 2)], targetScores: [{ targetId: 'p1', zoneHits: ['A', 'A'] }], timeSeconds: 0 }),
      params,
    });
    expect(result.valid).toBe(false);
    expect(result.finalTimeSeconds).toBeNull();
  });
});

describe('PSMOC: load type (Full Load / Minimum Load)', () => {
  const zoneRun = (context: StageScoringContext, scoringFactor: 'MAJOR' | 'MINOR') =>
    calculateStageScore({
      context: ctx({ ...context, scoringFactor, maximumStagePoints: 20 }),
      input: inp({
        targets: [paper('p1', 2)],
        targetScores: [{ targetId: 'p1', zoneHits: ['A', 'C'] }],
        timeSeconds: 5,
      }),
      params,
    }); 

  it('FULL_LOAD applies A=5, C=4, D=2 to paper targets regardless of power factor', () => {
    const minorRun = zoneRun({ loadType: 'FULL_LOAD' }, 'MINOR');
    const majorRun = zoneRun({ loadType: 'FULL_LOAD' }, 'MAJOR');
    expect(minorRun.rawPoints).toBe(9); // A + C under full load = 5 + 4
    expect(majorRun.rawPoints).toBe(9);
  });

  it('MINIMUM_LOAD applies A=5, C=3, D=1 to paper targets regardless of power factor', () => {
    const majorRun = zoneRun({ loadType: 'MINIMUM_LOAD' }, 'MAJOR');
    expect(majorRun.rawPoints).toBe(8); // A + C under minimum load = 5 + 3
  });

  it('declared load type overrides the power-factor Major/Minor table', () => {
    // Major table alone would give A+C=9; Minimum Load overrides it to 8.
    const result = zoneRun({ loadType: 'MINIMUM_LOAD' }, 'MAJOR');
    expect(result.rawPoints).toBe(8);
  });

  it('resolveLoadTypeParams is a no-op when no load type is declared (power factor governs)', () => {
    expect(resolveLoadTypeParams(params, undefined)).toBe(params);
    expect(resolveLoadTypeParams(params, null)).toBe(params);
    expect(resolveLoadTypeParams(params, 'FULL_LOAD')).not.toBe(params);
    const full = resolveLoadTypeParams(params, 'FULL_LOAD');
    expect(full.paperPointsMajor.A).toBe(5);
    expect(full.paperPointsMajor.C).toBe(4);
    expect(full.paperPointsMajor.D).toBe(2);
  });

  it('stage layout maximum points honor the declared load type', () => {
    const { targets } = specStageTargets();
    const full = calculateStageScore({
      context: ctx({ loadType: 'FULL_LOAD', scoringFactor: 'MINOR', maximumStagePoints: 130 }),
      input: inp({ targets, targetScores: targets.map((t) => t.targetType === 'PAPER' ? { targetId: t.targetId, zoneHits: ['A', 'A'] } : { targetId: t.targetId, hits: 1 }), timeSeconds: 10 }),
      params,
    });
    // Full load still tops out at 130; no maximum-mismatch warning.
    expect(full.warnings.some((w) => w.includes('maximum points'))).toBe(false);
  });

  it('full-load vs minimum-load values are ruleset parameters, not hard-coded', () => {
    const custom = buildScoringRuleParams([{ key: 'scoring.paper.minimumLoad', value: 'A:4,C:2,D:1' }]);
    const result = calculateStageScore({
      context: ctx({ loadType: 'MINIMUM_LOAD', maximumStagePoints: 20 }),
      input: inp({ targets: [paper('p1', 2)], targetScores: [{ targetId: 'p1', zoneHits: ['A', 'C'] }], timeSeconds: 5 }),
      params: custom,
    });
    expect(result.rawPoints).toBe(6); // A + C = 4 + 2
  });
});

describe('PSMOC: unlimited shots', () => {
  const maxRoundsCtx = (over: Partial<StageScoringContext> = {}) =>
    ctx({ maximumRounds: 26, ...over });

  it('shots beyond the stage maximum incur no procedural when unlimited shots are permitted', () => {
    const result = calculateStageScore({
      context: maxRoundsCtx(),
      input: inp({
        targets: [paper('p1', 2)],
        targetScores: [{ targetId: 'p1', zoneHits: ['A', 'A'] }],
        shotsFired: 29,
        timeSeconds: 10,
      }),
      params,
    });
    expect(result.valid).toBe(true);
    expect(result.procedurals).toBe(0);
    expect(result.penaltyPoints).toBe(0);
    expect(result.warnings.some((w) => w.includes('unlimited-shots'))).toBe(true);
  });

  it('a restricted PSMOC ruleset applies a procedural per extra shot', () => {
    const restricted = buildScoringRuleParams([{ key: 'scoring.psmoc.unlimitedShots', value: 'false' }]);
    const result = calculateStageScore({
      context: maxRoundsCtx(),
      input: inp({
        targets: [paper('p1', 2)],
        targetScores: [{ targetId: 'p1', zoneHits: ['A', 'A'] }],
        shotsFired: 29,
        timeSeconds: 10,
      }),
      params: restricted,
    });
    expect(result.procedurals).toBe(3);
    expect(result.penaltyPoints).toBe(30);
  });

  it('unlimited-shots disclosure applies to Points Factor and Time Scoring alike', () => {
    const pf = calculateStageScore({
      context: maxRoundsCtx(),
      input: inp({ targets: [paper('p1', 2)], targetScores: [{ targetId: 'p1', zoneHits: ['A', 'A'] }], shotsFired: 28, timeSeconds: 10 }),
      params,
    });
    const time = calculateStageScore({
      context: maxRoundsCtx({ scoringMethod: 'PSMOC_TIME' }),
      input: inp({ targets: [paper('p1', 2)], targetScores: [{ targetId: 'p1', zoneHits: ['A', 'A'] }], shotsFired: 28, timeSeconds: 20 }),
      params,
    });
    expect(pf.warnings.some((w) => w.includes('extra shot'))).toBe(true);
    expect(time.warnings.some((w) => w.includes('extra shot'))).toBe(true);
    expect(pf.procedurals).toBe(0);
    expect(time.procedurals).toBe(0);
    expect(time.timeAdjustments.procedural).toBe(0);
  });
});

describe('PSMOC: reproducibility and recalculation', () => {
  it('21. identical inputs produce identical results under the same ruleset version', () => {
    const make = (): StageScoreInput => inp({ targets: [paper('p1', 2)], targetScores: [{ targetId: 'p1', zoneHits: ['A', 'C'] }], timeSeconds: 20 });
    const c = ctx({ scoringMethod: 'PSMOC_TIME' });
    const one = calculateStageScore({ context: c, input: make(), params });
    const two = calculateStageScore({ context: c, input: make(), params });
    expect(one).toEqual(two);
    expect(one.finalTimeSeconds).toBe(21);
  });

  it('different ruleset versions can carry different time adjustments', () => {
    const v2 = buildScoringRuleParams([{ key: 'scoring.time.adjust.charlie', value: '2' }]);
    const result = calculateStageScore({
      context: ctx({ scoringMethod: 'PSMOC_TIME' }),
      input: inp({ targets: [paper('p1', 2)], targetScores: [{ targetId: 'p1', zoneHits: ['A', 'C'] }], timeSeconds: 20 }),
      params: v2,
    });
    expect(result.finalTimeSeconds).toBe(22); // charlie +2 under v2
  });
});