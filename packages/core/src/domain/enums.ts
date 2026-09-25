export const ORGANIZATION_STATUS = ['active', 'inactive'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUS)[number];

export const DISCIPLINES = [
  'HANDGUN',
  'PCC',
  'RIFLE',
  'MINI_RIFLE',
  'SHOTGUN',
  'ACTION_AIR',
] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const MATCH_TYPES = ['CLUB_SHOOT', 'CUP', 'TOURNAMENT', 'CHAMPIONSHIP'] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export const SCORING_METHODS = ['COMSTOCK', 'VIRGINIA_COUNT', 'FIXED_TIME', 'PSMOC_POINTS_FACTOR', 'PSMOC_TIME'] as const;
export type ScoringMethod = (typeof SCORING_METHODS)[number];

export const SANCTIONING_STATUSES = ['CLUB', 'PENDING_SANCTION', 'PPSA_SANCTIONED', 'IPSC_SANCTIONED'] as const;
export type SanctioningStatus = (typeof SANCTIONING_STATUSES)[number];

export const MATCH_LEVELS = [1, 2, 3, 4, 5] as const;
export type MatchLevel = (typeof MATCH_LEVELS)[number];

export const MATCH_STATUSES = [
  'DRAFT',
  'CONFIGURED',
  'PUBLISHED',
  'ONGOING',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const COMPETITOR_STATUSES = [
  'REGISTERED',
  'CHECKED_IN',
  'ACTIVE',
  'COMPLETED',
  'DNS',
  'DNF',
  'DQ',
  'WITHDRAWN',
] as const;
export type CompetitorStatus = (typeof COMPETITOR_STATUSES)[number];

export const SCORE_STATUSES = ['DRAFT', 'SUBMITTED', 'VERIFIED', 'DISPUTED', 'CORRECTED', 'LOCKED'] as const;
export type ScoreStatus = (typeof SCORE_STATUSES)[number];
export const isVerifiedScoreStatus = (s: ScoreStatus): boolean =>
  s === 'VERIFIED' || s === 'CORRECTED' || s === 'LOCKED' || s === 'SUBMITTED';

export const SYNC_STATUSES = ['SYNC_PENDING', 'SYNCED'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const POWER_FACTORS = ['MINOR', 'MAJOR', 'NOT_APPLICABLE'] as const;
export type PowerFactor = (typeof POWER_FACTORS)[number];

export const SCORING_ZONES = ['A', 'C', 'D'] as const;
export type ScoringZone = (typeof SCORING_ZONES)[number];

/** PSMOC target loading: which paper point-value table governs a stage. */
export const LOAD_TYPES = ['FULL_LOAD', 'MINIMUM_LOAD'] as const;
export type LoadType = (typeof LOAD_TYPES)[number];

export const TARGET_TYPES = ['PAPER', 'PAPER_NO_SHOOT', 'STEEL', 'POPPER', 'PLATE', 'CUSTOM'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const PENALTY_TYPES = ['MISS', 'NO_SHOOT', 'PROCEDURAL', 'OTHER'] as const;
export type PenaltyType = (typeof PENALTY_TYPES)[number];

export const COURSE_TYPES = ['SHORT', 'MEDIUM', 'LONG', 'CLASSIFIER'] as const;
export type CourseType = (typeof COURSE_TYPES)[number];

export const RESULT_VISIBILITY = ['PRIVATE', 'INTERNAL', 'PUBLISHED'] as const;
export type ResultVisibility = (typeof RESULT_VISIBILITY)[number];

export const RULESET_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type RulesetStatus = (typeof RULESET_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'MATCH_REGISTRATION',
  'SQUAD_ASSIGNMENT',
  'SCORE_SUBMITTED',
  'SCORE_VERIFIED',
  'SCORE_DISPUTED',
  'SCORE_CORRECTED',
  'MATCH_PUBLISHED',
  'MATCH_CANCELLED',
  'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const AUDIT_ACTIONS = [
  'LOGIN',
  'LOGOUT',
  'MATCH_CREATED',
  'MATCH_MODIFIED',
  'MATCH_PUBLISHED',
  'MATCH_LOCKED',
  'STAGE_CREATED',
  'STAGE_MODIFIED',
  'STAGE_REMOVED',
  'SHOOTER_REGISTERED',
  'SHOOTER_REMOVED',
  'SCORE_ENTERED',
  'SCORE_MODIFIED',
  'SCORE_SUBMITTED',
  'SCORE_VERIFIED',
  'SCORE_LOCKED',
  'SCORE_UNLOCKED',
  'SCORE_REJECTED',
  'SCORE_CORRECTED',
  'DISPUTE_CREATED',
  'DISPUTE_RESOLVED',
  'CHRONO_COMPLETED',
  'USER_CREATED',
  'ROLE_CHANGED',
  'RULESET_CHANGED',
  'RESULT_PUBLISHED',
  'ORGANIZATION_CREATED',
  'ORGANIZATION_MODIFIED',
  'COMPETITOR_REGISTERED',
  'COMPETITOR_CHECKED_IN',
  'COMPETITOR_STATUS_CHANGED',
  'SQUAD_CREATED',
  'SQUAD_MODIFIED',
  'IMPERSONATION_STARTED',
  'IMPERSONATION_ENDED',
  'ACCOUNT_LOCKED',
  'ACCOUNT_UNLOCKED',
  'PASSWORD_CHANGED',
  'SCORE_PIN_RESET',
  'SCORE_SYNCED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const USER_ROLES = [
  'PLATFORM_SUPER_ADMIN',
  'PLATFORM_ADMIN',
  'ORGANIZATION_ADMIN',
  'MATCH_DIRECTOR',
  'RANGE_MASTER',
  'RANGE_OFFICER',
  'SCOREKEEPER',
  'COMPETITOR',
  'VIEWER',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const MATCH_ROLE_ASSIGNABLE: UserRole[] = [
  'ORGANIZATION_ADMIN',
  'MATCH_DIRECTOR',
  'RANGE_MASTER',
  'RANGE_OFFICER',
  'SCOREKEEPER',
  'COMPETITOR',
  'VIEWER',
];

export const TOURNAMENT_AGGREGATION_METHODS = ['SUM_POINTS', 'SUM_PERCENT', 'CUSTOM_WEIGHTED'] as const;
export type TournamentAggregationMethod = (typeof TOURNAMENT_AGGREGATION_METHODS)[number];

export const TIE_BREAK_METHODS = ['NONE', 'COUNT_STAGE_WINS', 'HIGHEST_STAGE_POINT', 'MOST_FIRSTS'] as const;
export type TieBreakMethod = (typeof TIE_BREAK_METHODS)[number];

export const DISPUTE_STATUSES = ['OPEN', 'ACCEPTED', 'REJECTED', 'RESOLVED'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const EXTRA_HIT_POLICIES = ['IGNORE', 'TREAT_AS_MISS', 'REQUIRE_CONFIG'] as const;
export type ExtraHitPolicy = (typeof EXTRA_HIT_POLICIES)[number];

export const GENDER_CATEGORIES = ['OVERALL', 'LADY'] as const;
export type GenderCategory = (typeof GENDER_CATEGORIES)[number];