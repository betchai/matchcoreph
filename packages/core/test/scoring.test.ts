import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCORING_RULE_PARAMS,
  buildScoringRuleParams,
  calculateStageScore,
  rankStage,
  computeStagePoints,
  rankCompetitors,
  groupByKey,
  roundTo,
  roundHitFactor,
  roundStagePoints,
  calculatePowerFactor,
  classifyPowerFactor,
} from '../src/index.js';
import type { EngineTargetConfig, StageScoreInput, StageScoringContext } from '../src/scoring/types.js';
import type { TotaledCompetitor } from '../src/scoring/rankings.js';

const params = DEFAULT_SCORING_RULE_PARAMS;

function paperTarget(id: string, requiredHits: number): EngineTargetConfig {
  return { targetId: id, targetType: 'PAPER', requiredHits };
}

function context(over: Partial<StageScoringContext> = {}): StageScoringContext {
  return {
    scoringMethod: 'COMSTOCK',
    scoringFactor: 'MINOR',
    maximumStagePoints: 100,
    maximumRounds: null,
    minimumRounds: null,
    stageRequiredHits: null,
    fixedTimeSeconds: null,
    rulesetVersion: '2026-01',
    ...over,
  };
}

function input(over: Partial<StageScoreInput> = {}): StageScoreInput {
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

/** Builds a Comstock stage whose raw points come entirely from paper targets, minor PF. */
function paperStage(): {
  targets: EngineTargetConfig[];
  hit: (target: string, zones: string[]) => { targetId: string; zoneHits: any[] };
} {
  const targets = [
    paperTarget('t1', 10),
    paperTarget('t2', 2),
    paperTarget('t3', 2),
    paperTarget('t4', 2),
  ];
  const hit = (target: string, zones: string[]) => ({ targetId: target, zoneHits: zones });
  return { targets, hit };
}

describe('precision', () => {
  it('rounds behind-precision values deterministically', () => {
    expect(roundTo(4.571428571428571, 4)).toBe(4.5714);
    expect(roundTo(6.4 / 8 * 100, 4)).toBe(80);
    expect(roundHitFactor(48 / 6, 4)).toBe(8);
    expect(roundStagePoints((32 / 7 / 8) * 100, 4)).toBe(57.1429);
  });
});

describe('Comstock: target scoring A/C/D', () => {
  it('scores a paper target with two required hits using highest-value zones', () => {
    const { targets, hit } = paperStage();
    // t2 requires 2 hits, minor: A=5, C=3
    const result = calculateStageScore({
      context: context(),
      input: input({ targets: [paperTarget('t2', 2)], targetScores: [hit('t2', ['A', 'C'])], timeSeconds: 6 }),
      params,
    });
    expect(result.valid).toBe(true);
    expect(result.rawPoints).toBe(8);
    expect(result.penaltyPoints).toBe(0);
    expect(result.hitFactor).toBeCloseTo(8 / 6, 10);
  });

  it('applies Major power factor values: C=4, D=2', () => {
    const result = calculateStageScore({
      context: context({ scoringFactor: 'MAJOR' }),
      input: input({
        targets: [paperTarget('t1', 2)],
        targetScores: [{ targetId: 't1', zoneHits: ['C', 'D'] }],
        timeSeconds: 5,
      }),
      params,
    });
    expect(result.rawPoints).toBe(6); // 4 + 2
  });

  it('applies Minor power factor values: C=3, D=1', () => {
    const result = calculateStageScore({
      context: context({ scoringFactor: 'MINOR' }),
      input: input({
        targets: [paperTarget('t1', 2)],
        targetScores: [{ targetId: 't1', zoneHits: ['C', 'D'] }],
        timeSeconds: 5,
      }),
      params,
    });
    expect(result.rawPoints).toBe(4); // 3 + 1
  });

  it('counts only the stipulated number of hits per target', () => {
    // required 2 and recorded exactly 2 hits (A,C): counted A+C.
    const result = calculateStageScore({
      context: context(),
      input: input({
        targets: [paperTarget('t1', 2)],
        targetScores: [{ targetId: 't1', zoneHits: ['A', 'C'] }],
        timeSeconds: 5,
      }),
      params,
    });
    expect(result.rawPoints).toBe(8);
  });

  it('rejects a paper target recorded with more hits than its stipulation', () => {
    // required 2 but recorded 3 hits (A,C,D) — surfaced as a hard error, never guessed.
    const result = calculateStageScore({
      context: context(),
      input: input({
        targets: [paperTarget('t1', 2)],
        targetScores: [{ targetId: 't1', zoneHits: ['A', 'C', 'D'] }],
        timeSeconds: 5,
      }),
      params,
    });
    expect(result.valid).toBe(false);
    expect(result.configErrors.some((e) => e.code === 'TARGET_HITS_EXCEEDED')).toBe(true);
  });

  it('derives a miss penalty when a required hit is absent', () => {
    const result = calculateStageScore({
      context: context(),
      input: input({
        targets: [paperTarget('t1', 2)],
        targetScores: [{ targetId: 't1', zoneHits: ['A'] }],
        timeSeconds: 5,
      }),
      params,
    });
    expect(result.rawPoints).toBe(5);
    expect(result.misses).toBe(1);
    expect(result.penaltyPoints).toBe(10);
    expect(result.netPoints).toBe(-5);
  });

  it('rejects paper targets with more hits than stipulation regardless of extra-hit policy', () => {
    const result = calculateStageScore({
      context: context(),
      input: input({
        targets: [paperTarget('t1', 2)],
        targetScores: [{ targetId: 't1', zoneHits: ['A', 'A', 'A', 'A'] }],
        timeSeconds: 5,
      }),
      params,
    });
    expect(result.valid).toBe(false);
    expect(result.configErrors.some((e) => e.code === 'TARGET_HITS_EXCEEDED')).toBe(true);
  });

  it('applies MISS / NO-SHOOT / PROCEDURAL stage events', () => {
    const result = calculateStageScore({
      context: context(),
      input: input({
        targets: [paperTarget('t1', 2), paperTarget('u1', 2)],
        targetScores: [
          { targetId: 't1', zoneHits: ['A', 'C'] },
          { targetId: 'u1', zoneHits: ['A', 'A'] },
        ],
        timeSeconds: 5,
        paperNoShoots: 1,
        procedurals: 1,
      }),
      params,
    });
    expect(result.rawPoints).toBe(18); // 8 + 10
    expect(result.noShootHits).toBe(1);
    expect(result.penaltyPoints).toBe(20); // no-shoot 10 + procedural 10
    expect(result.netPoints).toBe(-2);
  });

  it('scores steel targets at the configured point value and misses as penalties', () => {
    const result = calculateStageScore({
      context: context(),
      input: input({
        targets: [{ targetId: 'p1', targetType: 'POPPER', requiredHits: 1 }],
        targetScores: [{ targetId: 'p1', hits: 1 }],
        timeSeconds: 5,
      }),
      params,
    });
    expect(result.rawPoints).toBe(5);
    expect(result.penaltyPoints).toBe(0);

    const missed = calculateStageScore({
      context: context(),
      input: input({
        targets: [{ targetId: 'p1', targetType: 'POPPER', requiredHits: 1 }],
        targetScores: [{ targetId: 'p1', hits: 0, steelMisses: 1 }],
        timeSeconds: 5,
      }),
      params,
    });
    expect(missed.rawPoints).toBe(0);
    expect(missed.penaltyPoints).toBe(10);
  });
});

describe('CRITICAL TEST #71: deterministic Comstock scoring', () => {
  const stageMax = 100;

  function shoot(zoneHits: string[], penalties?: number, time = 6): { hf: number | null; score: ReturnType<typeof calculateStageScore> } {
    const score = calculateStageScore({
      context: context({ maximumStagePoints: stageMax }),
      input: input({
        targets: [{ targetId: 't', targetType: 'PAPER', requiredHits: zoneHits.length }],
        targetScores: [{ targetId: 't', zoneHits }],
        timeSeconds: time,
        paperNoShoots: penalties ?? 0,
      }),
      params,
    });
    return { hf: score.hitFactor, score };
  }

  it('computes hit factors 8.0000 / 7.2000 / 4.5714 and stage points 100 / 90 / 57.1429', () => {
    const a = shoot(['A', 'C'], 0, 6.0); // raw 48 … wait: rebuild below
    void a;
    // Shooter A: raw 48, penalties 0, time 6.00 → HF 8.0000
    const scoreA = calculateStageScore({
      context: context({ maximumStagePoints: stageMax }),
      input: input({
        targets: [{ targetId: 't', targetType: 'PAPER', requiredHits: 10 }],
        targetScores: [{ targetId: 't', zoneHits: ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'C'] }], // 9A,1C
        timeSeconds: 6.0,
      }),
      params,
    });

    // Shooter B: raw 45, penalties 0, time 6.25 → HF 7.2000
    const scoreB = calculateStageScore({
      context: context({ maximumStagePoints: stageMax }),
      input: input({
        targets: [{ targetId: 't', targetType: 'PAPER', requiredHits: 9 }],
        targetScores: [{ targetId: 't', zoneHits: ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A'] }],
        timeSeconds: 6.25,
      }),
      params,
    });

    // Shooter C: raw 42, penalties 10, time 7.00 → HF 4.5714 (42-10=32; 32/7)
    const scoreC = calculateStageScore({
      context: context({ maximumStagePoints: stageMax }),
      input: input({
        targets: [{ targetId: 't', targetType: 'PAPER', requiredHits: 10 }],
        targetScores: [{ targetId: 't', zoneHits: ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'C', 'C', 'D'] }], // 7A,2C,1D = 42
        timeSeconds: 7.0,
        paperNoShoots: 1, // -10
      }),
      params,
    });

    expect(scoreA.valid).toBe(true);
    expect(scoreA.rawPoints).toBe(48);
    expect(scoreA.netPoints).toBe(48);
    expect(roundHitFactor(scoreA.hitFactor!, 4)).toBe(8.0);

    expect(scoreB.valid).toBe(true);
    expect(scoreB.rawPoints).toBe(45);
    expect(roundHitFactor(scoreB.hitFactor!, 4)).toBe(7.2);

    expect(scoreC.valid).toBe(true);
    expect(scoreC.rawPoints).toBe(42);
    expect(scoreC.penaltyPoints).toBe(10);
    expect(scoreC.netPoints).toBe(32);
    expect(roundHitFactor(scoreC.hitFactor!, 4)).toBe(4.5714);

    const ranked = rankStage(
      [
        { registrationId: 'A', competitorStatus: 'COMPLETED', competitorIsScored: true, hitFactor: scoreA.hitFactor, stagePoints: null, netPoints: scoreA.netPoints },
        { registrationId: 'B', competitorStatus: 'COMPLETED', competitorIsScored: true, hitFactor: scoreB.hitFactor, stagePoints: null, netPoints: scoreB.netPoints },
        { registrationId: 'C', competitorStatus: 'COMPLETED', competitorIsScored: true, hitFactor: scoreC.hitFactor, stagePoints: null, netPoints: scoreC.netPoints },
      ],
      stageMax,
      4,
      false,
    );

    const byId = new Map(ranked.map((r) => [r.registrationId, r]));
    expect(roundStagePoints(byId.get('A')!.stagePoints!, 4)).toBe(100.0);
    expect(roundStagePoints(byId.get('B')!.stagePoints!, 4)).toBe(90.0);
    expect(roundStagePoints(byId.get('C')!.stagePoints!, 4)).toBe(57.1429);
  });

  it('is deterministic: identical inputs produce identical outputs', () => {
    const ctx = context({ maximumStagePoints: stageMax });
    const makeInput = (): StageScoreInput =>
      input({
        targets: [{ targetId: 't', targetType: 'PAPER', requiredHits: 2 }],
        targetScores: [{ targetId: 't', zoneHits: ['A', 'C'] }],
        timeSeconds: 6.5,
      });
    const one = calculateStageScore({ context: ctx, input: makeInput(), params });
    const two = calculateStageScore({ context: ctx, input: makeInput(), params });
    expect(one).toEqual(two);
  });
});

describe('Virginia Count', () => {
  it('VC: rejects per-target hits beyond the stipulated scoring hits', () => {
    const result = calculateStageScore({
      context: context({ scoringMethod: 'VIRGINIA_COUNT', maximumRounds: 4 }),
      input: input({
        targets: ['t1', 't2'].map((id) => paperTarget(id, 2)),
        targetScores: [
          { targetId: 't1', zoneHits: ['A', 'A'] },
          { targetId: 't2', zoneHits: ['A', 'A', 'A', 'A'] }, // 4 recorded vs 2 required
        ],
        timeSeconds: 10.0,
      }),
      params,
    });
    expect(result.valid).toBe(false);
    expect(result.configErrors.some((e) => e.code === 'TARGET_HITS_EXCEEDED')).toBe(true);
  });

  it('VC: fires beyond shot limit are flagged per configured policy', () => {
    const result = calculateStageScore({
      context: context({ scoringMethod: 'VIRGINIA_COUNT', maximumRounds: 8 }),
      input: input({
        targets: ['t1', 't2', 't3', 't4'].map((id) => paperTarget(id, 2)),
        targetScores: [
          { targetId: 't1', zoneHits: ['A', 'A'] },
          { targetId: 't2', zoneHits: ['A', 'A'] },
          { targetId: 't3', zoneHits: ['A', 'A'] },
          { targetId: 't4', zoneHits: ['A', 'A'] },
        ],
        timeSeconds: 15.0,
        shotsFired: 10, // 2 over the maximum of 8
      }),
      params,
    });
    expect(result.valid).toBe(true);
    expect(result.penaltyPoints).toBe(20); // 2 extra shots → 2 procedurals
    expect(result.procedurals).toBe(2);
  });

  it('VC: required shots not fired count as misses (configured)', () => {
    const result = calculateStageScore({
      context: context({ scoringMethod: 'VIRGINIA_COUNT', maximumRounds: null }),
      input: input({
        targets: ['t1', 't2'].map((id) => paperTarget(id, 2)), // 4 required
        targetScores: [{ targetId: 't1', zoneHits: ['A'] }],
        timeSeconds: 10.0,
      }),
      params,
    });
    expect(result.misses).toBe(3); // t1 missing one + t2 both
    expect(result.penaltyPoints).toBe(30);
  });
});

describe('Fixed Time', () => {
  it('stops the clock at the fixed stage time when configured', () => {
    const result = calculateStageScore({
      context: context({ scoringMethod: 'FIXED_TIME', fixedTimeSeconds: 5.0 }),
      input: input({
        targets: [paperTarget('t1', 2)],
        targetScores: [{ targetId: 't1', zoneHits: ['A', 'A'] }],
        timeSeconds: 6.5,
      }),
      params,
    });
    expect(result.timeSeconds).toBe(5.0);
    expect(result.hitFactor).toBeCloseTo(10 / 5, 10);
  });

  it('does not stop the clock at fixed time when the ruleset disables it', () => {
    const custom = buildScoringRuleParams([{ key: 'scoring.fixedTime.timeStopsAtFixedTime', value: 'false' }]);
    const result = calculateStageScore({
      context: context({ scoringMethod: 'FIXED_TIME', fixedTimeSeconds: 5.0 }),
      input: input({
        targets: [paperTarget('t1', 2)],
        targetScores: [{ targetId: 't1', zoneHits: ['A', 'A'] }],
        timeSeconds: 6.5,
      }),
      params: custom,
    });
    expect(result.timeSeconds).toBe(6.5);
  });
});

describe('configuration surfacing (never guess)', () => {
  it('flags when required scoring hits are unset everywhere', () => {
    const custom = buildScoringRuleParams([]);
    // force default to 0? We keep the default, but stage/target being empty still resolves to default.
    // Use a target whose config we make impossible: treat REQUIRE_CONFIG via extraHitPolicy on mismatch.
    const result = calculateStageScore({
      context: context({ stageRequiredHits: null }),
      input: input({
        targets: [{ targetId: 't1', targetType: 'PAPER', requiredHits: null }],
        targetScores: [{ targetId: 't1', zoneHits: ['A', 'A'] }],
        timeSeconds: 5,
      }),
      params: { ...custom, extraHitPolicy: 'REQUIRE_CONFIG' },
    });
    void result;
    const r2 = calculateStageScore({
      context: context({ stageRequiredHits: null }),
      input: input({
        targets: [{ targetId: 't1', targetType: 'PAPER', requiredHits: null }],
        targetScores: [{ targetId: 't1', zoneHits: ['A', 'A', 'D'] }], // 3 recorded vs default 2 → exceeds stipulation
        timeSeconds: 5,
      }),
      params: { ...custom, extraHitPolicy: 'REQUIRE_CONFIG' },
    });
    expect(r2.valid).toBe(false);
    expect(r2.configErrors.some((e) => e.code === 'TARGET_HITS_EXCEEDED')).toBe(true);
  });

  it('requires a valid time for hit factor', () => {
    const result = calculateStageScore({
      context: context(),
      input: input({
        targets: [paperTarget('t1', 2)],
        targetScores: [{ targetId: 't1', zoneHits: ['A', 'A'] }],
        timeSeconds: 0,
      }),
      params,
    });
    expect(result.valid).toBe(false);
    expect(result.configErrors.some((e) => e.code === 'INVALID_TIME')).toBe(true);
  });
});

describe('point-cap hardening (max target / max stage)', () => {
  const fourPaperOnePlate = (): { targets: EngineTargetConfig[]; hit: (id: string, zones: string[]) => { targetId: string; zoneHits: string[] } | { targetId: string; hits: number } } => ({
    targets: [
      { targetId: 'p1', targetType: 'PAPER', requiredHits: 2 },
      { targetId: 'p2', targetType: 'PAPER', requiredHits: 2 },
      { targetId: 'p3', targetType: 'PAPER', requiredHits: 2 },
      { targetId: 'p4', targetType: 'PAPER', requiredHits: 2 },
      { targetId: 's1', targetType: 'PLATE', requiredHits: 1 },
    ],
    hit: (id: string, ...rest: unknown[]) => ({ targetId: id, ...(id.startsWith('p') ? { zoneHits: rest as string[] } : { hits: Number(rest[0]) }) }),
  });

  it('derives the layout maximum: 4 paper (10 each) + 1 plate (5) = 45', () => {
    const { targets } = fourPaperOnePlate();
    const ctx = context({ maximumStagePoints: 45 });
    const result = calculateStageScore({
      context: ctx,
      input: input({
        targets,
        targetScores: [
          { targetId: 'p1', zoneHits: ['A', 'A'] },
          { targetId: 'p2', zoneHits: ['A', 'A'] },
          { targetId: 'p3', zoneHits: ['A', 'A'] },
          { targetId: 'p4', zoneHits: ['A', 'A'] },
          { targetId: 's1', hits: 1 },
        ],
        timeSeconds: 20,
      }),
      params,
    });
    expect(result.valid).toBe(true);
    expect(result.rawPoints).toBe(45);
    expect(result.warnings.some((w) => w.includes('maximum points'))).toBe(false);
  });

  it('blocks a score whose raw points exceed the declared stage maximum', () => {
    // Declared max 10, layout allows 45 — a full 45-raw run must be rejected.
    const { targets } = fourPaperOnePlate();
    const result = calculateStageScore({
      context: context({ maximumStagePoints: 10 }),
      input: input({
        targets,
        targetScores: [
          { targetId: 'p1', zoneHits: ['A', 'A'] },
          { targetId: 'p2', zoneHits: ['A', 'A'] },
          { targetId: 'p3', zoneHits: ['A', 'A'] },
          { targetId: 'p4', zoneHits: ['A', 'A'] },
          { targetId: 's1', hits: 1 },
        ],
        timeSeconds: 20,
      }),
      params,
    });
    expect(result.rawPoints).toBeNull(); // invalid scores carry no usable raw/net
    expect(result.netPoints).toBeNull();
    expect(result.valid).toBe(false);
    expect(result.hitFactor).toBeNull();
    expect(result.configErrors.some((e) => e.code === 'STAGE_POINTS_EXCEEDED')).toBe(true);
  });

  it('flags a stage whose declared max disagrees with the layout max as a warning', () => {
    const { targets } = fourPaperOnePlate();
    const result = calculateStageScore({
      context: context({ maximumStagePoints: 40 }), // layout supports 45
      input: input({
        targets,
        targetScores: [
          { targetId: 'p1', zoneHits: ['A', 'A'] },
          { targetId: 'p2', zoneHits: ['A', 'A'] },
          { targetId: 'p3', zoneHits: ['A', 'A'] },
          { targetId: 'p4', zoneHits: ['A', 'C'] },
        ],
        timeSeconds: 20,
      }),
      params,
    });
    expect(result.valid).toBe(true);
    expect(result.rawPoints).toBe(38); // within the declared 40
    expect(result.warnings.some((w) => w.includes('layout supports 45'))).toBe(true);
  });

  it('flags a steel target that recorded more hits than its ceiling', () => {
    // A plate scores one hit worth 5; two recorded hits would produce 10 → cap breached.
    const result = calculateStageScore({
      context: context({ maximumStagePoints: 45 }),
      input: input({
        targets: fourPaperOnePlate().targets,
        targetScores: [{ targetId: 's1', hits: 2 }],
        timeSeconds: 20,
      }),
      params,
    });
    expect(result.valid).toBe(false);
    expect(result.hitFactor).toBeNull();
    expect(result.configErrors.some((e) => e.code === 'TARGET_POINTS_EXCEEDED' && e.targetId === 's1')).toBe(true);
  });

  it('does not flag a paper target at exactly its ceiling (10)', () => {
    const result = calculateStageScore({
      context: context({ maximumStagePoints: 30 }),
      input: input({
        targets: [
          { targetId: 'p1', targetType: 'PAPER', requiredHits: 2 },
          { targetId: 'p2', targetType: 'PAPER', requiredHits: 2 },
        ],

        targetScores: [
          { targetId: 'p1', zoneHits: ['A', 'A'] },
          { targetId: 'p2', zoneHits: ['A', 'A'] },
        ],
        timeSeconds: 20,
      }),
      params,
    });
    expect(result.valid).toBe(true);
    expect(result.rawPoints).toBe(20);
    expect(result.configErrors.some((e) => e.code === 'TARGET_POINTS_EXCEEDED')).toBe(false);
  });
});

describe('scoring-zone validation', () => {
  it('allows zones not on a target when none are declared (ruleset default A/C/D)', () => {
    const result = calculateStageScore({
      context: context({ maximumStagePoints: 10 }),
      input: input({
        targets: [{ targetId: 'p1', targetType: 'PAPER', requiredHits: 2 }],
        targetScores: [{ targetId: 'p1', zoneHits: ['C', 'D'] }],
        timeSeconds: 5,
      }),
      params,
    });
    expect(result.valid).toBe(true);
    expect(result.rawPoints).toBe(4);
  });

  it('accepts zones declared on the target', () => {
    const result = calculateStageScore({
      context: context({ maximumStagePoints: 10 }),
      input: input({
        targets: [{ targetId: 'p1', targetType: 'PAPER', requiredHits: 2, scoringZones: ['A', 'C'] }],
        targetScores: [{ targetId: 'p1', zoneHits: ['A', 'C'] }],
        timeSeconds: 5,
      }),
      params,
    });
    expect(result.valid).toBe(true);
    expect(result.rawPoints).toBe(8);
  });

  it('rejects a zone the target does not declare', () => {
    const result = calculateStageScore({
      context: context({ maximumStagePoints: 10 }),
      input: input({
        targets: [{ targetId: 'p1', targetType: 'PAPER', requiredHits: 2, scoringZones: ['A', 'C'] }],
        targetScores: [{ targetId: 'p1', zoneHits: ['A', 'D'] }],
        timeSeconds: 5,
      }),
      params,
    });
    expect(result.valid).toBe(false);
    expect(result.hitFactor).toBeNull();
    expect(result.configErrors.some((e) => e.code === 'ZONE_NOT_RECORDABLE' && e.targetId === 'p1')).toBe(true);
  });
});

describe('stage points and match aggregation', () => {
  it('computes stage points proportionally to the stage winner', () => {
    expect(computeStagePoints(8.0, 8.0, 100, 4, false)).toBe(100);
    expect(computeStagePoints(7.2, 8.0, 100, 4, false)).toBe(90);
    expect(computeStagePoints(4.57142857, 8.0, 100, 4, false)).toBeCloseTo(57.1429, 4);
  });

  it('ranks a division by descending match totals and discloses ties', () => {
    const rows: TotaledCompetitor[] = [
      { registrationId: 'r1', divisionId: 'prod', categoryId: null, competitorStatus: 'COMPLETED', matchTotal: 200, excluded: false, stagePoints: {} },
      { registrationId: 'r2', divisionId: 'prod', categoryId: null, competitorStatus: 'COMPLETED', matchTotal: 200, excluded: false, stagePoints: {} },
      { registrationId: 'r3', divisionId: 'prod', categoryId: null, competitorStatus: 'COMPLETED', matchTotal: 150, excluded: false, stagePoints: {} },
      { registrationId: 'r4', divisionId: 'prod', categoryId: null, competitorStatus: 'DQ', matchTotal: 0, excluded: true, stagePoints: {} },
    ];
    const ranked = rankCompetitors(rows, 4, 'NONE');
    expect(ranked).toHaveLength(3);
    expect(ranked[0]!.rank).toBe(1);
    expect(ranked[0]!.rankDisplay).toBe('TIE');
    expect(ranked[0]!.tie).toBe(true);
    expect(ranked[1]!.rank).toBe(1);
    expect(ranked[2]!.rank).toBe(3);
  });

  it('does not disclose a tie between equal totals in different divisions', () => {
    const rows: TotaledCompetitor[] = [
      { registrationId: 'r1', divisionId: 'open', categoryId: null, competitorStatus: 'COMPLETED', matchTotal: 200, excluded: false, stagePoints: {} },
      { registrationId: 'r2', divisionId: 'prod', categoryId: null, competitorStatus: 'COMPLETED', matchTotal: 200, excluded: false, stagePoints: {} },
      { registrationId: 'r3', divisionId: 'prod', categoryId: null, competitorStatus: 'COMPLETED', matchTotal: 200, excluded: false, stagePoints: {} },
    ];
    const ranked = rankCompetitors(rows, 4, 'NONE');
    expect(ranked).toHaveLength(3);
    expect(ranked.map((r) => [r.registrationId, r.tie, r.rank, r.rankDisplay])).toEqual([
      ['r1', false, 1, '1'],
      ['r2', true, 2, 'TIE'],
      ['r3', true, 2, 'TIE'],
    ]);
  });

  it('handles zero-score / negative net scores deterministically', () => {
    const result = calculateStageScore({
      context: context(),
      input: input({
        targets: [paperTarget('t1', 2)],
        targetScores: [],
        timeSeconds: 6,
        misses: 2,
      }),
      params,
    });
    expect(result.rawPoints).toBe(0);
    expect(result.netPoints).toBe(-40); // 2 per-target misses + 2 stage misses
  });

  it('groups rows by key for division/category ranking', () => {
    const rows: TotaledCompetitor[] = [
      { registrationId: '1', divisionId: 'open', categoryId: 'LADY', competitorStatus: 'COMPLETED', matchTotal: 1, excluded: false, stagePoints: {} },
      { registrationId: '2', divisionId: 'prod', categoryId: 'LADY', competitorStatus: 'COMPLETED', matchTotal: 2, excluded: false, stagePoints: {} },
      { registrationId: '3', divisionId: 'open', categoryId: null, competitorStatus: 'COMPLETED', matchTotal: 3, excluded: false, stagePoints: {} },
    ];
    const groups = groupByKey(rows, (r) => r.divisionId);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.key === 'open')!.rows).toHaveLength(2);
  });
});

describe('power factor / chronograph', () => {
  it('calculates power factor from bullet weight and velocity', () => {
    expect(calculatePowerFactor(124, 1089)).toBeCloseTo(135.036, 3);
  });

  it('classifies Major/Minor thresholds per ruleset', () => {
    expect(classifyPowerFactor(135, 125, 160)).toBe('MINOR');
    expect(classifyPowerFactor(165, 125, 160)).toBe('MAJOR');
    expect(classifyPowerFactor(110, 125, 160)).toBe('NOT_APPLICABLE');
  });
});

describe('ruleset parameter parsing', () => {
  it('overrides defaults from stored parameter rows', () => {
    const custom = buildScoringRuleParams([
      { key: 'penalty.miss', value: '15' },
      { key: 'scoring.stagePoints.minZero', value: 'true' },
    ]);
    expect(custom.missPenalty).toBe(15);
    expect(custom.stagePointsMinZero).toBe(true);
    expect(custom.missPenalty).not.toBe(DEFAULT_SCORING_RULE_PARAMS.missPenalty);
  });

  it('keeps defaults when keys are missing', () => {
    const custom = buildScoringRuleParams([]);
    expect(custom.missPenalty).toBe(DEFAULT_SCORING_RULE_PARAMS.missPenalty);
  });
});