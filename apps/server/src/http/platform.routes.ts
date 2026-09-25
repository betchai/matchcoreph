import type { FastifyInstance } from 'fastify';
import {
  createOrganization,
  listOrganizations,
  orgById,
  organizationStats,
  updateOrganization,
} from '../services/orgs.js';
import {
  createUser,
  listOrgUsers,
  roleLabel,
  setLocked,
  setOrgRole,
  removeOrgRole,
  userById,
} from '../services/users.js';
import {
  createRuleset,
  duplicateRuleset,
  getRuleset,
  listRulesets,
  rulesetView,
  setRulesetStatus,
  updateRulesetParameters,
  listDivisions,
  listCategories,
  availableDisciplines,
} from '../services/rulesets.js';
import { listAudit } from '../services/audit.js';
import { createShooter, importShootersCsv, listShooters, shooterById, updateShooter } from '../services/shooters.js';
import { authed, body, orgScope, param, platformScope, queryStr, requireAnyPermission } from './helpers.js';
import {
  csvImportSchema,
  organizationCreateSchema,
  organizationUpdateSchema,
  rulesetCreateSchema,
  rulesetDuplicateSchema,
  rulesetUpdateParamsSchema,
  shooterCreateSchema,
  userCreateSchema,
} from '@blinkscore/core';

export function platformRoutes(app: FastifyInstance): void {
  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

  app.get('/api/platform/stats', async (req) => {
    platformScope(req, 'platform.manage');
    const orgs = (req.db.prepare('SELECT count(*) c FROM organizations').get() as { c: number }).c;
    const users = (req.db.prepare('SELECT count(*) c FROM users').get() as { c: number }).c;
    const matches = (req.db.prepare('SELECT count(*) c FROM matches').get() as { c: number }).c;
    const shooters = (req.db.prepare('SELECT count(*) c FROM shooters').get() as { c: number }).c;
    const scores = (req.db.prepare('SELECT count(*) c FROM scores').get() as { c: number }).c;
    const rulesets = (req.db.prepare('SELECT count(*) c FROM rulesets').get() as { c: number }).c;
    return { organizations: Number(orgs), users: Number(users), matches: Number(matches), shooters: Number(shooters), scores: Number(scores), rulesets: Number(rulesets) };
  });

  // ── Shooters (platform-wide roster, shared by every organization) ─────────

  app.get('/api/shooters', async (req) => {
    requireAnyPermission(req, 'shooter.view');
    return listShooters(req.db, queryStr(req, 'search'));
  });

  app.get('/api/shooters/:shooterId', async (req) => {
    requireAnyPermission(req, 'shooter.view');
    return shooterById(req.db, param(req, 'shooterId'));
  });

  app.post('/api/shooters', async (req) => {
    const ctx = requireAnyPermission(req, 'shooter.manage');
    const input = shooterCreateSchema.parse(body(req));
    return createShooter(req.db, input, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.patch('/api/shooters/:shooterId', async (req) => {
    // Only platform administrators may edit an existing shooter.
    const ctx = requireAnyPermission(req, 'shooter.edit');
    const input = shooterCreateSchema.partial().parse(body(req));
    return updateShooter(req.db, param(req, 'shooterId'), input, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.post('/api/shooters/import', async (req) => {
    const ctx = requireAnyPermission(req, 'shooter.manage');
    const input = csvImportSchema.parse(body(req));
    return importShootersCsv(req.db, input.rows, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.get('/api/platform/orgs', async (req) => {
    platformScope(req, 'platform.manage');
    return listOrganizations(req.db);
  });

  app.post('/api/platform/orgs', async (req) => {
    const ctx = platformScope(req, 'platform.manage');
    const input = organizationCreateSchema.parse(body(req));
    return createOrganization(req.db, input, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.get('/api/orgs/me', async (req) => {
    const ctx = authed(req);
    if (ctx.user.isSuperAdmin) return listOrganizations(req.db).map((o) => ({ ...o, role: 'PLATFORM_SUPER_ADMIN' }));
    const orgIds = ctx.roles.filter((r) => r.organizationId !== '*').map((r) => r.organizationId);
    return orgIds.map((id) => {
      const org = orgById(req.db, id);
      const role = ctx.roles.find((r) => r.organizationId === id)?.role ?? null;
      return { ...org, role: role ? roleLabel(role) : role };
    });
  });

  app.get('/api/orgs/:orgId', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'org.view');
    return orgById(req.db, orgId);
  });

  app.get('/api/orgs/:orgId/stats', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'org.view');
    return organizationStats(req.db, orgId);
  });

  app.patch('/api/orgs/:orgId', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'org.manage');
    const input = organizationUpdateSchema.parse(body(req));
    return updateOrganization(req.db, orgId, input, { userId: ctx.user.id, username: ctx.user.username });
  });

  // ── Organization users ────────────────────────────────────────────────────

  app.get('/api/orgs/:orgId/users', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'org.users.manage');
    return listOrgUsers(req.db, orgId);
  });

  app.post('/api/orgs/:orgId/users', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'org.users.manage');
    const input = userCreateSchema.parse(body(req));
    const user = createUser(req.db, { ...input, organizationId: orgId }, { userId: ctx.user.id, username: ctx.user.username });
    return { ...user, role: input.role };
  });

  app.patch('/api/orgs/:orgId/users/:userId/role', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'org.users.manage');
    const userId = param(req, 'userId');
    const { role } = body<{ role: string }>(req);
    userById(req.db, userId);
    setOrgRole(req.db, userId, orgId, role as never, { userId: ctx.user.id, username: ctx.user.username }, orgById(req.db, orgId).name);
    return { ok: true };
  });

  app.patch('/api/orgs/:orgId/users/:userId/locked', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'org.users.manage');
    const userId = param(req, 'userId');
    const { locked } = body<{ locked: boolean }>(req);
    return setLocked(req.db, userId, Boolean(locked));
  });

  app.delete('/api/orgs/:orgId/users/:userId/role', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'org.users.manage');
    const userId = param(req, 'userId');
    if (userId === authed(req).user.id) throw new Error('Cannot remove your own role.');
    removeOrgRole(req.db, userId, orgId);
    return { ok: true };
  });

  // ── Rulesets & reference data ─────────────────────────────────────────────

  app.get('/api/disciplines', async (req) => {
    authed(req);
    return availableDisciplines(req.db);
  });

  app.get('/api/rulesets', async (req) => {
    requireAnyPermission(req, 'ruleset.view');
    const discipline = queryStr(req, 'discipline');
    return listRulesets(req.db, discipline as never);
  });

  app.get('/api/rulesets/:rulesetId', async (req) => {
    requireAnyPermission(req, 'ruleset.view');
    return rulesetView(req.db, param(req, 'rulesetId'));
  });

  app.post('/api/rulesets', async (req) => {
    const ctx = platformScope(req, 'ruleset.manage');
    const input = rulesetCreateSchema.parse(body(req));
    return createRuleset(req.db, input, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.post('/api/rulesets/:rulesetId/duplicate', async (req) => {
    const ctx = platformScope(req, 'ruleset.manage');
    const input = rulesetDuplicateSchema.parse(body(req));
    return duplicateRuleset(req.db, param(req, 'rulesetId'), input.version, input.effectiveDate, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.patch('/api/rulesets/:rulesetId/status', async (req) => {
    platformScope(req, 'ruleset.manage');
    const { status } = body<{ status: 'ACTIVE' | 'INACTIVE' }>(req);
    return setRulesetStatus(req.db, param(req, 'rulesetId'), status);
  });

  app.patch('/api/rulesets/:rulesetId/parameters', async (req) => {
    const ctx = platformScope(req, 'ruleset.manage');
    const input = rulesetUpdateParamsSchema.parse(body(req));
    return updateRulesetParameters(req.db, param(req, 'rulesetId'), input.parameters, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.get('/api/rulesets/:rulesetId/divisions', async (req) => {
    requireAnyPermission(req, 'ruleset.view');
    return listDivisions(req.db, param(req, 'rulesetId'));
  });

  app.get('/api/rulesets/:rulesetId/categories', async (req) => {
    requireAnyPermission(req, 'ruleset.view');
    return listCategories(req.db, param(req, 'rulesetId'));
  });

  // ── Audit ─────────────────────────────────────────────────────────────────

  app.get('/api/platform/audit', async (req) => {
    platformScope(req, 'platform.viewAudit');
    const page = queryStr(req, 'page');
    const size = queryStr(req, 'pageSize');
    return listAudit(req.db, { limit: Math.min(200, Number(size ?? 50) || 50), offset: ((Number(page ?? 1) || 1) - 1) * 50 });
  });
}