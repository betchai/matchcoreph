import type { Db } from '../db/client.js';
import { uuid, notFound, badRequest, conflict } from './utils.js';
import { audit } from './audit.js';
import { divisionById, categoryById } from './rulesets.js';
import { shooterById } from './shooters.js';
import { hashPassword } from './password.js';
import type { CompetitorStatus, Match, MatchRegistration, PaymentMode } from '@blinkscore/core';
import { COMPETITOR_STATUSES } from '@blinkscore/core';

export function mapRegistration(row: Record<string, unknown>): MatchRegistration {
  return {
    id: String(row.id),
    matchId: String(row.match_id),
    organizationId: String(row.organization_id),
    shooterId: String(row.shooter_id),
    shooterNumber: String(row.shooter_number),
    divisionId: (row.division_id as string) ?? null,
    categoryId: (row.category_id as string) ?? null,
    declaredPowerFactor: row.declared_power_factor as MatchRegistration['declaredPowerFactor'],
    squadId: (row.squad_id as string) ?? null,
    status: row.status as CompetitorStatus,
    matchNumber: (row.match_number as string) ?? null,
    notes: (row.notes as string) ?? null,
    registeredAt: String(row.registered_at),
    updatedAt: String(row.updated_at),
    hasScorePin: Boolean(row.score_pin_hash),
    paid: Boolean(row.paid),
    paymentMode: (row.payment_mode as PaymentMode | null) ?? null,
  };
}

export function getRegistration(db: Db, match: Match, registrationId: string): MatchRegistration {
  const row = db
    .prepare('SELECT * FROM match_registrations WHERE id = ? AND match_id = ?')
    .get(registrationId, match.id) as Record<string, unknown> | undefined;
  if (!row) throw notFound('Competitor registration not found.');
  return mapRegistration(row);
}

export function registerCompetitor(
  db: Db,
  match: Match,
  input: {
    shooterId: string;
    divisionId?: string | null;
    categoryId?: string | null;
    declaredPowerFactor?: string;
    squadId?: string | null;
    matchNumber?: string | null;
    scorePin?: string | null;
    paid?: boolean;
    paymentMode?: string | null;
  },
  actor: { userId: string; username: string | null },
): MatchRegistration {
  const dup = db
    .prepare('SELECT id FROM match_registrations WHERE match_id = ? AND shooter_id = ?')
    .get(match.id, input.shooterId);
  if (dup) throw conflict('ALREADY_REGISTERED', 'This shooter is already registered for the match.');

  const shooter = shooterById(db, input.shooterId);

  let powerFactor = (input.declaredPowerFactor ?? 'MINOR') as MatchRegistration['declaredPowerFactor'];
  if (input.divisionId) {
    const div = divisionById(db, input.divisionId);
    const divInMatch = db
      .prepare('SELECT id FROM match_divisions WHERE match_id = ? AND division_id = ?')
      .get(match.id, input.divisionId);
    if (!divInMatch) throw badRequest('DIVISION_NOT_IN_MATCH', `Division "${div.name}" is not enabled for this match.`);
    if (powerFactor === 'MAJOR' && !div.majorAllowed) {
      throw badRequest(
        'DIVISION_NO_MAJOR',
        `Division "${div.name}" does not allow Major power factor under the active ruleset (${match.rulesetVersion}).`,
      );
    }
    if ((powerFactor === 'MINOR' || powerFactor === 'MAJOR') && !div.majorAllowed && !div.minorPowerFactor) {
      throw badRequest('DIVISION_NO_PF', `Division "${div.name}" does not declare any power factor for scoring.`);
    }
  }
  if (input.categoryId) {
    const catInMatch = db
      .prepare('SELECT id FROM match_categories WHERE match_id = ? AND category_id = ?')
      .get(match.id, input.categoryId);
    if (!catInMatch) throw badRequest('CATEGORY_NOT_IN_MATCH', 'This category is not enabled for the match.');
  }

  const id = uuid();
  const now = new Date().toISOString();
  const pinHash = hashPassword(input.scorePin ?? '0000');
  const paymentMode = input.paid ? (input.paymentMode ?? 'CASH') : (input.paymentMode ?? null);
  db.prepare(
    `INSERT INTO match_registrations
      (id, match_id, organization_id, shooter_id, shooter_number, division_id, category_id, declared_power_factor, squad_id, status, match_number, notes, score_pin_hash, paid, payment_mode, registered_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'REGISTERED', ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    match.id,
    match.organizationId,
    shooter.id,
    shooter.shooterNumber,
    input.divisionId ?? null,
    input.categoryId ?? null,
    powerFactor,
    input.squadId ?? null,
    input.matchNumber ?? null,
    pinHash,
    input.paid ? 1 : 0,
    paymentMode,
    now,
    now,
  );
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'COMPETITOR_REGISTERED',
    entity: 'match_registrations',
    entityId: id,
    newValue: { shooterId: shooter.id, divisionId: input.divisionId, squadId: input.squadId },
  });
  return getRegistration(db, match, id);
}

export function listRegistrations(
  db: Db,
  match: Match,
  filters: { divisionId?: string; squadId?: string; status?: string; search?: string } = {},
): Record<string, unknown>[] {
  const where = ['r.match_id = @matchId'];
  const params: Record<string, unknown> = { matchId: match.id };
  if (filters.divisionId) {
    where.push('r.division_id = @divisionId');
    params.divisionId = filters.divisionId;
  }
  if (filters.squadId) {
    where.push('r.squad_id = @squadId');
    params.squadId = filters.squadId;
  }
  if (filters.status) {
    where.push('r.status = @status');
    params.status = filters.status;
  }
  if (filters.search) {
    params.search = `%${filters.search}%`;
    where.push('(s.first_name LIKE @search OR s.last_name LIKE @search OR s.ppsa_membership_number LIKE @search)');
  }
  const rows = db
    .prepare(
      `SELECT r.*, s.first_name AS shooter_first_name, s.last_name AS shooter_last_name, s.nickname AS shooter_nickname,
              s.home_club AS shooter_club, d.name AS division_name, d.code AS division_code,
              c.name AS category_name, c.code AS category_code, sq.name AS squad_name
       FROM match_registrations r
       JOIN shooters s ON s.id = r.shooter_id
       LEFT JOIN divisions d ON d.id = r.division_id
       LEFT JOIN categories c ON c.id = r.category_id
       LEFT JOIN squads sq ON sq.id = r.squad_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.last_name, s.first_name
       LIMIT 2000`,
    )
    .all(params) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    matchId: String(r.match_id),
    organizationId: String(r.organization_id),
    shooterId: String(r.shooter_id),
    shooterNumber: String(r.shooter_number),
    firstName: r.shooter_first_name,
    lastName: r.shooter_last_name,
    nickname: r.shooter_nickname ?? null,
    club: r.shooter_club ?? null,
    divisionId: (r.division_id as string) ?? null,
    divisionName: (r.division_name as string) ?? null,
    divisionCode: (r.division_code as string) ?? null,
    categoryId: (r.category_id as string) ?? null,
    categoryName: (r.category_name as string) ?? null,
    categoryCode: (r.category_code as string) ?? null,
    declaredPowerFactor: r.declared_power_factor,
    squadId: (r.squad_id as string) ?? null,
    squadName: (r.squad_name as string) ?? null,
    status: r.status,
    matchNumber: (r.match_number as string) ?? null,
    hasScorePin: Boolean(r.score_pin_hash),
    paid: Boolean(r.paid),
    paymentMode: (r.payment_mode as PaymentMode | null) ?? null,
    registeredAt: String(r.registered_at),
  }));
}

export function updateRegistration(
  db: Db,
  match: Match,
  registration: MatchRegistration,
  patch: { divisionId?: string | null; categoryId?: string | null; declaredPowerFactor?: string; squadId?: string | null; matchNumber?: string | null; notes?: string | null; scorePin?: string | null; paid?: boolean; paymentMode?: string | null },
  actor: { userId: string; username: string | null },
): MatchRegistration {
  if (patch.divisionId && patch.divisionId !== registration.divisionId) {
    if (registration.status !== 'REGISTERED') {
      throw conflict('DIVISION_FROZEN', 'Division may only be changed before the competitor starts the match.');
    }
    const div = divisionById(db, patch.divisionId);
    const inMatch = db.prepare('SELECT id FROM match_divisions WHERE match_id = ? AND division_id = ?').get(match.id, patch.divisionId);
    if (!inMatch) throw badRequest('DIVISION_NOT_IN_MATCH', `Division "${div.name}" is not enabled for this match.`);
  }
  if (patch.categoryId && patch.categoryId !== registration.categoryId) {
    const inMatch = db.prepare('SELECT id FROM match_categories WHERE match_id = ? AND category_id = ?').get(match.id, patch.categoryId);
    if (!inMatch) throw badRequest('CATEGORY_NOT_IN_MATCH', 'This category is not enabled for the match.');
  }
  const existingHash = (db.prepare('SELECT score_pin_hash FROM match_registrations WHERE id = ?').get(registration.id) as { score_pin_hash: string | null }).score_pin_hash;
  let pinHash: string | null;
  if (patch.scorePin === undefined) {
    pinHash = existingHash;
  } else {
    if (registration.status !== 'REGISTERED') {
      throw conflict('PIN_FROZEN', 'The verification PIN may only be set while the competitor is still REGISTERED.');
    }
    if (patch.scorePin === null) {
      pinHash = null;
    } else {
      if (!/^\d{4}$/.test(patch.scorePin)) throw badRequest('SCORE_PIN_INVALID', 'PIN must be exactly 4 digits.');
      pinHash = hashPassword(patch.scorePin);
    }
  }
  const now = new Date().toISOString();
  let paymentMode: PaymentMode | null;
  if (patch.paymentMode !== undefined) {
    paymentMode = (patch.paymentMode as PaymentMode | null) ?? null;
  } else if (patch.paid === true) {
    paymentMode = registration.paymentMode ?? 'CASH';
  } else if (patch.paid === false) {
    paymentMode = null;
  } else {
    paymentMode = registration.paymentMode ?? null;
  }
  db.prepare(
    `UPDATE match_registrations SET division_id=?, category_id=?, declared_power_factor=?, squad_id=?, match_number=?, notes=?, score_pin_hash=?, paid=?, payment_mode=?, status=?, updated_at=? WHERE id=?`,
  ).run(
    patch.divisionId === undefined ? registration.divisionId : patch.divisionId,
    patch.categoryId === undefined ? registration.categoryId : patch.categoryId,
    patch.declaredPowerFactor ?? registration.declaredPowerFactor,
    patch.squadId === undefined ? registration.squadId : patch.squadId,
    patch.matchNumber === undefined ? registration.matchNumber : patch.matchNumber,
    patch.notes === undefined ? registration.notes : patch.notes,
    pinHash,
    patch.paid === undefined ? (registration.paid ? 1 : 0) : patch.paid ? 1 : 0,
    paymentMode,
    registration.status,
    now,
    registration.id,
  );
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'COMPETITOR_REGISTERED',
    entity: 'match_registrations',
    entityId: registration.id,
    oldValue: registration,
    newValue: { ...registration, ...patch },
  });
  return getRegistration(db, match, registration.id);
}

export function resetRegistrationPin(
  db: Db,
  match: Match,
  registration: MatchRegistration,
  newPin: string,
  actor: { userId: string; username: string | null },
): MatchRegistration {
  if (!/^\d{4}$/.test(newPin)) throw badRequest('SCORE_PIN_INVALID', 'PIN must be exactly 4 digits.');
  const now = new Date().toISOString();
  db.prepare('UPDATE match_registrations SET score_pin_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(newPin),
    now,
    registration.id,
  );
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'SCORE_PIN_RESET',
    entity: 'match_registrations',
    entityId: registration.id,
    oldValue: { hasScorePin: registration.hasScorePin },
    newValue: { registrationId: registration.id, pinReset: true, reason: 'forgotten PIN recovery' },
  });
  return getRegistration(db, match, registration.id);
}

export function setRegistrationStatus(
  db: Db,
  match: Match,
  registration: MatchRegistration,
  status: CompetitorStatus,
  reason: string | undefined,
  actor: { userId: string; username: string | null },
): MatchRegistration {
  if (!COMPETITOR_STATUSES.includes(status)) throw badRequest('BAD_STATUS', 'Invalid competitor status.');
  if (registration.status === 'DQ' && status !== 'DQ') {
    throw conflict('DQ_IMMUTABLE', 'A DQ is final within a match and cannot be silently undone.');
  }
  if (registration.status === 'WITHDRAWN') {
    throw conflict('WITHDRAWN_IMMUTABLE', 'A withdrawn competitor cannot be re-activated without a correction.');
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE match_registrations SET status = ?, updated_at = ? WHERE id = ?').run(status, now, registration.id);
  // A DQ/DNS/DNF/WITHDRAWN leaves scores out of ranking; record the decision.
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'COMPETITOR_STATUS_CHANGED',
    entity: 'match_registrations',
    entityId: registration.id,
    oldValue: registration.status,
    newValue: status,
    ...(reason ? { newValue2: { status, reason } } : {}),
  });
  void reason;
  return getRegistration(db, match, registration.id);
}

export function batchRegistrationStatuses(
  db: Db,
  match: Match,
  items: { registrationId: string; status: CompetitorStatus; reason?: string }[],
  actor: { userId: string; username: string | null },
): void {
  for (const item of items) {
    const reg = getRegistration(db, match, item.registrationId);
    setRegistrationStatus(db, match, reg, item.status, item.reason, actor);
  }
}

export function checkIn(
  db: Db,
  match: Match,
  registration: MatchRegistration,
  squadId: string | null,
  actor: { userId: string; username: string | null },
): Record<string, unknown> {
  const now = new Date().toISOString();
  if (squadId && squadId !== registration.squadId) {
    db.prepare('UPDATE match_registrations SET squad_id = ?, updated_at = ? WHERE id = ?').run(squadId, now, registration.id);
  }
  db.prepare("UPDATE match_registrations SET status = 'CHECKED_IN', updated_at = ? WHERE id = ?").run(now, registration.id);
  db.prepare(
    'INSERT INTO attendance_records (id, match_id, registration_id, squad_id, checked_in_at, checked_in_by) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(uuid(), match.id, registration.id, squadId ?? registration.squadId, now, actor.userId);
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'COMPETITOR_CHECKED_IN',
    entity: 'match_registrations',
    entityId: registration.id,
    oldValue: registration.status,
    newValue: 'CHECKED_IN',
  });
  return { id: registration.id, status: 'CHECKED_IN', checkedInAt: now, squadId: squadId ?? registration.squadId };
}

export function listAttendance(db: Db, match: Match): Record<string, unknown>[] {
  const rows = db
    .prepare(
      `SELECT r.id AS registration_id, r.shooter_number, s.first_name, s.last_name, a.squad_id, a.checked_in_at, a.checked_in_by
       FROM attendance_records a
       JOIN match_registrations r ON r.id = a.registration_id
       JOIN shooters s ON s.id = r.shooter_id
       WHERE a.match_id = ?
       ORDER BY a.checked_in_at`,
    )
    .all(match.id) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...r,
    registrationId: String(r.registration_id),
    firstName: String(r.first_name),
    lastName: String(r.last_name),
    squadId: (r.squad_id as string) ?? null,
    checkedInAt: String(r.checked_in_at),
    checkedInBy: String(r.checked_in_by),
  }));
}

/** Builds a spreadsheet-friendly CSV of all registered shooters for a match. */
export function registrationsCsv(db: Db, match: Match): { filename: string; csv: string } {
  const rows = db
    .prepare(
      `SELECT r.shooter_number, r.match_number, r.status, r.paid, r.payment_mode, r.score_pin_hash, r.registered_at,
              s.first_name, s.last_name, s.nickname, s.gender, s.home_club, s.ppsa_membership_number,
              r.declared_power_factor, d.name AS division_name, c.name AS category_name, sq.name AS squad_name
       FROM match_registrations r
       JOIN shooters s ON s.id = r.shooter_id
       LEFT JOIN divisions d ON d.id = r.division_id
       LEFT JOIN categories c ON c.id = r.category_id
       LEFT JOIN squads sq ON sq.id = r.squad_id
       WHERE r.match_id = ?
       ORDER BY s.last_name, s.first_name`,
    )
    .all(match.id) as Record<string, unknown>[];
  const esc = (v: unknown): string => `"${(v === null || v === undefined ? '' : String(v)).replace(/"/g, '""')}"`;
  const header = [
    'No.',
    'Shooter #',
    'PPSA #',
    'Last Name',
    'First Name',
    'Nickname',
    'Gender',
    'Club',
    'Division',
    'Category',
    'Power Factor',
    'Squad',
    'Match Order',
    'Status',
    'PIN Set',
    'Paid',
    'Payment Mode',
    'Registered At',
  ];
  const lines = [header.map(esc).join(',')];
  rows.forEach((r, i) => {
    lines.push(
      [
        i + 1,
        r.shooter_number,
        r.ppsa_membership_number,
        r.last_name,
        r.first_name,
        r.nickname,
        r.gender,
        r.home_club,
        r.division_name,
        r.category_name,
        r.declared_power_factor,
        r.squad_name,
        r.match_number,
        r.status,
        Boolean(r.score_pin_hash) ? 'YES' : 'NO',
        Boolean(r.paid) ? 'YES' : 'NO',
        (r.payment_mode as string) ?? '',
        r.registered_at,
      ]
        .map(esc)
        .join(','),
    );
  });
  const slug = match.name.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'match';
  return { filename: `${slug}-registrations.csv`, csv: `\ufeff${lines.join('\r\n')}\r\n` };
}