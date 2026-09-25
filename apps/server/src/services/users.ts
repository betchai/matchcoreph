import type { Db } from '../db/client.js';
import { uuid, conflict, notFound } from './utils.js';
import { passwordHash } from './auth.js';
import { audit } from './audit.js';
import type { UserRole } from '@blinkscore/core';
import { ROLE_LABELS } from '@blinkscore/core';
import { forbidden } from './utils.js';

const PLATFORM_ROLES: UserRole[] = ['PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN'];

function assertOrgScopedRole(role: UserRole): void {
  if (PLATFORM_ROLES.includes(role)) {
    throw forbidden('PLATFORM_ROLE_RESTRICTED', 'Platform roles cannot be assigned to an organization user.');
  }
}

export interface UserView {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  locked: boolean;
  mustChangePassword: boolean;
  isSuperAdmin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export function mapUserView(row: Record<string, unknown>): UserView {
  return {
    id: String(row.id),
    username: String(row.username),
    email: String(row.email),
    displayName: (row.display_name as string) ?? null,
    locked: Number(row.locked) === 1,
    mustChangePassword: Number(row.must_change_password) === 1,
    isSuperAdmin: Number(row.is_super_admin) === 1,
    lastLoginAt: (row.last_login_at as string) ?? null,
    createdAt: String(row.created_at),
  };
}

export function createUser(
  db: Db,
  input: {
    username: string;
    email: string;
    password: string;
    displayName?: string | null;
    role: UserRole;
    organizationId?: string | null;
    isSuperAdmin?: boolean;
  },
  actor?: { userId: string; username: string | null },
): UserView {
  const exists = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(input.username, input.email);
  if (exists) throw conflict('USER_EXISTS', 'A user with that username or email already exists.');

  if (input.organizationId) assertOrgScopedRole(input.role);

  const id = uuid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, display_name, is_super_admin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.username,
    input.email,
    passwordHash(input.password),
    input.displayName ?? null,
    input.isSuperAdmin ? 1 : 0,
    now,
    now,
  );

  if (input.organizationId) {
    db.prepare(
      'INSERT INTO user_roles (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(uuid(), input.organizationId, id, input.role, now);
  }

  audit(db, {
    organizationId: input.organizationId ?? null,
    userId: actor?.userId ?? null,
    username: actor?.username ?? null,
    action: 'USER_CREATED',
    entity: 'users',
    entityId: id,
    oldValue: null,
    newValue: { username: input.username, email: input.email, role: input.role },
  });

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown>;
  return mapUserView(row);
}

export function setOrgRole(
  db: Db,
  userId: string,
  organizationId: string,
  role: UserRole,
  actor?: { userId: string; username: string | null },
  organizationName?: string,
): void {
  assertOrgScopedRole(role);
  const now = new Date().toISOString();
  db.prepare('DELETE FROM user_roles WHERE user_id = ? AND organization_id = ?').run(userId, organizationId);
  db.prepare(
    'INSERT INTO user_roles (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(uuid(), organizationId, userId, role, now);
  audit(db, {
    organizationId,
    userId: actor?.userId ?? null,
    username: actor?.username ?? null,
    action: 'ROLE_CHANGED',
    entity: 'user_roles',
    entityId: userId,
    oldValue: null,
    newValue: { role, organizationName },
  });
}

export function removeOrgRole(db: Db, userId: string, organizationId: string): void {
  db.prepare('DELETE FROM user_roles WHERE user_id = ? AND organization_id = ?').run(userId, organizationId);
}

export function userById(db: Db, userId: string): UserView {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown> | undefined;
  if (!row) throw notFound('User not found.');
  return mapUserView(row);
}

export function listOrgUsers(db: Db, organizationId: string): (UserView & { role: UserRole | null })[] {
  const rows = db
    .prepare(
      `SELECT u.*, r.role AS role
       FROM users u
       LEFT JOIN user_roles r ON r.user_id = u.id AND r.organization_id = ?
       WHERE u.is_super_admin = 0 AND (r.id IS NOT NULL)
       ORDER BY u.username`,
    )
    .all(organizationId) as Record<string, unknown>[];
  return rows.map((r) => ({ ...mapUserView(r), role: (r.role as UserRole) ?? null }));
}

export function setLocked(db: Db, userId: string, locked: boolean): UserView {
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET locked = ?, updated_at = ? WHERE id = ?').run(locked ? 1 : 0, now, userId);
  return userById(db, userId);
}

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role] ?? role;
}