import type { FastifyInstance } from 'fastify';
import { changePassword, destroySession, login } from '../services/auth.js';
import { COOKIE_NAME, COOKIE_OPTS, authed, body } from './helpers.js';
import { loginSchema, changePasswordSchema } from '@blinkscore/core';
import { audit } from '../services/audit.js';

export function authRoutes(app: FastifyInstance): void {
  app.post('/api/auth/login', async (req, reply) => {
    const input = loginSchema.parse(body(req));
    const ctx = login(req.db, input.usernameOrEmail, input.password, req.ip ?? null, req.headers['user-agent'] ?? null);
    reply.setCookie(COOKIE_NAME, ctx.sessionToken, {
      ...COOKIE_OPTS,
      secure: req.protocol === 'https' || process.env.COOKIE_SECURE === '1',
      expires: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });
    audit(req.db, {
      organizationId: null,
      userId: ctx.user.id,
      username: ctx.user.username,
      action: 'LOGIN',
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return {
      user: {
        id: ctx.user.id,
        username: ctx.user.username,
        email: ctx.user.email,
        displayName: ctx.user.displayName,
        isSuperAdmin: ctx.user.isSuperAdmin,
        mustChangePassword: ctx.user.mustChangePassword,
      },
      roles: ctx.roles,
    };
  });

  app.post('/api/auth/logout', async (req) => {
    const ctx = authed(req);
    destroySession(req.db, ctx.sessionId);
    audit(req.db, {
      organizationId: null,
      userId: ctx.user.id,
      username: ctx.user.username,
      action: 'LOGOUT',
    });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const ctx = authed(req);
    return {
      user: {
        id: ctx.user.id,
        username: ctx.user.username,
        email: ctx.user.email,
        displayName: ctx.user.displayName,
        isSuperAdmin: ctx.user.isSuperAdmin,
        mustChangePassword: ctx.user.mustChangePassword,
      },
      roles: ctx.roles,
    };
  });

  app.post('/api/auth/password', async (req) => {
    const ctx = authed(req);
    const input = changePasswordSchema.parse(body(req));
    changePassword(req.db, ctx.user.id, input.currentPassword, input.newPassword);
    audit(req.db, {
      organizationId: null,
      userId: ctx.user.id,
      username: ctx.user.username,
      action: 'PASSWORD_CHANGED',
    });
    return { ok: true };
  });
}