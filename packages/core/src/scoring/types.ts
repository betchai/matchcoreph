import type { LoadType, PowerFactor, ScoringMethod, ScoringZone, TargetType } from '../domain/enums.js';
import type { ScoringRuleParams } from '../rules/parameterDefs.js';
import type { ConfigIssue } from './errors.js';

export interface EngineTargetConfig {
  targetId: string;
  targetType: TargetType;
  requiredHits: number | null;
  scoringZones?: ScoringZone[];
  noShootRelatedTargetId?: string | null;
}

export interface TargetScoreInput {
  targetId: string;
  zoneHits?: ScoringZone[];
  hits?: number;
  steelMisses?: number;
  noShootHits?: number;
}

export interface StageScoringContext {
  scoringMethod: ScoringMethod;
  scoringFactor: PowerFactor;
  /** PSMOC target loading. When set it selects the paper point-value table
   *  (Full Load vs Minimum Load) for the stage, overriding the power-factor
   *  Major/Minor tables. Absent for IPSC/PPSA where power factor governs. */
  loadType?: LoadType | null;
  maximumStagePoints: number;
  maximumRounds: number | null;
  minimumRounds: number | null;
  stageRequiredHits: number | null;
  fixedTimeSeconds: number | null;
  rulesetVersion: string;
}

export interface PenaltyEvent {
  type: 'MISS' | 'NO_SHOOT' | 'PROCEDURAL' | 'OTHER';
  value: number;
  count: number;
  source: string;
  remark?: string;
}

export interface StageScoreInput {
  timeSeconds: number | null;
  targets: EngineTargetConfig[];
  targetScores: TargetScoreInput[];
  misses: number;
  paperNoShoots: number;
  procedurals: number;
  penaltiesOther: number;
  shotsFired: number | null;
}

export interface CalculatedStageScore {
  method: ScoringMethod;
  rawPoints: number | null;
  penaltyPoints: number;
  netPoints: number | null;
  timeSeconds: number | null;
  hitFactor: number | null;
  stagePoints: number | null;
  misses: number;
  noShootHits: number;
  procedurals: number;
  valid: boolean;
  penaltyEvents: PenaltyEvent[];
  targetDetails: TargetDetail[];
  configErrors: ConfigIssue[];
  warnings: string[];
  /** PSMOC Time Scoring: raw time plus all time adjustments/penalties (in seconds). */
  finalTimeSeconds: number | null;
  /** PSMOC Time Scoring: total seconds added to the raw time by zone hits and penalties. */
  timeAdjustmentsSeconds: number;
  /** PSMOC Time Scoring: seconds added per zone for transparency in the score entry UI. */
  timeAdjustments: { alpha: number; charlie: number; delta: number; miss: number; noShoot: number; procedural: number; other: number };
}

export interface TargetDetail {
  targetId: string;
  targetType: TargetType;
  requiredHits: number | null;
  hitsRecorded: number;
  rawPoints: number;
  misses: number;
  noShootHits: number;
  extraHits: number;
  /** PSMOC Time Scoring: recorded scoring-zone counts on this target (paper only). */
  zoneCounts: { A: number; C: number; D: number };
}

export interface Runner {
  registrationId: string;
  divisionId: string | null;
  categoryId: string | null;
  competitorStatus: string;
  stageScore: CalculatedStageScore | null;
  matchTotal: number | null;
  tie?: boolean;
  rank?: number;
  tieCount?: number;
}