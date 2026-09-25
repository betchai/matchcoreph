import type {
  AuditAction,
  CompetitorStatus,
  CourseType,
  Discipline,
  DisputeStatus,
  ExtraHitPolicy,
  LoadType,
  MatchLevel,
  MatchStatus,
  MatchType,
  OrganizationStatus,
  PenaltyType,
  PowerFactor,
  ResultVisibility,
  RulesetStatus,
  SanctioningStatus,
  ScoreStatus,
  ScoringMethod,
  ScoringZone,
  SyncStatus,
  TargetType,
  TieBreakMethod,
  TournamentAggregationMethod,
  UserRole,
} from './enums.js';

export interface Organization {
  id: string;
  name: string;
  shortName: string;
  logoUrl: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  activeStatus: OrganizationStatus;
  branding: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  displayName: string | null;
  locked: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgRole {
  id: string;
  organizationId: string;
  userId: string;
  role: UserRole;
  createdAt: string;
}

export interface Shooter {
  id: string;
  shooterNumber: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  email: string | null;
  phone: string | null;
  homeClub: string | null;
  ppsaMembershipNumber: string | null;
  ipscAlias: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY' | null;
  birthYear: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Ruleset {
  id: string;
  organizationId: string | null;
  name: string;
  organizationCode: string;
  discipline: Discipline;
  version: string;
  effectiveDate: string;
  description: string | null;
  status: RulesetStatus;
  sourceCitation: string | null;
  parentRulesetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuleParameter {
  id: string;
  rulesetId: string;
  key: string;
  value: string;
  label: string | null;
  description: string | null;
  updatedAt: string;
}

export interface Division {
  id: string;
  code: string;
  name: string;
  discipline: Discipline;
  rulesetId: string;
  majorPowerFactor: boolean;
  minorPowerFactor: boolean;
  majorAllowed: boolean;
  maximumCapacity: number | null;
  equipmentRestrictions: string | null;
  notes: string | null;
  active: boolean;
}

export interface Category {
  id: string;
  code: string;
  name: string;
  discipline: Discipline | null;
  rulesetId: string;
  description: string | null;
  active: boolean;
}

export interface Match {
  id: string;
  organizationId: string;
  name: string;
  matchType: MatchType;
  startDate: string;
  startTime: string | null;
  endDate: string | null;
  venue: string | null;
  matchDirectorUserId: string | null;
  rangeMasterUserId: string | null;
  matchLevel: MatchLevel;
  sanctioningStatus: SanctioningStatus;
  status: MatchStatus;
  visibility: ResultVisibility;
  rulesetId: string;
  rulesetVersion: string;
  aggregateMethod: TournamentAggregationMethod | null;
  tieBreakMethod: TieBreakMethod;
  tournamentParentId: string | null;
  publishedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MatchDiscipline {
  id: string;
  matchId: string;
  discipline: Discipline;
}

export interface MatchDivision {
  id: string;
  matchId: string;
  divisionId: string;
}

export interface MatchCategory {
  id: string;
  matchId: string;
  categoryId: string;
}

export interface StageTarget {
  id: string;
  stageId: string;
  number: number;
  name: string | null;
  targetType: TargetType;
  requiredHits: number | null;
  scoringZones: ScoringZone[] | null;
  noShootRelatedTargetId: string | null;
  maxPoints: number | null;
  active: boolean;
}

export interface Stage {
  id: string;
  matchId: string;
  number: number;
  name: string;
  courseType: CourseType;
  scoringMethod: ScoringMethod;
  /** PSMOC target loading (Full Load / Minimum Load) for this stage, or null
   *  when the power-factor Major/Minor tables govern (IPSC/PPSA). */
  loadType: LoadType | null;
  minimumRounds: number | null;
  maximumRounds: number | null;
  requiredHits: number | null;
  maximumStagePoints: number;
  fixedTimeSeconds: number | null;
  classifierDesignation: string | null;
  startPosition: string | null;
  startCondition: string | null;
  firearmCondition: string | null;
  procedure: string | null;
  briefing: string | null;
  description: string | null;
  diagramUrl: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Squad {
  id: string;
  matchId: string;
  name: string;
  stageNumber: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MatchRegistration {
  id: string;
  matchId: string;
  organizationId: string;
  shooterId: string;
  shooterNumber: string;
  divisionId: string | null;
  categoryId: string | null;
  declaredPowerFactor: PowerFactor;
  squadId: string | null;
  status: CompetitorStatus;
  matchNumber: string | null;
  notes: string | null;
  registeredAt: string;
  updatedAt: string;
  /** True when a 4-digit score-verification PIN is set on this registration. */
  hasScorePin?: boolean;
}

export interface ScorePenaltyEvent {
  type: PenaltyType;
  value: number;
  source: string;
  remark?: string;
}

export interface ScoreComputed {
  rawPoints: number | null;
  penalties: number | null;
  netPoints: number | null;
  timeSeconds: number | null;
  hitFactor: number | null;
}

export interface Score {
  id: string;
  matchId: string;
  stageId: string;
  registrationId: string;
  organizationId: string;
  status: ScoreStatus;
  syncStatus: SyncStatus;
  times: {
    timeSeconds: number | null;
  };
  targetResults: Record<string, unknown>;
  misses: number;
  paperNoShoots: number;
  procedurals: number;
  penaltiesOther: number;
  penaltyEvents: ScorePenaltyEvent[] | null;
  version: number;
  enteredBy: string | null;
  submittedBy: string | null;
  verifiedBy: string | null;
  scoredAt: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreCorrection {
  id: string;
  scoreId: string;
  field: string;
  previousValue: string | null;
  newValue: string | null;
  reason: string;
  authorizedBy: string;
  createdAt: string;
}

export interface Dispute {
  id: string;
  scoreId: string;
  registrationId: string;
  matchId: string;
  stageId: string;
  reason: string;
  comment: string | null;
  attachmentUrl: string | null;
  status: DisputeStatus;
  openedBy: string;
  resolvedBy: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  organizationId: string | null;
  userId: string | null;
  username: string | null;
  action: AuditAction;
  entity: string | null;
  entityId: string | null;
  oldValue: string | null;
  newValue: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface ChronographSession {
  id: string;
  matchId: string;
  registrationId: string;
  discipline: Discipline;
  bulletWeightGrains: number | null;
  shot1Velocity: number | null;
  shot2Velocity: number | null;
  shot3Velocity: number | null;
  calculatedPowerFactor: number | null;
  declaredPowerFactor: PowerFactor;
  verifiedPowerFactor: PowerFactor | null;
  finalScoringFactor: PowerFactor | null;
  notes: string | null;
  recordedBy: string;
  recordedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

export interface TournamentComponent {
  id: string;
  tournamentMatchId: string;
  componentMatchId: string;
  weight: number;
  sortOrder: number;
}

export interface TournamentResult {
  id: string;
  tournamentMatchId: string;
  registrationId: string;
  aggregatePoints: number | null;
  rank: number | null;
  tieCount: number | null;
  calculatedAt: string;
}

export interface AttendanceRecord {
  id: string;
  matchId: string;
  registrationId: string;
  squadId: string | null;
  checkedInAt: string;
  checkedInBy: string;
}

export interface MatchAssignment {
  id: string;
  matchId: string;
  userId: string;
  role: UserRole;
  stageId: string | null;
  squadId: string | null;
  createdAt: string;
}