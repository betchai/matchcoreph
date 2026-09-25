import type { Db } from '../db/client.js';
import type { AuditAction } from '@blinkscore/core';
import { uuid } from './utils.js';

export interface AuditInput {
  organizationId?: string | null;
  userId?: string | null;
  username?: string | null;
  action: AuditAction;
  entity?: string | null;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export function audit(db: Db, input: AuditInput): void {
  db.prepare(
    `INSERT INTO audit_logs
      (id, organization_id, user_id, username, action, entity, entity_id, old_value, new_value, ip_address, user_agent, created_at)
     VALUES (@id, @organizationId, @userId, @username, @action, @entity, @entityId, @oldValue, @newValue, @ipAddress, @userAgent, @createdAt)`,
  ).run({
    id: uuid(),
    organizationId: input.organizationId ?? null,
    userId: input.userId ?? null,
    username: input.username ?? null,
    action: input.action,
    entity: input.entity ?? null,
    entityId: input.entityId ?? null,
    oldValue: input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
    newValue: input.newValue === undefined ? null : JSON.stringify(input.newValue),
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    createdAt: new Date().toISOString(),
  });
}

export function listAudit(db: Db, opts: { organizationId?: string | null; limit: number; offset: number; userId?: string | null; action?: string | null }): Record<string, unknown>[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.organizationId) {
    where.push('organization_id = @organizationId');
    params.organizationId = opts.organizationId;
  }
  if (opts.userId) {
    where.push('user_id = @userId');
    params.userId = opts.userId;
  }
  if (opts.action) {
    where.push('action = @action');
    params.action = opts.action;
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM audit_logs ${clause} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: opts.limit, offset: opts.offset }) as Record<string, unknown>[];
  return camelRows(rows);
}

function camelRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k.replace(/_([a-z])/g, (_m, c) => c.toUpperCase())] = v;
    return out;
  });
}