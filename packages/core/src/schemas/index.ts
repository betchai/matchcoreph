import { z } from 'zod';
import {
  COMPETITOR_STATUSES,
  DISCIPLINES,
  LOAD_TYPES,
  MATCH_LEVELS,
  MATCH_TYPES,
  POWER_FACTORS,
  SANCTIONING_STATUSES,
  SCORING_METHODS,
  SCORING_ZONES,
  SYNC_STATUSES,
  TARGET_TYPES,
  USER_ROLES,
} from '../domain/enums.js';

export const idSchema = z.string().min(1).max(64);
export const optionalId = z.string().min(1).max(64).nullable().optional();

export const matchLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const loginSchema = z.object({
  usernameOrEmail: z.string().min(1),
  password: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export const organizationCreateSchema = z.object({
  name: z.string().min(1).max(200),
  shortName: z.string().min(1).max(40),
  logoUrl: z.string().url().nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  province: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  website: z.string().url().nullable().optional(),
});

export const organizationUpdateSchema = organizationCreateSchema.partial();

export const userCreateSchema = z.object({
  username: z.string().min(3).max(60).regex(/^[a-zA-Z0-9._-]+$/),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().max(120).nullable().optional(),
  role: z.enum(USER_ROLES),
  organizationId: z.string().min(1).nullable().optional(),
});

export const orgUserInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(USER_ROLES),
  organizationId: z.string().min(1).nullable().optional(),
  password: z.string().min(8).optional(),
});

export const shooterCreateSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  nickname: z.string().max(100).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  homeClub: z.string().max(200).nullable().optional(),
  ppsaMembershipNumber: z.string().max(60).nullable().optional(),
  ipscAlias: z.string().max(60).nullable().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']).nullable().optional(),
  birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
});

export const matchStep1Schema = z.object({
  name: z.string().min(1).max(200),
  matchType: z.enum(MATCH_TYPES),
  startDate: z.string().min(1),
  startTime: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  venue: z.string().max(300).nullable().optional(),
  matchDirectorUserId: z.string().nullable().optional(),
  rangeMasterUserId: z.string().nullable().optional(),
  matchLevel: matchLevelSchema,
  sanctioningStatus: z.enum(SANCTIONING_STATUSES).default('CLUB'),
});

export const matchRulesetSchema = z.object({
  rulesetId: z.string().min(1),
});

export const matchDisciplinesSchema = z.object({
  disciplines: z.array(z.enum(DISCIPLINES)).min(1),
});

export const matchDivisionsCategoriesSchema = z.object({
  divisionIds: z.array(z.string().min(1)).min(1),
  categoryIds: z.array(z.string().min(1)),
});

export const stageCreateSchema = z.object({
  number: z.number().int().positive(),
  name: z.string().min(1).max(200),
  courseType: z.enum(['SHORT', 'MEDIUM', 'LONG', 'CLASSIFIER']),
  scoringMethod: z.enum(SCORING_METHODS),
  loadType: z.enum(LOAD_TYPES).nullable().optional(),
  minimumRounds: z.number().int().min(0).nullable().optional(),
  maximumRounds: z.number().int().min(0).nullable().optional(),
  requiredHits: z.number().int().min(1).nullable().optional(),
  maximumStagePoints: z.number().positive(),
  fixedTimeSeconds: z.number().positive().nullable().optional(),
  classifierDesignation: z.string().max(60).nullable().optional(),
  startPosition: z.string().max(500).nullable().optional(),
  startCondition: z.string().max(500).nullable().optional(),
  firearmCondition: z.string().max(500).nullable().optional(),
  procedure: z.string().max(2000).nullable().optional(),
  briefing: z.string().max(2000).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  diagramUrl: z.string().max(500).nullable().optional(),
});

export const stageTargetSchema = z.object({
  number: z.number().int().positive(),
  name: z.string().max(100).nullable().optional(),
  targetType: z.enum(TARGET_TYPES),
  requiredHits: z.number().int().min(1).nullable().optional(),
  scoringZones: z.array(z.enum(SCORING_ZONES)).optional(),
  noShootRelatedTargetId: z.string().nullable().optional(),
  maxPoints: z.number().nonnegative().nullable().optional(),
});

export const stageTargetsSchema = z.object({
  targets: z.array(stageTargetSchema),
});

export const squadCreateSchema = z.object({
  name: z.string().min(1).max(100),
  stageNumber: z.number().int().positive().nullable().optional(),
});

export const registrationSchema = z.object({
  shooterId: z.string().min(1),
  divisionId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  declaredPowerFactor: z.enum(POWER_FACTORS).default('MINOR'),
  squadId: z.string().nullable().optional(),
  matchNumber: z.string().max(40).nullable().optional(),
  status: z.enum(COMPETITOR_STATUSES).default('REGISTERED'),
  scorePin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
});

export const registrationsBulkSchema = z.object({
  registrations: z.array(registrationSchema).min(1),
});

const targetResultSchema = z.object({
  targetId: z.string().min(1),
  zoneHits: z.array(z.enum(SCORING_ZONES)).optional(),
  hits: z.number().int().min(0).optional(),
  steelMisses: z.number().int().min(0).optional(),
  noShootHits: z.number().int().min(0).optional(),
});

export const scoreEntrySchema = z.object({
  matchId: z.string().min(1),
  stageId: z.string().min(1),
  registrationId: z.string().min(1),
  timeSeconds: z.number().nonnegative().nullable().optional(),
  targets: z.array(targetResultSchema).default([]),
  misses: z.number().int().min(0).default(0),
  paperNoShoots: z.number().int().min(0).default(0),
  procedurals: z.number().int().min(0).default(0),
  penaltiesOther: z.number().int().min(0).default(0),
  shotsFired: z.number().int().min(0).nullable().optional(),
  status: z.enum(['DRAFT', 'SUBMITTED']).default('DRAFT'),
  syncToken: z.string().max(64).optional(),
});

export const onlineScoreEntrySchema = scoreEntrySchema.omit({ matchId: true });

export const scoreSubmitSchema = scoreEntrySchema.extend({
  confirmPin: z.string().regex(/^\d{4}$/).optional(),
});

export const scoreVerifySchema = z.object({
  action: z.enum(['VERIFY', 'LOCK', 'UNLOCK', 'REJECT']),
  reason: z.string().max(500).optional(),
});

export const scoreCorrectionSchema = z.object({
  field: z.string().min(1).max(80),
  previousValue: z.string().max(500).nullable().optional(),
  newValue: z.string().max(8000).min(1),
  reason: z.string().min(1).max(1000),
  authorization: z.string().min(1).max(300),
});

export const disputeOpenSchema = z.object({
  reason: z.string().min(1).max(2000),
  comment: z.string().max(5000).nullable().optional(),
  attachmentUrl: z.string().max(500).nullable().optional(),
});

export const disputeResolveSchema = z.object({
  decision: z.enum(['ACCEPT', 'REJECT']),
  resolution: z.string().max(3000),
});

export const statusChangeSchema = z.object({
  status: z.enum(COMPETITOR_STATUSES),
  reason: z.string().max(1000).optional(),
});

export const rulesetCreateSchema = z.object({
  organizationId: z.string().nullable().optional(),
  name: z.string().min(1).max(200),
  organizationCode: z.string().min(1).max(20),
  discipline: z.enum(DISCIPLINES),
  version: z.string().min(1).max(60),
  effectiveDate: z.string().min(1),
  description: z.string().max(2000).nullable().optional(),
  sourceCitation: z.string().max(1000).nullable().optional(),
  parameters: z.array(z.object({ key: z.string().min(1), value: z.string() })).optional(),
});

export const rulesetDuplicateSchema = z.object({
  version: z.string().min(1).max(60),
  effectiveDate: z.string().min(1),
});

export const rulesetUpdateParamsSchema = z.object({
  parameters: z.array(z.object({ key: z.string().min(1), value: z.string() })).min(1),
});

export const csvImportSchema = z.object({
  rows: z
    .array(
      z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        club: z.string().optional(),
        divisionCode: z.string().optional(),
        categoryCode: z.string().optional(),
        email: z.string().email().optional(),
        membershipNumber: z.string().optional(),
      }),
    )
    .min(1),
});

export const tournamentComponentSchema = z.object({
  componentMatchId: z.string().min(1),
  weight: z.number().positive().default(1),
});

export const tournamentAggregateSchema = z.object({
  aggregateMethod: z.enum(['SUM_POINTS', 'SUM_PERCENT', 'CUSTOM_WEIGHTED']),
  components: z.array(tournamentComponentSchema),
});

export const competitorStatusBatchSchema = z.object({
  registrations: z.array(
    z.object({
      registrationId: z.string().min(1),
      status: z.enum(COMPETITOR_STATUSES),
      reason: z.string().max(1000).optional(),
    }),
  ),
});

export const syncBatchSchema = z.object({
  scores: z.array(onlineScoreEntrySchema),
});

export const checkinSchema = z.object({
  registrationId: z.string().min(1),
  squadId: z.string().nullable().optional(),
});

export const chronographSchema = z.object({
  registrationId: z.string().min(1),
  bulletWeightGrains: z.number().positive().nullable().optional(),
  shot1Velocity: z.number().positive().nullable().optional(),
  shot2Velocity: z.number().positive().nullable().optional(),
  shot3Velocity: z.number().positive().nullable().optional(),
  declaredPowerFactor: z.enum(POWER_FACTORS),
  notes: z.string().max(1000).nullable().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type ShooterCreateInput = z.infer<typeof shooterCreateSchema>;
export type MatchStep1Input = z.infer<typeof matchStep1Schema>;
export type StageCreateInput = z.infer<typeof stageCreateSchema>;
export type StageTargetInput = z.infer<typeof stageTargetSchema>;
export type ScoreEntryInput = z.infer<typeof scoreEntrySchema>;
export type OnlineScoreEntryInput = z.infer<typeof onlineScoreEntrySchema>;
export type RegistrationInput = z.infer<typeof registrationSchema>;
export type RulesetCreateInput = z.infer<typeof rulesetCreateSchema>;