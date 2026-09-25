import type { Db } from '../db/client.js';
import { uuid, notFound } from './utils.js';
import { audit } from './audit.js';
import { getRegistration } from './registrations.js';
import { paramsForMatch } from './scores.js';
import type { Match, PowerFactor } from '@blinkscore/core';
import { calculatePowerFactor, classifyPowerFactor, averageVelocity } from '@blinkscore/core';

export interface ChronoInput {
  registrationId: string;
  bulletWeightGrains?: number | null;
  shot1Velocity?: number | null;
  shot2Velocity?: number | null;
  shot3Velocity?: number | null;
  declaredPowerFactor: PowerFactor;
  notes?: string | null;
}

export interface ChronoOutcome {
  id: string;
  matchId: string;
  registrationId: string;
  bulletWeightGrains: number | null;
  shot1Velocity: number | null;
  shot2Velocity: number | null;
  shot3Velocity: number | null;
  averageVelocity: number | null;
  calculatedPowerFactor: number | null;
  declaredPowerFactor: PowerFactor;
  verifiedPowerFactor: PowerFactor | null;
  finalScoringFactor: PowerFactor | null;
  notes: string | null;
  recordedBy: string;
  recordedAt: string;
  warning: string | null;
}

export function recordChronograph(
  db: Db,
  match: Match,
  input: ChronoInput,
  actor: { userId: string; username: string | null },
): ChronoOutcome {
  const registration = getRegistration(db, match, input.registrationId);
  const avg =
    input.shot1Velocity !== null || input.shot2Velocity !== null || input.shot3Velocity !== null
      ? averageVelocity(input.shot1Velocity ?? null, input.shot2Velocity ?? null, input.shot3Velocity ?? null)
      : null;
  const grains = input.bulletWeightGrains ?? null;
  const calculated = grains !== null && avg !== null ? calculatePowerFactor(grains, avg) : null;

  const params = paramsForMatch(db, match);
  const configured = calculated !== null
    ? classifyPowerFactor(calculated, params.minorPowerFactorMinimum, params.majorPowerFactorMinimum)
    : null;

  const declared = input.declaredPowerFactor;
  let verified: PowerFactor | null = declared;
  let finalScoringFactor: PowerFactor | null = declared;
  let warning: string | null = null;

  if (avg === null || grains === null) {
    warning = 'Chronograph is incomplete; no power factor can be verified.';
    verified = null;
    finalScoringFactor = null;
  } else if (declared === 'MAJOR' && configured !== 'MAJOR') {
    finalScoringFactor = 'MINOR';
    warning = `Declared Major but measured ${(calculated ?? NaN).toFixed(2)} PF — scored Minor.`;
  } else if (declared === 'MAJOR' || declared === 'MINOR') {
    if (calculated !== null && calculated < params.minorPowerFactorMinimum) {
      finalScoringFactor = 'MINOR';
      warning = `Measured ${calculated.toFixed(2)} PF is below the Minor minimum (${params.minorPowerFactorMinimum}); scored Minor.`;
    } else {
      finalScoringFactor = declared;
      verified = declared;
    }
  } else {
    finalScoringFactor = 'MINOR';
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO chronograph_sessions
      (id, match_id, registration_id, organization_id, discipline, bullet_weight_grains, shot1_velocity,
       shot2_velocity, shot3_velocity, calculated_power_factor, declared_power_factor, verified_power_factor,
       final_scoring_factor, notes, recorded_by, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (match_id, registration_id, discipline) DO UPDATE SET
       bullet_weight_grains = excluded.bullet_weight_grains,
       shot1_velocity = excluded.shot1_velocity,
       shot2_velocity = excluded.shot2_velocity,
       shot3_velocity = excluded.shot3_velocity,
       calculated_power_factor = excluded.calculated_power_factor,
       declared_power_factor = excluded.declared_power_factor,
       verified_power_factor = excluded.verified_power_factor,
       final_scoring_factor = excluded.final_scoring_factor,
       notes = excluded.notes,
       recorded_at = excluded.recorded_at`,
  ).run(
    uuid(),
    match.id,
    registration.id,
    match.organizationId,
    'HANDGUN',
    grains,
    input.shot1Velocity ?? null,
    input.shot2Velocity ?? null,
    input.shot3Velocity ?? null,
    calculated,
    declared,
    verified,
    finalScoringFactor,
    input.notes ?? null,
    actor.userId,
    now,
  );

  const row = db
    .prepare('SELECT * FROM chronograph_sessions WHERE match_id = ? AND registration_id = ?')
    .get(match.id, registration.id) as Record<string, unknown>;

  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'CHRONO_COMPLETED',
    entity: 'chronograph_sessions',
    entityId: String(row.id),
    newValue: {
      registrationId: registration.id,
      calculatedPowerFactor: calculated ? Number(calculated.toFixed(2)) : null,
      finalScoringFactor,
      warning,
    },
  });

  return {
    id: String(row.id),
    matchId: String(row.match_id),
    registrationId: String(row.registration_id),
    bulletWeightGrains: grains,
    shot1Velocity: input.shot1Velocity ?? null,
    shot2Velocity: input.shot2Velocity ?? null,
    shot3Velocity: input.shot3Velocity ?? null,
    averageVelocity: avg !== null ? Number(avg.toFixed(2)) : null,
    calculatedPowerFactor: calculated !== null ? Number(calculated.toFixed(2)) : null,
    declaredPowerFactor: declared,
    verifiedPowerFactor: verified,
    finalScoringFactor,
    notes: input.notes ?? null,
    recordedBy: actor.userId,
    recordedAt: now,
    warning,
  };
}

export function listChronographSessions(db: Db, match: Match): Record<string, unknown>[] {
  const rows = db
    .prepare(
      `SELECT c.*, sh.first_name || ' ' || sh.last_name AS shooter_name
       FROM chronograph_sessions c
       JOIN match_registrations r ON r.id = c.registration_id
       JOIN shooters sh ON sh.id = r.shooter_id
       WHERE c.match_id = ?
       ORDER BY c.recorded_at DESC`,
    )
    .all(match.id) as Record<string, unknown>[];
  return rows.map((r) => ({ ...r, id: String(r.id), registrationId: String(r.registration_id) }));
}

export function chronographForRegistration(db: Db, matchId: string, registrationId: string): Record<string, unknown> {
  const row = db
    .prepare('SELECT * FROM chronograph_sessions WHERE match_id = ? AND registration_id = ?')
    .get(matchId, registrationId) as Record<string, unknown> | undefined;
  if (!row) throw notFound('No chronograph record for this competitor.');
  return row;
}