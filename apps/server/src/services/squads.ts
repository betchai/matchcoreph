import type { Db } from '../db/client.js';
import { uuid, notFound, badRequest } from './utils.js';
import { audit } from './audit.js';
import type { Match, Squad } from '@blinkscore/core';

export function mapSquad(row: Record<string, unknown>): Squad {
  return {
    id: String(row.id),
    matchId: String(row.match_id),
    name: String(row.name),
    stageNumber: (row.stage_number as number) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getSquad(db: Db, match: Match, squadId: string): Squad {
  const row = db
    .prepare('SELECT * FROM squads WHERE id = ? AND match_id = ?')
    .get(squadId, match.id) as Record<string, unknown> | undefined;
  if (!row) throw notFound('Squad not found.');
  return mapSquad(row);
}

export function listSquads(db: Db, match: Match): Squad[] {
  const rows = db.prepare('SELECT * FROM squads WHERE match_id = ? ORDER BY name').all(match.id) as Record<string, unknown>[];
  return rows.map(mapSquad);
}

export function createSquad(
  db: Db,
  match: Match,
  input: { name: string; stageNumber?: number | null },
  actor: { userId: string; username: string | null },
): Squad {
  const existing = db.prepare('SELECT id FROM squads WHERE match_id = ? AND name = ?').get(match.id, input.name);
  if (existing) throw badRequest('SQUAD_EXISTS', 'A squad with that name already exists.');
  const id = uuid();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO squads (id, match_id, organization_id, name, stage_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    match.id,
    match.organizationId,
    input.name,
    input.stageNumber ?? null,
    now,
    now,
  );
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'SQUAD_CREATED',
    entity: 'squads',
    entityId: id,
    newValue: { name: input.name },
  });
  return getSquad(db, match, id);
}

export function updateSquad(
  db: Db,
  match: Match,
  squadId: string,
  patch: { name?: string; stageNumber?: number | null },
  actor: { userId: string; username: string | null },
): Squad {
  const current = getSquad(db, match, squadId);
  const name = patch.name !== undefined ? patch.name.trim() : current.name;
  if (!name) throw badRequest('NAME_REQUIRED', 'Squad name is required.');
  if (patch.name !== undefined) {
    const existing = db.prepare('SELECT id FROM squads WHERE match_id = ? AND name = ? AND id != ?').get(match.id, name, squadId);
    if (existing) throw badRequest('SQUAD_EXISTS', 'A squad with that name already exists.');
  }
  const stageNumber = patch.stageNumber === undefined ? current.stageNumber : patch.stageNumber;
  const now = new Date().toISOString();
  db.prepare('UPDATE squads SET name = ?, stage_number = ?, updated_at = ? WHERE id = ?').run(name, stageNumber, now, squadId);
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'SQUAD_MODIFIED',
    entity: 'squads',
    entityId: squadId,
    oldValue: { name: current.name, stageNumber: current.stageNumber },
    newValue: { name, stageNumber },
  });
  return getSquad(db, match, squadId);
}

export function deleteSquad(db: Db, match: Match, squadId: string, actor: { userId: string; username: string | null }): void {
  const regs = (db.prepare('SELECT count(*) c FROM match_registrations WHERE squad_id = ?').get(squadId) as { c: number }).c;
  if (Number(regs) > 0) throw badRequest('SQUAD_NOT_EMPTY', 'Cannot delete a squad that still has competitors assigned.');
  getSquad(db, match, squadId);
  db.prepare('DELETE FROM squads WHERE id = ?').run(squadId);
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'SQUAD_MODIFIED',
    entity: 'squads',
    entityId: squadId,
    oldValue: 'deleted',
    newValue: null,
  });
}

export function squadOverview(db: Db, match: Match): Record<string, unknown>[] {
  const squads = listSquads(db, match);
  return squads.map((sq) => {
    const members = db
      .prepare(
        `SELECT r.id, r.shooter_id, s.first_name, s.last_name, r.status,
                (SELECT sc.status FROM scores sc WHERE sc.registration_id = r.id LIMIT 1) AS score_status
         FROM match_registrations r JOIN shooters s ON s.id = r.shooter_id
         WHERE r.squad_id = ? ORDER BY s.last_name, s.first_name`,
      )
      .all(sq.id) as Record<string, unknown>[];
    const pending = members.filter((m) => !m.score_status || m.score_status === 'DRAFT').length;
    return {
      id: sq.id,
      name: sq.name,
      stageNumber: sq.stageNumber,
      memberCount: members.length,
      members,
      completionPct: members.length === 0 ? 0 : Math.round(((members.length - pending) / members.length) * 100),
    };
  });
}