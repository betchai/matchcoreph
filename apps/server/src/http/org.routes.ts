import type { FastifyInstance } from 'fastify';
import {
  createMatch,
  deleteMatch,
  getMatch,
  listMatches,
  matchControlStats,
  matchView,
  publishMatch,
  setMatchDisciplines,
  setMatchDivisionsCategories,
  setMatchRuleset,
  setMatchStatus,
  updateMatch,
  wizardState,
} from '../services/matches.js';
import {
  createStage,
  deleteStage,
  getStage,
  listStages,
  setStageTargets,
  stageTargets,
  updateStage,
} from '../services/stages.js';
import {
  batchRegistrationStatuses,
  checkIn,
  getRegistration,
  listAttendance,
  listRegistrations,
  registerCompetitor,
  setRegistrationStatus,
  updateRegistration,
} from '../services/registrations.js';
import {
  createSquad,
  updateSquad,
  deleteSquad,
  getSquad,
  listSquads,
  squadOverview,
} from '../services/squads.js';
import { body, authed, orgScope, param, queryStr } from './helpers.js';
import { canInOrg } from '../services/auth.js';
import { forbidden } from '../services/utils.js';
import {
  checkinSchema,
  competitorStatusBatchSchema,
  matchDisciplinesSchema,
  matchDivisionsCategoriesSchema,
  matchRulesetSchema,
  matchStep1Schema,
  registrationSchema,
  registrationsBulkSchema,
  squadCreateSchema,
  stageCreateSchema,
  stageTargetsSchema,
  statusChangeSchema,
} from '@blinkscore/core';

function loadMatch(req: { db: import('../db/client.js').Db }, orgId: string, matchId: string) {
  return getMatch(req.db, orgId, matchId);
}

export function orgRoutes(app: FastifyInstance): void {
  // ── Matches (wizard) ──────────────────────────────────────────────────────

  app.post('/api/orgs/:orgId/matches', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'match.create');
    const input = matchStep1Schema.parse(body(req));
    return matchView(req.db, createMatch(req.db, orgId, input, { userId: ctx.user.id, username: ctx.user.username }));
  });

  app.get('/api/orgs/:orgId/matches', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'match.view');
    return listMatches(req.db, orgId, {
      status: queryStr(req, 'status'),
      type: queryStr(req, 'type'),
      search: queryStr(req, 'search'),
    });
  });

  app.get('/api/orgs/:orgId/matches/:matchId', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'match.view');
    return matchView(req.db, loadMatch(req, orgId, param(req, 'matchId')));
  });

  app.get('/api/orgs/:orgId/matches/:matchId/wizard', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'match.view');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return wizardState(req.db, m);
  });

  app.get('/api/orgs/:orgId/matches/:matchId/control', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'match.view');
    return matchControlStats(req.db, loadMatch(req, orgId, param(req, 'matchId')));
  });

  app.patch('/api/orgs/:orgId/matches/:matchId', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'match.edit');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = matchStep1Schema.partial().parse(body(req));
    return matchView(req.db, updateMatch(req.db, m, input, { userId: ctx.user.id, username: ctx.user.username }));
  });

  app.post('/api/orgs/:orgId/matches/:matchId/disciplines', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'match.configure');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = matchDisciplinesSchema.parse(body(req));
    setMatchDisciplines(req.db, m, input.disciplines, { userId: ctx.user.id, username: ctx.user.username });
    return matchView(req.db, getMatch(req.db, orgId, m.id));
  });

  app.post('/api/orgs/:orgId/matches/:matchId/ruleset', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'match.configure');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = matchRulesetSchema.parse(body(req));
    const updated = setMatchRuleset(req.db, m, input.rulesetId, { userId: ctx.user.id, username: ctx.user.username });
    return matchView(req.db, updated);
  });

  app.post('/api/orgs/:orgId/matches/:matchId/divisions-categories', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'match.configure');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = matchDivisionsCategoriesSchema.parse(body(req));
    setMatchDivisionsCategories(req.db, m, input, { userId: ctx.user.id, username: ctx.user.username });
    return matchView(req.db, getMatch(req.db, orgId, m.id));
  });

  app.post('/api/orgs/:orgId/matches/:matchId/publish', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'match.publish');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return matchView(req.db, publishMatch(req.db, m, { userId: ctx.user.id, username: ctx.user.username }));
  });

  app.post('/api/orgs/:orgId/matches/:matchId/status', async (req) => {
    const orgId = param(req, 'orgId');
    const ctx = authed(req);
    const target = String(body<{ status?: unknown }>(req).status ?? '');
    // Full status control needs match.manage; hiding/cancelling (ARCHIVED/CANCELLED)
    // is additionally available to holders of match.archive (e.g. platform admins).
    const canFull = canInOrg(ctx, orgId, 'match.manage');
    const canArchive = canInOrg(ctx, orgId, 'match.archive') && (target === 'ARCHIVED' || target === 'CANCELLED');
    if (!canFull && !canArchive) {
      throw forbidden(`Insufficient permissions for match.manage in this organization.`);
    }
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return matchView(req.db, setMatchStatus(req.db, m, target as never, { userId: ctx.user.id, username: ctx.user.username }));
  });

  app.delete('/api/orgs/:orgId/matches/:matchId', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'match.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    deleteMatch(req.db, m, { userId: ctx.user.id, username: ctx.user.username });
    return { ok: true };
  });

  // ── Stages ────────────────────────────────────────────────────────────────

  app.post('/api/orgs/:orgId/matches/:matchId/stages', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'stage.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = stageCreateSchema.parse(body(req));
    return createStage(req.db, m, input as never, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.get('/api/orgs/:orgId/matches/:matchId/stages', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'match.view');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return listStages(req.db, m);
  });

  app.get('/api/orgs/:orgId/matches/:matchId/stages/:stageId', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'match.view');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return getStage(req.db, m, param(req, 'stageId'));
  });

  app.get('/api/orgs/:orgId/matches/:matchId/stages/:stageId/targets', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'match.view');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const stage = getStage(req.db, m, param(req, 'stageId'));
    return stageTargets(req.db, stage.id);
  });

  app.patch('/api/orgs/:orgId/matches/:matchId/stages/:stageId', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'stage.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const stage = getStage(req.db, m, param(req, 'stageId'));
    const input = stageCreateSchema.partial().parse(body(req));
    return updateStage(req.db, m, stage, input, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.put('/api/orgs/:orgId/matches/:matchId/stages/:stageId/targets', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'stage.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const stage = getStage(req.db, m, param(req, 'stageId'));
    const input = stageTargetsSchema.parse(body(req));
    return setStageTargets(req.db, m, stage, input.targets, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.delete('/api/orgs/:orgId/matches/:matchId/stages/:stageId', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'stage.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const stage = getStage(req.db, m, param(req, 'stageId'));
    deleteStage(req.db, m, stage, { userId: ctx.user.id, username: ctx.user.username });
    return { ok: true };
  });

  // ── Squads ────────────────────────────────────────────────────────────────

  app.post('/api/orgs/:orgId/matches/:matchId/squads', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'squad.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = squadCreateSchema.parse(body(req));
    return createSquad(req.db, m, input, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.get('/api/orgs/:orgId/matches/:matchId/squads', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'match.view');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return listSquads(req.db, m);
  });

  app.get('/api/orgs/:orgId/matches/:matchId/squads/overview', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'match.view');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return squadOverview(req.db, m);
  });

  app.get('/api/orgs/:orgId/matches/:matchId/squads/:squadId', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'match.view');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return getSquad(req.db, m, param(req, 'squadId'));
  });

  app.patch('/api/orgs/:orgId/matches/:matchId/squads/:squadId', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'squad.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = squadCreateSchema.partial().parse(body(req));
    return updateSquad(req.db, m, param(req, 'squadId'), input, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.delete('/api/orgs/:orgId/matches/:matchId/squads/:squadId', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'squad.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    deleteSquad(req.db, m, param(req, 'squadId'), { userId: ctx.user.id, username: ctx.user.username });
    return { ok: true };
  });

  // ── Registrations ─────────────────────────────────────────────────────────

  app.post('/api/orgs/:orgId/matches/:matchId/registrations', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'competitor.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = registrationSchema.parse(body(req));
    return registerCompetitor(req.db, m, input, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.post('/api/orgs/:orgId/matches/:matchId/registrations/bulk', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'competitor.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = registrationsBulkSchema.parse(body(req));
    const results = [];
    for (const r of input.registrations) {
      try {
        results.push({ ok: true, registration: registerCompetitor(req.db, m, r, { userId: ctx.user.id, username: ctx.user.username }) });
      } catch (err) {
        results.push({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return results;
  });

  app.get('/api/orgs/:orgId/matches/:matchId/registrations', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'match.view');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return listRegistrations(req.db, m, {
      divisionId: queryStr(req, 'divisionId'),
      squadId: queryStr(req, 'squadId'),
      status: queryStr(req, 'status'),
      search: queryStr(req, 'search'),
    });
  });

  app.get('/api/orgs/:orgId/matches/:matchId/registrations/:registrationId', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'match.view');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return getRegistration(req.db, m, param(req, 'registrationId'));
  });

  app.patch('/api/orgs/:orgId/matches/:matchId/registrations/:registrationId', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'competitor.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const reg = getRegistration(req.db, m, param(req, 'registrationId'));
    const input = registrationSchema.partial().parse(body(req));
    return updateRegistration(req.db, m, reg, {
      divisionId: input.divisionId as never,
      categoryId: input.categoryId as never,
      declaredPowerFactor: input.declaredPowerFactor as never,
      squadId: input.squadId as never,
      matchNumber: input.matchNumber as never,
      scorePin: input.scorePin as never,
    }, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.patch('/api/orgs/:orgId/matches/:matchId/registrations/:registrationId/status', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'competitor.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const reg = getRegistration(req.db, m, param(req, 'registrationId'));
    const input = statusChangeSchema.parse(body(req));
    return setRegistrationStatus(req.db, m, reg, input.status, input.reason, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.post('/api/orgs/:orgId/matches/:matchId/registrations/status-batch', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'competitor.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = competitorStatusBatchSchema.parse(body(req));
    batchRegistrationStatuses(req.db, m, input.registrations.map((r) => ({ registrationId: r.registrationId, status: r.status, reason: r.reason })), { userId: ctx.user.id, username: ctx.user.username });
    return { ok: true, applied: input.registrations.length };
  });

  app.post('/api/orgs/:orgId/matches/:matchId/checkin', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'checkin.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = checkinSchema.parse(body(req));
    const reg = getRegistration(req.db, m, input.registrationId);
    return checkIn(req.db, m, reg, input.squadId ?? null, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.get('/api/orgs/:orgId/matches/:matchId/attendance', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'checkin.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return listAttendance(req.db, m);
  });
}