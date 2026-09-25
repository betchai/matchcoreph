import type { Db } from '../db/client.js';
import { sha256, randomToken, uuid, unauthorized, forbidden } from './utils.js';
import { hashPassword, verifyPassword } from './password.js';
import type { UserRole } from '@blinkscore/core';
import { roleHasPermission, type Permission } from '@blinkscore/core';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  locked: boolean;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
}

export interface RoleGrant {
  organizationId: string;
  role: UserRole;
}

export interface AuthContext {
  user: AuthUser;
  roles: RoleGrant[];
  sessionId: string;
  sessionToken: string;
  /** Set when a super admin is impersonating an organization administrator. */
  impersonating?: { originalUserId: string; organizationId: string };
}

export function login(
  db: Db,
  usernameOrEmail: string,
  password: string,
  ip: string | null,
  userAgent: string | null,
): AuthContext {
  const row = db
    .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
    .get(usernameOrEmail, usernameOrEmail) as Record<string, unknown> | undefined;
  if (!row || !verifyPassword(password, String(row.password_hash))) {
    throw unauthorized('Invalid username or password.');
  }
  if (Number(row.locked) === 1) {
    throw forbidden('This account is locked. Contact an administrator.');
  }
  const context = startSession(db, String(row.id), { ip, userAgent });
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(
    now,
    now,
    context.user.id,
  );
  return context;
}

export function startSession(
  db: Db,
  userId: string,
  opts: { ip?: string | null; userAgent?: string | null; impersonates?: string | null } = {},
): AuthContext {
  const sessionToken = randomToken();
  const sessionId = uuid();
  db.prepare(
    `INSERT INTO auth_sessions (id, user_id, token_hash, impersonates, expires_at, ip_address, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    userId,
    sha256(sessionToken),
    opts.impersonates ?? null,
    new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    opts.ip ?? null,
    opts.userAgent ?? null,
    new Date().toISOString(),
  );
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown>;
  return {
    user: mapUser(userRow),
    roles: userRoles(db, userId),
    sessionId,
    sessionToken,
    impersonating: opts.impersonates
      ? { originalUserId: opts.impersonates, organizationId: userRoles(db, userId)[0]?.organizationId ?? '' }
      : undefined,
  };
}

function mapUser(row: Record<string, unknown>): AuthUser {
  return {
    id: String(row.id),
    username: String(row.username),
    email: String(row.email),
    displayName: (row.display_name as string) ?? null,
    locked: Number(row.locked) === 1,
    isSuperAdmin: Number(row.is_super_admin) === 1,
    mustChangePassword: Number(row.must_change_password) === 1,
  };
}

export function sessionFromToken(db: Db, token: string | undefined): AuthContext | null {
  if (!token) return null;
  const session = db
    .prepare('SELECT * FROM auth_sessions WHERE token_hash = ?')
    .get(sha256(token)) as Record<string, unknown> | undefined;
  if (!session) return null;
  if (new Date(String(session.expires_at)).getTime() < Date.now()) return null;
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(String(session.user_id)) as
    | Record<string, unknown>
    | undefined;
  if (!userRow) return null;
  return {
    user: mapUser(userRow),
    roles: userRoles(db, String(userRow.id)),
    sessionId: String(session.id),
    sessionToken: token,
  };
}

export function destroySession(db: Db, sessionId: string): void {
  db.prepare('DELETE FROM auth_sessions WHERE id = ?').run(sessionId);
}

export function passwordHash(password: string): string {
  return hashPassword(password);
}

/** Roles the user holds across organizations (including platform-level grants). */
export function userRoles(db: Db, userId: string): RoleGrant[] {
  const platform = (db.prepare('SELECT role FROM platform_admins WHERE user_id = ?').all(userId) as { role: string }[]).map(
    (r) => ({ organizationId: '*', role: r.role as UserRole }),
  );
  if (isSuperAdminUser(db, userId)) return [{ organizationId: '*', role: 'PLATFORM_SUPER_ADMIN' }, ...platform];
  const rows = db
    .prepare('SELECT organization_id, role FROM user_roles WHERE user_id = ?')
    .all(userId) as Record<string, unknown>[];
  return [...platform, ...rows.map((r) => ({ organizationId: String(r.organization_id), role: r.role as UserRole }))];
}

export function isSuperAdminUser(db: Db, userId: string): boolean {
  const row = db.prepare('SELECT is_super_admin FROM users WHERE id = ?').get(userId) as
    | Record<string, unknown>
    | undefined;
  return row ? Number(row.is_super_admin) === 1 : false;
}

export function requireAuth(ctx: AuthContext | null): AuthContext {
  if (!ctx) throw unauthorized();
  if (ctx.user.locked) throw forbidden('This account is locked.');
  return ctx;
}

/** Roles the user effectively holds within a specific organization. */
export function orgRoleGrants(ctx: AuthContext, organizationId: string): UserRole[] {
  if (ctx.user.isSuperAdmin) return ['PLATFORM_SUPER_ADMIN'];
  return ctx.roles.filter((r) => r.organizationId === organizationId).map((r) => r.role);
}

export function canInOrg(ctx: AuthContext, organizationId: string, permission: Permission): boolean {
  if (ctx.user.isSuperAdmin) return true;
  if (orgRoleGrants(ctx, organizationId).some((role) => roleHasPermission(role, permission))) return true;
  // Platform-scoped roles ('*') act within any organization for their permission set.
  return ctx.roles.some((r) => r.organizationId === '*' && roleHasPermission(r.role, permission));
}

export function requireInOrg(ctx: AuthContext, organizationId: string, permission: Permission): void {
  if (!canInOrg(ctx, organizationId, permission)) {
    throw forbidden(`Insufficient permissions for ${permission} in this organization.`);
  }
}

export function canPlatform(ctx: AuthContext, permission: Permission): boolean {
  if (ctx.user.isSuperAdmin) return true;
  return ctx.roles.some((r) => roleHasPermission(r.role, permission));
}

export function requirePlatform(ctx: AuthContext, permission: Permission): void {
  if (!canPlatform(ctx, permission)) {
    throw forbidden(`Insufficient permissions for ${permission}.`);
  }
}

export function changePassword(db: Db, userId: string, current: string, next: string): void {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, unknown> | undefined;
  if (!row) throw unauthorized();
  if (!verifyPassword(current, String(row.password_hash))) {
    throw unauthorized('Current password is incorrect.');
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(
    hashPassword(next),
    now,
    userId,
  );
}