import type { Db } from '../db/client.js';
import { uuid, notFound, badRequest, conflict, forbidden, unprocessable } from './utils.js';
import { audit } from './audit.js';
import { rulesetParams } from './rulesets.js';
import { getStage, stageTargets } from './stages.js';
import { getRegistration } from './registrations.js';
import { verifyPassword } from './password.js';
import {
  buildScoringRuleParams,
  calculateStageScore,
  roundTo,
  type CalculatedStageScore,
  type ConfigIssue,
  type EngineTargetConfig,
  type Match,
  type Stage,
  type StageScoreInput,
  type TargetScoreInput,
} from '@blinkscore/core';

export interface ScoreRow {
  id: string;
  matchId: string;
  stageId: string;
  registrationId: string;
  organizationId: string;
  status: string;
  syncStatus: string;
  timeSeconds: number | null;
  hitsJson: string;
  misses: number;
  paperNoShoots: number;
  procedurals: number;
  penaltiesOther: number;
  shotsFired: number | null;
  penaltyEventsJson: string;
  targetDetailsJson: string;
  configErrorsJson: string;
  warningsJson: string;
  rawPoints: number | null;
  penaltyPoints: number | null;
  netPoints: number | null;
  hitFactor: number | null;
  finalTimeSeconds: number | null;
  timeAdjustmentsSeconds: number | null;
  syncToken: string | null;
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

export function mapScoreRow(row: Record<string, unknown>): ScoreRow {
  return {
    id: String(row.id),
    matchId: String(row.match_id),
    stageId: String(row.stage_id),
    registrationId: String(row.registration_id),
    organizationId: String(row.organization_id),
    status: String(row.status),
    syncStatus: String(row.sync_status ?? 'SYNCED'),
    timeSeconds: (row.time_seconds as number) ?? null,
    hitsJson: (row.hits_json as string) ?? '{}',
    misses: Number(row.misses ?? 0),
    paperNoShoots: Number(row.paper_no_shoots ?? 0),
    procedurals: Number(row.procedurals ?? 0),
    penaltiesOther: Number(row.penalties_other ?? 0),
    shotsFired: (row.shots_fired as number) ?? null,
    penaltyEventsJson: (row.penalty_events_json as string) ?? '[]',
    targetDetailsJson: (row.target_details_json as string) ?? '[]',
    configErrorsJson: (row.config_errors_json as string) ?? '[]',
    warningsJson: (row.warnings_json as string) ?? '[]',
    rawPoints: (row.raw_points as number) ?? null,
    penaltyPoints: (row.penalty_points as number) ?? null,
    netPoints: (row.net_points as number) ?? null,
    hitFactor: (row.hit_factor as number) ?? null,
    finalTimeSeconds: (row.final_time_seconds as number) ?? null,
    timeAdjustmentsSeconds: (row.time_adjustments_seconds as number) ?? null,
    syncToken: (row.sync_token as string) ?? null,
    version: Number(row.version ?? 1),
    enteredBy: (row.entered_by as string) ?? null,
    submittedBy: (row.submitted_by as string) ?? null,
    verifiedBy: (row.verified_by as string) ?? null,
    scoredAt: (row.scored_at as string) ?? null,
    submittedAt: (row.submitted_at as string) ?? null,
    verifiedAt: (row.verified_at as string) ?? null,
    lockedAt: (row.locked_at as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function scoreView(row: ScoreRow): Record<string, unknown> {
  return {
    id: row.id,
    matchId: row.matchId,
    stageId: row.stageId,
    registrationId: row.registrationId,
    status: row.status,
    syncStatus: row.syncStatus,
    timeSeconds: row.timeSeconds,
    scoreEntries: JSON.parse(row.hitsJson),
    misses: row.misses,
    paperNoShoots: row.paperNoShoots,
    procedurals: row.procedurals,
    penaltiesOther: row.penaltiesOther,
    shotsFired: row.shotsFired,
    penaltyEvents: JSON.parse(row.penaltyEventsJson),
    targetDetails: JSON.parse(row.targetDetailsJson),
    configErrors: JSON.parse(row.configErrorsJson),
    warnings: JSON.parse(row.warningsJson),
    rawPoints: row.rawPoints,
    penaltyPoints: row.penaltyPoints,
    netPoints: row.netPoints,
    hitFactor: row.hitFactor,
    finalTimeSeconds: row.finalTimeSeconds,
    timeAdjustmentsSeconds: row.timeAdjustmentsSeconds,
    version: row.version,
    enteredBy: row.enteredBy,
    submittedBy: row.submittedBy,
    verifiedBy: row.verifiedBy,
    scoredAt: row.scoredAt,
    submittedAt: row.submittedAt,
    verifiedAt: row.verifiedAt,
    lockedAt: row.lockedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function paramsForMatch(db: Db, match: Match) {
  return buildScoringRuleParams(rulesetParams(db, match.rulesetId));
}

function scoringFactorFor(registration: { declaredPowerFactor: string }): 'MAJOR' | 'MINOR' {
  if (registration.declaredPowerFactor === 'MAJOR') return 'MAJOR';
  return 'MINOR';
}

function engineTargetConfigs(
  targets: { id: string; targetType: string; requiredHits: number | null; scoringZones: string[] | null; noShootRelatedTargetId: string | null }[],
): EngineTargetConfig[] {
  return targets.map((t) => ({
    targetId: t.id,
    targetType: t.targetType as EngineTargetConfig['targetType'],
    requiredHits: t.requiredHits,
    scoringZones: (t.scoringZones as EngineTargetConfig['scoringZones']) ?? undefined,
    noShootRelatedTargetId: t.noShootRelatedTargetId ?? undefined,
  }));
}

export interface ComputeInput {
  timeSeconds?: number | null;
  targets?: TargetScoreInput[];
  misses?: number;
  paperNoShoots?: number;
  procedurals?: number;
  penaltiesOther?: number;
  shotsFired?: number | null;
}

export interface ComputeOutcome {
  calculation: CalculatedStageScore;
  hitFactor: number | null;
  /** PSMOC Time Scoring: penalty-adjusted final time, or null otherwise. */
  finalTimeSeconds: number | null;
}

export function computeStageScoreForRegistration(
  db: Db,
  match: Match,
  stage: Stage,
  registration: { declaredPowerFactor: string },
  input: ComputeInput,
): ComputeOutcome {
  const params = paramsForMatch(db, match);
  const targets = stageTargets(db, stage.id);
  const context = {
    scoringMethod: stage.scoringMethod,
    scoringFactor: scoringFactorFor(registration),
    loadType: stage.loadType ?? undefined,
    maximumStagePoints: stage.maximumStagePoints,
    maximumRounds: stage.maximumRounds,
    minimumRounds: stage.minimumRounds,
    stageRequiredHits: stage.requiredHits,
    fixedTimeSeconds: stage.fixedTimeSeconds,
    rulesetVersion: match.rulesetVersion,
  };
  const engineInput: StageScoreInput = {
    timeSeconds: input.timeSeconds ?? null,
    targets: engineTargetConfigs(targets),
    targetScores: input.targets ?? [],
    misses: input.misses ?? 0,
    paperNoShoots: input.paperNoShoots ?? 0,
    procedurals: input.procedurals ?? 0,
    penaltiesOther: input.penaltiesOther ?? 0,
    shotsFired: input.shotsFired ?? null,
  };
  const calculation = calculateStageScore({ context, input: engineInput, params });
  const hitFactor =
    calculation.valid && calculation.hitFactor !== null
      ? roundTo(calculation.hitFactor, params.precisionHitFactor)
      : null;
  const finalTimeSeconds =
    calculation.valid && calculation.finalTimeSeconds !== null
      ? roundTo(calculation.finalTimeSeconds, params.precisionTime)
      : null;
  return { calculation, hitFactor, finalTimeSeconds };
}

export interface EnterScoreInput extends ComputeInput {
  registrationId: string;
  stageId: string;
  status?: 'DRAFT' | 'SUBMITTED';
  syncToken?: string;
  /** 4-digit PIN entered by the shooter on an interactive submit to confirm the score. */
  confirmPin?: string;
}

export function getScore(db: Db, match: Match, scoreId: string): ScoreRow {
  const row = db
    .prepare('SELECT * FROM scores WHERE id = ? AND match_id = ?')
    .get(scoreId, match.id) as Record<string, unknown> | undefined;
  if (!row) throw notFound('Score not found.');
  return mapScoreRow(row);
}

export function getScoreBySlice(db: Db, matchId: string, stageId: string, registrationId: string): ScoreRow | null {
  const row = db
    .prepare('SELECT * FROM scores WHERE match_id = ? AND stage_id = ? AND registration_id = ?')
    .get(matchId, stageId, registrationId) as Record<string, unknown> | undefined;
  return row ? mapScoreRow(row) : null;
}

function isFinished(match: Match): boolean {
  return ['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(match.status);
}

function assertEditable(match: Match, score: ScoreRow): void {
  if (['VERIFIED', 'LOCKED', 'CORRECTED'].includes(score.status)) {
    throw conflict('SCORE_LOCKED', `This score is ${score.status} and may only be changed via a formal correction.`);
  }
  if (isFinished(match)) {
    throw conflict('MATCH_FINISHED', 'Scores cannot be entered or edited after the match is completed.');
  }
}

export interface EnterOutcome {
  score: ScoreRow;
  hitFactor: number | null;
  finalTimeSeconds: number | null;
  valid: boolean;
  configErrors: ConfigIssue[];
  warnings: string[];
}

export function enterScore(
  db: Db,
  match: Match,
  input: EnterScoreInput,
  actor: { userId: string; username: string | null },
  opts: { asCorrection?: boolean } = {},
): EnterOutcome {
  const stage = getStage(db, match, input.stageId);
  const registration = getRegistration(db, match, input.registrationId);
  if (['DQ', 'DNS', 'DNF', 'WITHDRAWN'].includes(registration.status)) {
    throw conflict('COMPETITOR_NOT_SCORABLE', 'This competitor cannot be scored (status DQ/DNS/DNF/WITHDRAWN).');
  }

  let existing: ScoreRow | null = null;
  if (input.syncToken) {
    const tok = db
      .prepare('SELECT * FROM scores WHERE match_id = ? AND sync_token = ?')
      .get(match.id, input.syncToken) as Record<string, unknown> | undefined;
    if (tok) existing = mapScoreRow(tok);
  }
  if (!existing) existing = getScoreBySlice(db, match.id, input.stageId, input.registrationId);
  if (existing && !opts.asCorrection) assertEditable(match, existing);

  const status = input.status ?? 'DRAFT';
  if (status === 'SUBMITTED' && !opts.asCorrection && !input.syncToken) {
    const pin = db
      .prepare('SELECT score_pin_hash FROM match_registrations WHERE id = ?')
      .get(registration.id) as { score_pin_hash: string | null };
    if (!pin.score_pin_hash) {
      throw badRequest('SCORE_PIN_NOT_SET', 'This competitor has no verification PIN set at registration. Contact the match organizer before submitting.');
    }
    if (!input.confirmPin || !verifyPassword(input.confirmPin, pin.score_pin_hash)) {
      throw forbidden('SCORE_PIN_MISMATCH', "The verification PIN does not match the shooter's PIN.");
    }
  }

  const outcome = computeStageScoreForRegistration(db, match, stage, registration, input);
  const capError = outcome.calculation.configErrors.find((e) =>
    e.code === 'TARGET_HITS_EXCEEDED' ||
    e.code === 'TARGET_POINTS_EXCEEDED' ||
    e.code === 'STAGE_POINTS_EXCEEDED' ||
    e.code === 'ZONE_NOT_RECORDABLE',
  );
  if (capError) {
    throw unprocessable(capError.code, `${capError.message} No score was saved — correct the entry and resubmit.`);
  }
  const now = new Date().toISOString();
  const byTarget = new Map(outcome.calculation.targetDetails.map((t) => [t.targetId, t]));
  const hitsJson = JSON.stringify(
    (input.targets ?? []).map((t) => ({
      targetId: t.targetId,
      zoneHits: t.zoneHits ?? [],
      hits: t.hits,
      steelMisses: t.steelMisses,
      noShootHits: t.noShootHits,
      detail: byTarget.get(t.targetId) ?? null,
    })),
  );
  const penaltyEventsJson = JSON.stringify(outcome.calculation.penaltyEvents);
  const targetDetailsJson = JSON.stringify(outcome.calculation.targetDetails);
  const configErrorsJson = JSON.stringify(outcome.calculation.configErrors);
  const warningsJson = JSON.stringify(outcome.calculation.warnings);
  const version = (existing?.version ?? 0) + 1;

  const base = {
    status,
    time_seconds: input.timeSeconds ?? null,
    hits_json: hitsJson,
    misses: outcome.calculation.misses,
    paper_no_shoots: input.paperNoShoots ?? 0,
    procedurals: input.procedurals ?? 0,
    penalties_other: input.penaltiesOther ?? 0,
    shots_fired: input.shotsFired ?? null,
    penalty_events_json: penaltyEventsJson,
    target_details_json: targetDetailsJson,
    config_errors_json: configErrorsJson,
    warnings_json: warningsJson,
    raw_points: outcome.calculation.rawPoints,
    penalty_points: outcome.calculation.penaltyPoints,
    net_points: outcome.calculation.netPoints,
    hit_factor: outcome.hitFactor,
    final_time_seconds: outcome.finalTimeSeconds,
    time_adjustments_seconds: outcome.calculation.timeAdjustmentsSeconds,
  };

  if (existing) {
    db.prepare(
      `UPDATE scores SET sync_status='SYNCED', status=?, sync_token=?, version=?, time_seconds=?, hits_json=?,
         misses=?, paper_no_shoots=?, procedurals=?, penalties_other=?, shots_fired=?, penalty_events_json=?,
         target_details_json=?, config_errors_json=?, warnings_json=?, raw_points=?, penalty_points=?,
         net_points=?, hit_factor=?, final_time_seconds=?, time_adjustments_seconds=?, submitted_by=?,
         submitted_at=?, last_modified_by=?, updated_at=?
       WHERE id=?`,
    ).run(
      status,
      input.syncToken ?? existing.syncToken,
      version,
      base.time_seconds,
      base.hits_json,
      base.misses,
      base.paper_no_shoots,
      base.procedurals,
      base.penalties_other,
      base.shots_fired,
      base.penalty_events_json,
      base.target_details_json,
      base.config_errors_json,
      base.warnings_json,
      base.raw_points,
      base.penalty_points,
      base.net_points,
      base.hit_factor,
      base.final_time_seconds,
      base.time_adjustments_seconds,
      status === 'SUBMITTED' ? actor.userId : existing.submittedBy,
      status === 'SUBMITTED' ? now : existing.submittedAt,
      actor.userId,
      now,
      existing.id,
    );
  } else {
    db.prepare(
      `INSERT INTO scores
        (id, match_id, stage_id, registration_id, organization_id, status, sync_status, time_seconds, hits_json,
         misses, paper_no_shoots, procedurals, penalties_other, shots_fired, penalty_events_json,
         target_details_json, config_errors_json, warnings_json, raw_points, penalty_points, net_points,
         hit_factor, final_time_seconds, time_adjustments_seconds, sync_token, version, entered_by, submitted_by,
         scored_at, submitted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'SYNCED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      uuid(),
      match.id,
      input.stageId,
      input.registrationId,
      match.organizationId,
      status,
      base.time_seconds,
      base.hits_json,
      base.misses,
      base.paper_no_shoots,
      base.procedurals,
      base.penalties_other,
      base.shots_fired,
      base.penalty_events_json,
      base.target_details_json,
      base.config_errors_json,
      base.warnings_json,
      base.raw_points,
      base.penalty_points,
      base.net_points,
      base.hit_factor,
      base.final_time_seconds,
      base.time_adjustments_seconds,
      input.syncToken ?? null,
      version,
      actor.userId,
      status === 'SUBMITTED' ? actor.userId : null,
      now,
      status === 'SUBMITTED' ? now : null,
      now,
      now,
    );
  }

  const saved = getScoreBySlice(db, match.id, input.stageId, input.registrationId);
  if (!saved) throw new Error('Score was not persisted.');
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: status === 'SUBMITTED' ? 'SCORE_SUBMITTED' : 'SCORE_ENTERED',
    entity: 'scores',
    entityId: input.syncToken ?? saved.id,
    newValue: {
      stageId: input.stageId,
      registrationId: input.registrationId,
      timeSeconds: input.timeSeconds,
      misses: input.misses ?? 0,
      paperNoShoots: input.paperNoShoots ?? 0,
      procedurals: input.procedurals ?? 0,
      penaltiesOther: input.penaltiesOther ?? 0,
    },
  });
  return {
    score: saved,
    hitFactor: outcome.hitFactor,
    finalTimeSeconds: outcome.finalTimeSeconds,
    valid: outcome.calculation.valid,
    configErrors: outcome.calculation.configErrors,
    warnings: outcome.calculation.warnings,
  };
}

export interface ScoreWithCompetitor extends ScoreRow {
  shooterName: string;
  divisionId: string | null;
  competitorStatus: string;
  divisionName: string | null;
  fraction: number | null;
}

export function listScores(
  db: Db,
  match: Match,
  opts: { stageId?: string; registrationId?: string; status?: string } = {},
): ScoreWithCompetitor[] {
  const where = ['s.match_id = @matchId'];
  const params: Record<string, unknown> = { matchId: match.id };
  if (opts.stageId) {
    where.push('s.stage_id = @stageId');
    params.stageId = opts.stageId;
  }
  if (opts.registrationId) {
    where.push('s.registration_id = @registrationId');
    params.registrationId = opts.registrationId;
  }
  if (opts.status) {
    where.push('s.status = @status');
    params.status = opts.status;
  }
  const rows = db
    .prepare(
      `SELECT s.*, r.status AS competitor_status, r.division_id AS division_id,
              sh.first_name || ' ' || sh.last_name AS shooter_name, d.name AS division_name
       FROM scores s
       JOIN match_registrations r ON r.id = s.registration_id
       JOIN shooters sh ON sh.id = r.shooter_id
       LEFT JOIN divisions d ON d.id = r.division_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.created_at DESC LIMIT 5000`,
    )
    .all(params) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...mapScoreRow(r),
    shooterName: String(r.shooter_name),
    divisionId: (r.division_id as string) ?? null,
    competitorStatus: String(r.competitor_status),
    divisionName: (r.division_name as string) ?? null,
    fraction: null,
  }));
}

const WORKFLOW_ACTIONS = ['VERIFY', 'LOCK', 'UNLOCK', 'REJECT'] as const;
export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

export function workflowScore(
  db: Db,
  match: Match,
  score: ScoreRow,
  action: WorkflowAction,
  actor: { userId: string; username: string | null },
  reason?: string,
): ScoreRow {
  const now = new Date().toISOString();
  const prev = score.status;
  switch (action) {
    case 'VERIFY':
      if (!['DRAFT', 'SUBMITTED', 'DISPUTED'].includes(score.status)) throw conflict('SCORE_NOT_VERIFIABLE', `Cannot verify a ${score.status} score.`);
      if (score.hitFactor === null && score.finalTimeSeconds === null) throw badRequest('SCORE_INVALID', 'This score has no valid result (check time and hits) and cannot be verified.');
      db.prepare("UPDATE scores SET status='VERIFIED', verified_by=?, verified_at=?, updated_at=? WHERE id=?").run(actor.userId, now, now, score.id);
      break;
    case 'LOCK':
      if (score.status !== 'VERIFIED') throw conflict('SCORE_NOT_LOCKABLE', 'Only verified scores can be locked.');
      db.prepare("UPDATE scores SET status='LOCKED', verified_by=?, verified_at=?, locked_at=?, updated_at=? WHERE id=?").run(actor.userId, score.verifiedAt ?? now, now, now, score.id);
      break;
    case 'UNLOCK':
      if (!['LOCKED', 'VERIFIED'].includes(score.status)) throw conflict('SCORE_NOT_UNLOCKABLE', 'Only locked or verified scores can be unlocked.');
      db.prepare("UPDATE scores SET status='VERIFIED', updated_at=? WHERE id=?").run(now, score.id);
      break;
    case 'REJECT':
      if (score.status !== 'SUBMITTED') throw conflict('SCORE_NOT_REJECTABLE', 'Only submitted scores can be rejected back to draft.');
      db.prepare("UPDATE scores SET status='DRAFT', updated_at=? WHERE id=?").run(now, score.id);
      break;
  }
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: action === 'UNLOCK' ? 'SCORE_UNLOCKED' : action === 'REJECT' ? 'SCORE_REJECTED' : action === 'LOCK' ? 'SCORE_LOCKED' : 'SCORE_VERIFIED',
    entity: 'scores',
    entityId: score.id,
    oldValue: prev,
    newValue: action,
    ...(reason ? { newValue2: reason } : {}),
  });
  return getScore(db, match, score.id);
}

export function applyCorrection(
  db: Db,
  match: Match,
  score: ScoreRow,
  correction: { field: string; previousValue: string | null; newValue: string; reason: string; authorization: string },
  actor: { userId: string; username: string | null },
  opts: { platformAuthority?: boolean } = {},
): { score: ScoreRow; correctionId: string } {
  if (score.status === 'DRAFT') {
    throw badRequest('SCORE_NOT_FINAL', 'A draft score is edited directly; corrections apply to verified, locked or disputed scores.');
  }
  const authorizedRoles = ['match.director', 'match.rangeMaster', 'org.admin', 'admin'];
  const platformRoles = ['platform.admin', 'platform.superAdmin'];
  const authorizedViaPlatform = opts.platformAuthority && platformRoles.includes(correction.authorization);
  if (!authorizedRoles.includes(correction.authorization) && !authorizedViaPlatform) {
    throw forbidden('CORRECTION_NOT_AUTHORIZED', 'Corrections must be authorized by the Match Director, Range Master or an administrator.');
  }

  const next: ComputeInput = {};
  let previousValue = correction.previousValue;
  switch (correction.field) {
    case 'timeSeconds':
      next.timeSeconds = Number(correction.newValue);
      break;
    case 'targets':
      next.targets = JSON.parse(correction.newValue) as TargetScoreInput[];
      break;
    case 'misses':
      next.misses = Number(correction.newValue);
      break;
    case 'paperNoShoots':
      next.paperNoShoots = Number(correction.newValue);
      break;
    case 'procedurals':
      next.procedurals = Number(correction.newValue);
      break;
    case 'penaltiesOther':
      next.penaltiesOther = Number(correction.newValue);
      break;
    case 'shotsFired':
      next.shotsFired = Number(correction.newValue);
      break;
    case 'scorecard': {
      const payload = JSON.parse(correction.newValue) as ComputeInput;
      previousValue = JSON.stringify({
        targets: JSON.parse(score.hitsJson),
        timeSeconds: score.timeSeconds,
        misses: score.misses,
        paperNoShoots: score.paperNoShoots,
        procedurals: score.procedurals,
        penaltiesOther: score.penaltiesOther,
        shotsFired: score.shotsFired,
      });
      next.targets = payload.targets ?? [];
      next.timeSeconds = payload.timeSeconds ?? null;
      next.misses = payload.misses ?? 0;
      next.paperNoShoots = payload.paperNoShoots ?? 0;
      next.procedurals = payload.procedurals ?? 0;
      next.penaltiesOther = payload.penaltiesOther ?? 0;
      next.shotsFired = payload.shotsFired ?? null;
      break;
    }
    default:
      throw badRequest('UNKNOWN_FIELD', `Unsupported correction field "${correction.field}".`);
  }
  const currentRaw = JSON.parse(score.hitsJson) as TargetScoreInput[];
  const entry = enterScore(
    db,
    match,
    {
      ...next,
      targets: next.targets ?? currentRaw,
      timeSeconds: next.timeSeconds ?? score.timeSeconds,
      misses: next.misses ?? score.misses,
      paperNoShoots: next.paperNoShoots ?? score.paperNoShoots,
      procedurals: next.procedurals ?? score.procedurals,
      penaltiesOther: next.penaltiesOther ?? score.penaltiesOther,
      shotsFired: next.shotsFired ?? score.shotsFired ?? null,
      stageId: score.stageId,
      registrationId: score.registrationId,
      status: 'SUBMITTED',
      syncToken: `${score.id}-${correction.field}-${Date.now()}`,
    },
    actor,
    { asCorrection: true },
  );
  const now = new Date().toISOString();
  db.prepare("UPDATE scores SET status='CORRECTED', updated_at=?, last_modified_by=? WHERE id=?").run(now, actor.userId, entry.score.id);
  const correctionId = uuid();
  db.prepare(
    'INSERT INTO score_corrections (id, score_id, field, previous_value, new_value, reason, authorized_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    correctionId,
    entry.score.id,
    correction.field,
    previousValue,
    correction.newValue,
    correction.reason,
    correction.authorization,
    now,
  );
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'SCORE_CORRECTED',
    entity: 'scores',
    entityId: entry.score.id,
    oldValue: { field: correction.field, previousValue: correction.previousValue },
    newValue: { field: correction.field, newValue: correction.newValue, authorization: correction.authorization, reason: correction.reason },
  });
  return { score: getScore(db, match, entry.score.id), correctionId };
}

export function openDispute(
  db: Db,
  match: Match,
  score: ScoreRow,
  input: { reason: string; comment?: string | null; attachmentUrl?: string | null },
  actor: { userId: string; username: string | null },
): string {
  if (score.status === 'LOCKED') throw conflict('SCORE_LOCKED', 'A locked score cannot be disputed; raise it with the Match Director.');
  const existing = db.prepare('SELECT id FROM disputes WHERE score_id = ? AND status = ?').get(score.id, 'OPEN');
  if (existing) throw conflict('DISPUTE_OPEN', 'A dispute is already open for this score.');
  const now = new Date().toISOString();
  const disputeId = uuid();
  db.prepare(
    'INSERT INTO disputes (id, score_id, registration_id, match_id, stage_id, organization_id, reason, comment, attachment_url, status, opened_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    disputeId,
    score.id,
    score.registrationId,
    match.id,
    score.stageId,
    match.organizationId,
    input.reason,
    input.comment ?? null,
    input.attachmentUrl ?? null,
    'OPEN',
    actor.userId,
    now,
    now,
  );
  db.prepare("UPDATE scores SET status='DISPUTED', updated_at=? WHERE id=?").run(now, score.id);
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'DISPUTE_CREATED',
    entity: 'disputes',
    entityId: disputeId,
    newValue: { scoreId: score.id, reason: input.reason },
  });
  return disputeId;
}

export interface DisputeView {
  id: string;
  scoreId: string;
  registrationId: string;
  stageId: string;
  reason: string;
  comment: string | null;
  attachmentUrl: string | null;
  status: string;
  openedBy: string;
  resolvedBy: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  shooterName: string;
  stageName: string;
}

export function listDisputes(db: Db, match: Match): DisputeView[] {
  const rows = db
    .prepare(
      `SELECT d.*, sh.first_name || ' ' || sh.last_name AS shooter_name, s.name AS stage_name
       FROM disputes d
       JOIN match_registrations r ON r.id = d.registration_id
       JOIN shooters sh ON sh.id = r.shooter_id
       JOIN stages s ON s.id = d.stage_id
       WHERE d.match_id = ?
       ORDER BY d.created_at DESC`,
    )
    .all(match.id) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    scoreId: String(r.score_id),
    registrationId: String(r.registration_id),
    stageId: String(r.stage_id),
    reason: String(r.reason),
    comment: (r.comment as string) ?? null,
    attachmentUrl: (r.attachment_url as string) ?? null,
    status: String(r.status),
    openedBy: String(r.opened_by),
    resolvedBy: (r.resolved_by as string) ?? null,
    resolution: (r.resolution as string) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    shooterName: String(r.shooter_name),
    stageName: String(r.stage_name),
  }));
}

export function resolveDispute(
  db: Db,
  match: Match,
  disputeId: string,
  decision: 'ACCEPT' | 'REJECT',
  resolution: string,
  actor: { userId: string; username: string | null },
): { id: string; decision: string; resolution: string; scoreId: string } {
  const row = db
    .prepare('SELECT * FROM disputes WHERE id = ? AND match_id = ?')
    .get(disputeId, match.id) as Record<string, unknown> | undefined;
  if (!row) throw notFound('Dispute not found.');
  if (String(row.status) !== 'OPEN') throw conflict('DISPUTE_CLOSED', 'This dispute is already resolved.');
  const score = getScore(db, match, String(row.score_id));
  const now = new Date().toISOString();
  db.prepare("UPDATE disputes SET status='RESOLVED', resolved_by=?, resolution=?, updated_at=? WHERE id=?").run(actor.userId, resolution, now, disputeId);
  // Return to SUBMITTED so the dispute decision can be followed by a correction
  // (ACCEPT) or a re-verification (REJECT) without loosing audit history.
  db.prepare("UPDATE scores SET status='SUBMITTED', updated_at=? WHERE id=?").run(now, score.id);
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'DISPUTE_RESOLVED',
    entity: 'disputes',
    entityId: disputeId,
    oldValue: 'OPEN',
    newValue: { decision, resolution },
  });
  return { id: disputeId, decision, resolution, scoreId: score.id };
}

export function syncBatch(
  db: Db,
  match: Match,
  entries: EnterScoreInput[],
  actor: { userId: string; username: string | null },
): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  for (const entry of entries) {
    try {
      const out = enterScore(db, match, entry, actor);
      results.push({
        token: entry.syncToken ?? null,
        ok: true,
        scoreId: out.score.id,
        hitFactor: out.hitFactor,
        status: out.score.status,
        valid: out.valid,
        warnings: out.warnings,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ token: entry.syncToken ?? null, ok: false, error: msg });
    }
  }
  return results;
}