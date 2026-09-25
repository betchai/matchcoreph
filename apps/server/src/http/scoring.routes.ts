import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getMatch } from '../services/matches.js';
import {
  applyCorrection,
  computeStageScoreForRegistration,
  enterScore,
  getScore,
  listDisputes,
  listScores,
  openDispute,
  resolveDispute,
  syncBatch,
  workflowScore,
  type EnterScoreInput,
} from '../services/scores.js';
import {
  getDivisionStandings,
  getMatchResults,
  getStageResults,
  listStageSummaries,
} from '../services/results.js';
import {
  addComponent,
  computeTournamentStandings,
  getTournamentView,
  listComponents,
  removeComponent,
  setAggregateMethod,
  updateComponentWeight,
} from '../services/tournaments.js';
import { listChronographSessions, recordChronograph } from '../services/chronograph.js';
import { matchResultsCsv, matchScorecardsCsv, stageScorecardsHtml, standingsHtml, certificatesHtml } from '../services/reports.js';
import { body, orgScope, param, queryStr, requireAnyPermission } from './helpers.js';
import { getRegistration, resetRegistrationPin } from '../services/registrations.js';
import { getStage } from '../services/stages.js';
import {
  chronographSchema,
  disputeOpenSchema,
  disputeResolveSchema,
  idSchema,
  scoreCorrectionSchema,
  scoreEntrySchema,
  scoreVerifySchema,
  scoreSubmitSchema,
  syncBatchSchema,
  tournamentAggregateSchema,
  tournamentComponentSchema,
} from '@blinkscore/core';
import { z } from 'zod';

const previewTargetSchema = z.object({
  targetId: idSchema,
  zoneHits: z.array(z.enum(['A', 'C', 'D'])).optional(),
  hits: z.number().min(0).optional(),
  steelMisses: z.number().min(0).optional(),
  noShootHits: z.number().min(0).optional(),
});

const previewScoreSchema = z.object({
  registrationId: idSchema,
  stageId: idSchema,
  timeSeconds: z.number().nullable().optional(),
  targets: z.array(previewTargetSchema).optional(),
  misses: z.number().min(0).optional(),
  paperNoShoots: z.number().min(0).optional(),
  procedurals: z.number().min(0).optional(),
  penaltiesOther: z.number().min(0).optional(),
  shotsFired: z.number().min(0).nullable().optional(),
});

function loadMatch(req: FastifyRequest, orgId: string, matchId: string) {
  return getMatch(req.db, orgId, matchId);
}

function sendFile(reply: FastifyReply, content: string, contentType: string, filename: string): FastifyReply {
  return reply
    .type(contentType)
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .header('X-Content-Type-Options', 'nosniff')
    .send(content);
}

export function scoringRoutes(app: FastifyInstance): void {
  // ── Score entry & workflow ─────────────────────────────────────────────────

  app.get('/api/orgs/:orgId/matches/:matchId/scores', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'score.view');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return listScores(req.db, m, {
      stageId: queryStr(req, 'stageId'),
      registrationId: queryStr(req, 'registrationId'),
      status: queryStr(req, 'status'),
    });
  });

  app.get('/api/orgs/:orgId/matches/:matchId/scores/:scoreId', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'score.view');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return getScore(req.db, m, param(req, 'scoreId'));
  });

  app.post('/api/orgs/:orgId/matches/:matchId/scores', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'score.enter');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = scoreEntrySchema.parse(body(req));
    const out = enterScore(req.db, m, input, { userId: ctx.user.id, username: ctx.user.username });
    return { scoreId: out.score.id, status: out.score.status, hitFactor: out.hitFactor, finalTimeSeconds: out.finalTimeSeconds, valid: out.valid, configErrors: out.configErrors, warnings: out.warnings };
  });

  app.post('/api/orgs/:orgId/matches/:matchId/scores/submit', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'score.submit');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = scoreSubmitSchema.parse(body(req));
    const out = enterScore(req.db, m, { ...input, status: 'SUBMITTED' }, { userId: ctx.user.id, username: ctx.user.username });
    return { scoreId: out.score.id, status: out.score.status, hitFactor: out.hitFactor, finalTimeSeconds: out.finalTimeSeconds, valid: out.valid, warnings: out.warnings };
  });

  app.post('/api/orgs/:orgId/matches/:matchId/scores/preview', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'score.submit');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = previewScoreSchema.parse(body(req));
    const stage = getStage(req.db, m, input.stageId);
    const registration = getRegistration(req.db, m, input.registrationId);
    const out = computeStageScoreForRegistration(req.db, m, stage, registration, {
      timeSeconds: input.timeSeconds ?? null,
      targets: input.targets ?? [],
      misses: input.misses ?? 0,
      paperNoShoots: input.paperNoShoots ?? 0,
      procedurals: input.procedurals ?? 0,
      penaltiesOther: input.penaltiesOther ?? 0,
      shotsFired: input.shotsFired ?? null,
    });
    return {
      valid: out.calculation.valid,
      hitFactor: out.hitFactor,
      finalTimeSeconds: out.finalTimeSeconds,
      rawPoints: out.calculation.rawPoints,
      penaltyPoints: out.calculation.penaltyPoints,
      netPoints: out.calculation.netPoints,
      timeSeconds: out.calculation.timeSeconds,
      timeAdjustmentsSeconds: out.calculation.timeAdjustmentsSeconds,
      warnings: out.calculation.warnings,
    };
  });

  app.post('/api/orgs/:orgId/matches/:matchId/scores/forgot-pin', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'score.submit');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = body<{ registrationId?: string; pin?: string }>(req);
    const registration = getRegistration(req.db, m, String(input.registrationId ?? ''));
    const updated = resetRegistrationPin(req.db, m, registration, String(input.pin ?? ''), {
      userId: ctx.user.id,
      username: ctx.user.username,
    });
    return { registrationId: updated.id, hasScorePin: updated.hasScorePin };
  });

  app.post('/api/orgs/:orgId/matches/:matchId/scores/sync', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'score.enter');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = syncBatchSchema.parse(body(req));
    const entries: EnterScoreInput[] = input.scores.map((s) => ({
      stageId: s.stageId,
      registrationId: s.registrationId,
      timeSeconds: s.timeSeconds,
      targets: s.targets,
      misses: s.misses,
      paperNoShoots: s.paperNoShoots,
      procedurals: s.procedurals,
      penaltiesOther: s.penaltiesOther,
      shotsFired: s.shotsFired,
      status: 'SUBMITTED',
      syncToken: s.syncToken,
    }));
    return { results: syncBatch(req.db, m, entries, { userId: ctx.user.id, username: ctx.user.username }) };
  });

  app.patch('/api/orgs/:orgId/matches/:matchId/scores/:scoreId/workflow', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'score.view');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const score = getScore(req.db, m, param(req, 'scoreId'));
    const input = scoreVerifySchema.parse(body(req));
    const perm = input.action === 'VERIFY' || input.action === 'REJECT' ? 'score.verify' : input.action === 'LOCK' ? 'score.lock' : 'score.unlock';
    orgScope(req, orgId, perm);
    const updated = workflowScore(req.db, m, score, input.action, { userId: ctx.user.id, username: ctx.user.username }, input.reason);
    return { scoreId: updated.id, status: updated.status };
  });

  app.post('/api/orgs/:orgId/matches/:matchId/scores/:scoreId/correct', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'score.correct');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const score = getScore(req.db, m, param(req, 'scoreId'));
    const input = scoreCorrectionSchema.parse(body(req));
    const platformAuthority =
      ctx.user.isSuperAdmin ||
      ctx.roles.some((r) => r.organizationId === '*' && (r.role === 'PLATFORM_ADMIN' || r.role === 'PLATFORM_SUPER_ADMIN'));
    const out = applyCorrection(
      req.db,
      m,
      score,
      { field: input.field, previousValue: input.previousValue ?? null, newValue: input.newValue, reason: input.reason, authorization: input.authorization },
      { userId: ctx.user.id, username: ctx.user.username },
      { platformAuthority },
    );
    return { scoreId: out.score.id, status: out.score.status, correctionId: out.correctionId };
  });

  // ── Disputes ──────────────────────────────────────────────────────────────

  app.post('/api/orgs/:orgId/matches/:matchId/scores/:scoreId/dispute', async (req) => {
    const ctx = requireAnyPermission(req, 'dispute.raise.own');
    const { orgId } = orgScope(req, param(req, 'orgId'), 'score.view');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const score = getScore(req.db, m, param(req, 'scoreId'));
    const input = disputeOpenSchema.parse(body(req));
    const disputeId = openDispute(req.db, m, score, input, { userId: ctx.user.id, username: ctx.user.username });
    return { disputeId };
  });

  app.get('/api/orgs/:orgId/matches/:matchId/disputes', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'disputes.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return listDisputes(req.db, m);
  });

  app.post('/api/orgs/:orgId/matches/:matchId/disputes/:disputeId/resolve', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'disputes.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = disputeResolveSchema.parse(body(req));
    return resolveDispute(req.db, m, param(req, 'disputeId'), input.decision, input.resolution, { userId: ctx.user.id, username: ctx.user.username });
  });

  // ── Chronograph ───────────────────────────────────────────────────────────

  app.post('/api/orgs/:orgId/matches/:matchId/chrono', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'chronograph.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = chronographSchema.parse(body(req));
    return recordChronograph(req.db, m, input, { userId: ctx.user.id, username: ctx.user.username });
  });

  app.get('/api/orgs/:orgId/matches/:matchId/chrono', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'chronograph.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return listChronographSessions(req.db, m);
  });

  // ── Results ───────────────────────────────────────────────────────────────

  app.get('/api/orgs/:orgId/matches/:matchId/results', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'results.live');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return getMatchResults(req.db, m);
  });

  app.get('/api/orgs/:orgId/matches/:matchId/results/division/:divisionId', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'results.live');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return getDivisionStandings(req.db, m, param(req, 'divisionId'));
  });

  app.get('/api/orgs/:orgId/matches/:matchId/results/stages', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'results.live');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return listStageSummaries(req.db, m);
  });

  app.get('/api/orgs/:orgId/matches/:matchId/results/stages/:stageId', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'results.live');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return getStageResults(req.db, m, param(req, 'stageId'));
  });

  // ── Tournaments ───────────────────────────────────────────────────────────

  app.get('/api/orgs/:orgId/matches/:matchId/components', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'match.view');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return listComponents(req.db, m);
  });

  app.post('/api/orgs/:orgId/matches/:matchId/components', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'match.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = tournamentComponentSchema.parse(body(req));
    addComponent(req.db, m, input.componentMatchId, input.weight, { userId: ctx.user.id, username: ctx.user.username });
    return listComponents(req.db, m);
  });

  app.patch('/api/orgs/:orgId/matches/:matchId/components/:componentId', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'match.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const { weight } = body<{ weight: number }>(req);
    updateComponentWeight(req.db, m, param(req, 'componentId'), weight, { userId: ctx.user.id, username: ctx.user.username });
    return listComponents(req.db, m);
  });

  app.delete('/api/orgs/:orgId/matches/:matchId/components/:componentId', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'match.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    removeComponent(req.db, m, param(req, 'componentId'), { userId: ctx.user.id, username: ctx.user.username });
    return { ok: true };
  });

  app.post('/api/orgs/:orgId/matches/:matchId/aggregate', async (req) => {
    const { ctx, orgId } = orgScope(req, param(req, 'orgId'), 'match.manage');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    const input = tournamentAggregateSchema.parse(body(req));
    setAggregateMethod(req.db, m, input.aggregateMethod, { userId: ctx.user.id, username: ctx.user.username });
    return computeTournamentStandings(req.db, m, input.aggregateMethod);
  });

  app.get('/api/orgs/:orgId/matches/:matchId/tournament', async (req) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'match.view');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return getTournamentView(req.db, m);
  });

  // ── Reports ───────────────────────────────────────────────────────────────

  app.get('/api/orgs/:orgId/matches/:matchId/reports/results.csv', async (req, reply) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'reports.generate');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return sendFile(reply, matchResultsCsv(req.db, m), 'text/csv; charset=utf-8', `results-${m.id}.csv`);
  });

  app.get('/api/orgs/:orgId/matches/:matchId/reports/scorecards.csv', async (req, reply) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'reports.generate');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return sendFile(reply, matchScorecardsCsv(req.db, m), 'text/csv; charset=utf-8', `scorecards-${m.id}.csv`);
  });

  app.get('/api/orgs/:orgId/matches/:matchId/reports/results.html', async (req, reply) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'reports.generate');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return sendFile(reply, standingsHtml(req.db, m), 'text/html; charset=utf-8', `results-${m.id}.html`);
  });

  app.get('/api/orgs/:orgId/matches/:matchId/reports/scorecards.html', async (req, reply) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'reports.generate');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return sendFile(reply, stageScorecardsHtml(req.db, m), 'text/html; charset=utf-8', `scorecards-${m.id}.html`);
  });

  app.get('/api/orgs/:orgId/matches/:matchId/reports/certificates.html', async (req, reply) => {
    const { orgId } = orgScope(req, param(req, 'orgId'), 'reports.generate');
    const m = loadMatch(req, orgId, param(req, 'matchId'));
    return sendFile(reply, certificatesHtml(req.db, m), 'text/html; charset=utf-8', `certificates-${m.id}.html`);
  });
}