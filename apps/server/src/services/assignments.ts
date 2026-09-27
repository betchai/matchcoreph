import type { Db } from '../db/client.js';
import type { Match, UserRole } from '@blinkscore/core';
import { conflict, forbidden, notFound, uuid } from './utils.js';
import { audit } from './audit.js';
import { getStage } from './stages.js';
import { userById } from './users.js';
import { type AuthContext } from './auth.js';

const ASSIGNMENT_ROLE = 'SCOREKEEPER' as const;

/** Roles that may score any stage without requiring an explicit assignment. */
const UNRESTRICTED_SCORING_ROLES: UserRole[] = [
  'PLATFORM_SUPER_ADMIN',
  'PLATFORM_ADMIN',
  'ORGANIZATION_ADMIN',
  'MATCH_DIRECTOR',
  'RANGE_MASTER',
  'RANGE_OFFICER',
];

export interface AssignmentView {
  id: string;
  matchId: string;
  userId: string;
  username: string;
  displayName: string | null;
  role: string;
  stageId: string;
  stageNumber: number;
  stageName: string;
  createdAt: string;
}

function effectiveOrgRoles(ctx: AuthContext, organizationId: string): UserRole[] {
  if (ctx.user.isSuperAdmin) return ['PLATFORM_SUPER_ADMIN'];
  return ctx.roles
    .filter((r) => r.organizationId === organizationId || r.organizationId === '*')
    .map((r) => r.role as UserRole);
}

/** True when the user is a Scorekeeper and holds no unrestricted scoring role, so stage assignment applies. */
export function isStageRestrictedScorekeeper(ctx: AuthContext, organizationId: string): boolean {
  if (ctx.user.isSuperAdmin) return false;
  const grants = effectiveOrgRoles(ctx, organizationId);
  return grants.includes(ASSIGNMENT_ROLE) && !grants.some((r) => UNRESTRICTED_SCORING_ROLES.includes(r));
}

export function listAssignments(db: Db, match: Match): AssignmentView[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.match_id, a.user_id, u.username, u.display_name, a.role, a.stage_id,
              s.number AS stage_number, s.name AS stage_name, a.created_at
       FROM match_assignments a
       JOIN users u ON u.id = a.user_id
       JOIN stages s ON s.id = a.stage_id
       WHERE a.match_id = ?
       ORDER BY s.number, u.username`,
    )
    .all(match.id) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    matchId: String(r.match_id),
    userId: String(r.user_id),
    username: String(r.username),
    displayName: (r.display_name as string | null) ?? null,
    role: String(r.role),
    stageId: String(r.stage_id),
    stageNumber: Number(r.stage_number),
    stageName: String(r.stage_name),
    createdAt: String(r.created_at),
  }));
}

export function createAssignment(
  db: Db,
  match: Match,
  input: { userId: string; stageId: string },
  actor: { userId: string; username: string | null },
): AssignmentView {
  const user = userById(db, input.userId);
  const roleRow = db
    .prepare('SELECT role FROM user_roles WHERE user_id = ? AND organization_id = ?')
    .get(input.userId, match.organizationId) as { role: string } | undefined;
  if (!roleRow) throw conflict('NOT_ORG_MEMBER', 'User is not a member of this organization.');
  if (roleRow.role !== ASSIGNMENT_ROLE) {
    throw conflict('NOT_SCOREKEEPER', `${user.username} does not have the Scorekeeper role in this organization.`);
  }
  getStage(db, match, input.stageId);

  const dup = db
    .prepare('SELECT id FROM match_assignments WHERE match_id = ? AND user_id = ? AND role = ? AND stage_id = ?')
    .get(match.id, input.userId, ASSIGNMENT_ROLE, input.stageId);
  if (dup) throw conflict('ALREADY_ASSIGNED', 'That scorekeeper is already assigned to this stage.');

  const id = uuid();
  db.prepare(
    `INSERT INTO match_assignments (id, match_id, organization_id, user_id, role, stage_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, match.id, match.organizationId, input.userId, ASSIGNMENT_ROLE, input.stageId, new Date().toISOString());

  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'ASSIGNMENT_CREATED',
    entity: 'match_assignments',
    entityId: id,
    newValue: { userId: input.userId, stageId: input.stageId, role: ASSIGNMENT_ROLE },
  });

  return listAssignments(db, match).find((a) => a.id === id)!;
}

export function deleteAssignment(
  db: Db,
  match: Match,
  assignmentId: string,
  actor: { userId: string; username: string | null },
): void {
  const row = db.prepare('SELECT * FROM match_assignments WHERE id = ? AND match_id = ?').get(assignmentId, match.id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound('Assignment not found for this match.');
  db.prepare('DELETE FROM match_assignments WHERE id = ?').run(assignmentId);

  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'ASSIGNMENT_REMOVED',
    entity: 'match_assignments',
    entityId: assignmentId,
    oldValue: { userId: String(row.user_id), stageId: String(row.stage_id), role: String(row.role) },
  });
}

export function assignedStageIds(db: Db, userId: string, matchId: string): string[] {
  const rows = db
    .prepare('SELECT stage_id FROM match_assignments WHERE user_id = ? AND match_id = ? AND role = ?')
    .all(userId, matchId, ASSIGNMENT_ROLE) as { stage_id: string }[];
  return rows.map((r) => r.stage_id);
}

export function hasStageAssignment(db: Db, userId: string, matchId: string, stageId: string): boolean {
  return !!db
    .prepare('SELECT 1 FROM match_assignments WHERE user_id = ? AND match_id = ? AND stage_id = ? AND role = ?')
    .get(userId, matchId, stageId, ASSIGNMENT_ROLE);
}

/** Throws 403 when a stage-restricted scorekeeper tries to score a stage they are not assigned to. */
export function assertScorekeeperCanScore(db: Db, ctx: AuthContext, match: Match, stageId: string): void {
  if (!isStageRestrictedScorekeeper(ctx, match.organizationId)) return;
  if (!hasStageAssignment(db, ctx.user.id, match.id, stageId)) {
    throw forbidden('STAGE_NOT_ASSIGNED', 'Scorekeepers may only score stages they are assigned to.');
  }
}