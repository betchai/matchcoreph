import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../services/utils.js';
import { requireAuth, requireInOrg, requirePlatform, sessionFromToken, type AuthContext } from '../services/auth.js';
import type { Db } from '../db/client.js';
import type { Permission } from '@blinkscore/core';
import { roleHasPermission } from '@blinkscore/core';

export const COOKIE_NAME = 'psa_session';
export const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax' as const, path: '/' };

declare module 'fastify' {
  interface FastifyRequest {
    ctx: AuthContext | null;
    db: Db;
  }
}

export function resolveContext(req: FastifyRequest): AuthContext | null {
  const token = req.cookies?.[COOKIE_NAME];
  return token ? sessionFromToken(req.db, token) : null;
}

export function authed(req: FastifyRequest): AuthContext {
  return requireAuth(req.ctx);
}

export function orgScope(req: FastifyRequest, orgId: string, permission: Permission): { ctx: AuthContext; orgId: string } {
  const ctx = authed(req);
  requireInOrg(ctx, orgId, permission);
  return { ctx, orgId };
}

export function platformScope(req: FastifyRequest, permission: Permission): AuthContext {
  const ctx = authed(req);
  requirePlatform(ctx, permission);
  return ctx;
}

/** Permission that may be satisfied by any role the user holds in any organization. */
export function requireAnyPermission(req: FastifyRequest, permission: Permission): AuthContext {
  const ctx = authed(req);
  const ok =
    ctx.user.isSuperAdmin ||
    ctx.roles.some((r) => roleHasPermission(r.role, permission));
  if (!ok) throw new AppError(403, 'FORBIDDEN', `Insufficient permissions for ${permission}.`);
  return ctx;
}

export function handleError(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof AppError) {
    return reply.status(err.status).send({ error: err.code, message: err.message });
  }
  if (err instanceof Error && 'statusCode' in err) {
    const code = (err as unknown as { statusCode: number }).statusCode;
    return reply.status(code).send({ error: 'HTTP_ERROR', message: err.message });
  }
  if (err instanceof Error && err.name === 'ZodError') {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', message: err.message });
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  return reply.status(500).send({ error: 'INTERNAL', message });
}

export function param(req: FastifyRequest, key: string): string {
  const p = (req.params as Record<string, string>)[key];
  if (!p) throw new AppError(400, 'MISSING_PARAM', `Missing path parameter "${key}".`);
  return p;
}

export function queryStr(req: FastifyRequest, key: string): string | undefined {
  const q = req.query as Record<string, unknown>;
  const v = q[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function body<T>(req: FastifyRequest): T {
  return req.body as T;
}