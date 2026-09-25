import type { Db } from '../db/client.js';
import { uuid, notFound, badRequest } from './utils.js';
import { audit } from './audit.js';
import type { Shooter } from '@blinkscore/core';

export function mapShooter(row: Record<string, unknown>): Shooter {
  return {
    id: String(row.id),
    shooterNumber: String(row.shooter_number),
    firstName: String(row.first_name),
    lastName: String(row.last_name),
    nickname: (row.nickname as string) ?? null,
    email: (row.email as string) ?? null,
    phone: (row.phone as string) ?? null,
    homeClub: (row.home_club as string) ?? null,
    ppsaMembershipNumber: (row.ppsa_membership_number as string) ?? null,
    ipscAlias: (row.ipsc_alias as string) ?? null,
    gender: (row.gender as Shooter['gender']) ?? null,
    birthYear: (row.birth_year as number) ?? null,
    active: Number(row.active) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function nextShooterNumber(db: Db): string {
  const row = db
    .prepare('SELECT COALESCE(MAX(CAST(shooter_number AS INTEGER)), 1000) + 1 AS n FROM shooters')
    .get() as Record<string, unknown>;
  return String(row.n);
}

export function createShooter(
  db: Db,
  input: {
    firstName: string;
    lastName: string;
    nickname?: string | null;
    email?: string | null;
    phone?: string | null;
    homeClub?: string | null;
    ppsaMembershipNumber?: string | null;
    ipscAlias?: string | null;
    gender?: Shooter['gender'];
    birthYear?: number | null;
    shooterNumber?: string;
  },
  actor?: { userId: string | null; username: string | null },
): Shooter {
  if (!input.firstName.trim() || !input.lastName.trim()) throw badRequest('NAME_REQUIRED', 'First and last name are required.');
  const shooterNumber = input.shooterNumber ?? nextShooterNumber(db);
  const existing = db
    .prepare('SELECT id FROM shooters WHERE shooter_number = ?')
    .get(shooterNumber);
  if (existing) throw badRequest('SHOOTER_EXISTS', 'A shooter with that number already exists.');
  const id = uuid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO shooters
      (id, shooter_number, first_name, last_name, nickname, email, phone, home_club, ppsa_membership_number, ipsc_alias, gender, birth_year, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    id,
    shooterNumber,
    input.firstName.trim(),
    input.lastName.trim(),
    input.nickname ?? null,
    input.email ?? null,
    input.phone ?? null,
    input.homeClub ?? null,
    input.ppsaMembershipNumber ?? null,
    input.ipscAlias ?? null,
    input.gender ?? null,
    input.birthYear ?? null,
    now,
    now,
  );
  audit(db, {
    organizationId: null,
    userId: actor?.userId ?? null,
    username: actor?.username ?? null,
    action: 'SHOOTER_REGISTERED',
    entity: 'shooters',
    entityId: id,
    newValue: { firstName: input.firstName, lastName: input.lastName, number: shooterNumber },
  });
  return shooterById(db, id);
}

export function shooterById(db: Db, shooterId: string): Shooter {
  const row = db
    .prepare('SELECT * FROM shooters WHERE id = ?')
    .get(shooterId) as Record<string, unknown> | undefined;
  if (!row) throw notFound('Shooter not found.');
  return mapShooter(row);
}

export function listShooters(
  db: Db,
  search?: string,
): Shooter[] {
  let rows: Record<string, unknown>[];
  if (search) {
    const like = `%${search}%`;
    rows = db
      .prepare(
        `SELECT * FROM shooters
         WHERE (first_name LIKE ? OR last_name LIKE ? OR nickname LIKE ? OR shooter_number LIKE ? OR ppsa_membership_number LIKE ? OR home_club LIKE ?)
         ORDER BY last_name, first_name LIMIT 500`,
      )
      .all(like, like, like, like, like, like) as Record<string, unknown>[];
  } else {
    rows = db
      .prepare('SELECT * FROM shooters ORDER BY last_name, first_name LIMIT 2000')
      .all() as Record<string, unknown>[];
  }
  return rows.map(mapShooter);
}

export function updateShooter(
  db: Db,
  shooterId: string,
  patch: Partial<Shooter>,
  actor?: { userId: string | null; username: string | null },
): Shooter {
  const current = shooterById(db, shooterId);
  const merged = { ...current, ...patch };
  if (!merged.firstName.trim() || !merged.lastName.trim()) throw badRequest('NAME_REQUIRED', 'First and last name are required.');
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE shooters SET
       shooter_number=?, first_name=?, last_name=?, nickname=?, email=?, phone=?, home_club=?,
       ppsa_membership_number=?, ipsc_alias=?, gender=?, birth_year=?, active=?, updated_at=?
     WHERE id=?`,
  ).run(
    merged.shooterNumber,
    merged.firstName.trim(),
    merged.lastName.trim(),
    merged.nickname ?? null,
    merged.email ?? null,
    merged.phone ?? null,
    merged.homeClub ?? null,
    merged.ppsaMembershipNumber ?? null,
    merged.ipscAlias ?? null,
    merged.gender ?? null,
    merged.birthYear ?? null,
    merged.active ? 1 : 0,
    now,
    shooterId,
  );
  audit(db, {
    organizationId: null,
    userId: actor?.userId ?? null,
    username: actor?.username ?? null,
    action: 'SHOOTER_REGISTERED',
    entity: 'shooters',
    entityId: shooterId,
    oldValue: current,
    newValue: merged,
  });
  return shooterById(db, shooterId);
}

export function importShootersCsv(
  db: Db,
  rows: {
    firstName?: string;
    lastName?: string;
    club?: string;
    divisionCode?: string;
    categoryCode?: string;
    email?: string;
    membershipNumber?: string;
  }[],
  actor?: { userId: string | null; username: string | null },
): { created: number; skipped: number; errors: string[] } {
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  const insert = db.transaction(() => {
    for (const [i, row] of rows.entries()) {
      try {
        if (!row.firstName || !row.lastName) throw badRequest('BAD_ROW', `Row ${i + 1}: first and last name required.`);
        const dup = db
          .prepare('SELECT id FROM shooters WHERE first_name = ? AND last_name = ?')
          .get(row.firstName.trim(), row.lastName.trim());
        if (dup) {
          skipped += 1;
          continue;
        }
        createShooter(
          db,
          {
            firstName: row.firstName,
            lastName: row.lastName,
            homeClub: row.club ?? null,
            email: row.email ?? null,
            ppsaMembershipNumber: row.membershipNumber ?? null,
          },
          actor,
        );
        created += 1;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'Unknown import error');
      }
    }
  });
  insert();
  return { created, skipped, errors };
}