import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { createUser } from '../src/services/users.js';
import { createOrganization } from '../src/services/orgs.js';
import { createRuleset, seedCategoriesForRuleset, seedDivisionsForRuleset } from '../src/services/rulesets.js';
import { createMatch, setMatchDisciplines, setMatchRuleset, setMatchDivisionsCategories, publishMatch } from '../src/services/matches.js';
import { createStage, setStageTargets } from '../src/services/stages.js';
import { createSquad } from '../src/services/squads.js';
import { createShooter } from '../src/services/shooters.js';
import { registerCompetitor } from '../src/services/registrations.js';
import { authed, closeUniverse, login, openTestDb, type TestUniverse } from './helpers.js';

interface PsmocUniverse extends TestUniverse {
  stages: { full: string; min: string; time: string };
  targets: Record<string, string[]>;
  dbFile: string;
}

const TARGETS = [
  { number: 1, targetType: 'PAPER', requiredHits: 2 },
  { number: 2, targetType: 'PAPER', requiredHits: 2 },
  { number: 3, targetType: 'POPPER', requiredHits: 1 },
];

async function seedPsmocUniverse(): Promise<PsmocUniverse> {
  const { db, dbFile } = openTestDb();
  const actor = { userId: 'seed', username: 'seed' };
  createUser(db, { username: 'admin', email: 'admin@t.example', password: 'admin-pw', displayName: 'Admin', role: 'PLATFORM_SUPER_ADMIN', isSuperAdmin: true }, actor);
  const org = createOrganization(db, { name: 'Test Org', shortName: 'TST' }, actor);
  createUser(db, { username: 'orgadmin', email: 'orgadmin@t.example', password: 'org-pw', displayName: 'Org Admin', role: 'ORGANIZATION_ADMIN', organizationId: org.id }, actor);

  const ruleset = createRuleset(db, { organizationId: null, name: 'PSMOC Handgun Rules', organizationCode: 'PSMOC', discipline: 'HANDGUN', version: '2026', effectiveDate: '2026-01-01', seedDivisionsAndCategories: true }, actor);
  seedDivisionsForRuleset(db, ruleset.id, 'HANDGUN', actor);
  seedCategoriesForRuleset(db, ruleset.id, 'HANDGUN', actor);

  const divisions = db.prepare('SELECT id, name FROM divisions WHERE ruleset_id = ?').all(ruleset.id) as { id: string; name: string }[];
  const cats = db.prepare('SELECT id, name FROM categories WHERE ruleset_id = ?').all(ruleset.id) as { id: string; name: string }[];
  const prod = divisions.find((d) => d.name === 'Production')!.id;
  const open = divisions.find((d) => d.name === 'Open')!.id;
  void open;
  const overall = cats.find((c) => c.name === 'Overall')!.id;

  const match = createMatch(db, org.id, { name: 'PSMOC Club Shoot', matchType: 'CLUB_SHOOT', startDate: '2026-06-01', venue: 'Range', matchLevel: 1, sanctioningStatus: 'CLUB' }, actor);
  setMatchDisciplines(db, match, ['HANDGUN'], actor);
  const configured = setMatchRuleset(db, match, ruleset.id, actor);
  setMatchDivisionsCategories(db, configured, { divisionIds: [prod], categoryIds: [overall] }, actor);

  const stageFull = createStage(db, configured, { number: 1, name: 'Full Load PF', courseType: 'SHORT', scoringMethod: 'PSMOC_POINTS_FACTOR', loadType: 'FULL_LOAD', minimumRounds: 4, maximumRounds: 4, maximumStagePoints: 25 }, actor);
  const stageMin = createStage(db, configured, { number: 2, name: 'Min Load PF', courseType: 'SHORT', scoringMethod: 'PSMOC_POINTS_FACTOR', loadType: 'MINIMUM_LOAD', minimumRounds: 4, maximumRounds: 4, maximumStagePoints: 25 }, actor);
  const stageTime = createStage(db, configured, { number: 3, name: 'Speed', courseType: 'SHORT', scoringMethod: 'PSMOC_TIME', minimumRounds: 4, maximumRounds: 4, maximumStagePoints: 25 }, actor);
  const hits: Record<string, string[]> = { full: [], min: [], time: [] };
  for (const [key, stage] of [['full', stageFull], ['min', stageMin], ['time', stageTime]] as const) {
    setStageTargets(db, configured, stage, TARGETS, actor);
    hits[key] = (db.prepare('SELECT id FROM stage_targets WHERE stage_id = ? ORDER BY number').all(stage.id) as { id: string }[]).map((t) => t.id);
  }

  const squad = createSquad(db, configured, { name: 'Squad A' }, actor);
  const registrationIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const shooter = createShooter(db, { firstName: `Psmoc${i}`, lastName: `Last${i}`, email: `ps${i}@t.example` }, actor);
    const reg = registerCompetitor(db, configured, { shooterId: shooter.id, divisionId: prod, categoryId: overall, declaredPowerFactor: 'MINOR', squadId: squad.id, scorePin: '1234' }, actor);
    registrationIds.push(reg.id);
  }

  publishMatch(db, configured, actor);

  const app = buildApp(db, { webDist: '/nonexistent-dist' });
  const superToken = await login(app, 'admin', 'admin-pw');
  const adminToken = await login(app, 'orgadmin', 'org-pw');

  return {
    db,
    app,
    orgId: org.id,
    matchId: configured.id,
    stageId: stageFull.id,
    superToken,
    adminToken,
    registrationIds,
    targetIds: hits.full,
    stages: { full: stageFull.id, min: stageMin.id, time: stageTime.id },
    targets: hits,
    dbFile,
  };
}

function psmocPayload(u: PsmocUniverse, stage: 'full' | 'min' | 'time', registrationId: string, opts: { timeSeconds?: number; zone2?: string; shotsFired?: number | null } = {}) {
  return {
    matchId: u.matchId,
    stageId: u.stages[stage],
    registrationId,
    timeSeconds: opts.timeSeconds ?? 12.5,
    targets: [
      { targetId: u.targets[stage][0], zoneHits: ['A', 'A'] },
      { targetId: u.targets[stage][1], zoneHits: ['A', opts.zone2 ?? 'C'] },
      { targetId: u.targets[stage][2], hits: 1 },
    ],
    misses: 0,
    paperNoShoots: 0,
    procedurals: 0,
    penaltiesOther: 0,
    shotsFired: opts.shotsFired ?? null,
    status: 'SUBMITTED',
    confirmPin: '1234',
  };
}

let u: PsmocUniverse;

beforeAll(async () => {
  u = await seedPsmocUniverse();
});

afterAll(async () => {
  await closeUniverse(u);
});

describe('PSMOC ruleset defaults', () => {
  it('seeds PSMOC parameters: load tables, unlimited shots, ignore extra hits', async () => {
    const rs = u.db.prepare("SELECT id FROM rulesets WHERE organization_code = 'PSMOC'").get() as { id: string };
    const rows = u.db.prepare('SELECT key, value FROM rule_parameters WHERE ruleset_id = ?').all(rs.id) as { key: string; value: string }[];
    const params = Object.fromEntries(rows.map((p) => [p.key, p.value]));
    expect(params['scoring.paper.fullLoad']).toBe('A:5,C:4,D:2');
    expect(params['scoring.paper.minimumLoad']).toBe('A:5,C:3,D:1');
    expect(params['scoring.psmoc.unlimitedShots']).toBe('true');
    expect(params['scoring.extraHitPolicy']).toBe('IGNORE');
  });

  it('exposes loadType on stages', async () => {
    const stages = (await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/stages` }, u.adminToken))).json();
    expect(stages.find((s: { number: number }) => s.number === 1).loadType).toBe('FULL_LOAD');
    expect(stages.find((s: { number: number }) => s.number === 2).loadType).toBe('MINIMUM_LOAD');
    expect(stages.find((s: { number: number }) => s.number === 3).loadType).toBeNull();
  });
});

describe('PSMOC Points Factor scoring', () => {
  it('scores Full Load with the A:5 C:4 D:2 table', async () => {
    const res = await u.app.inject(authed({ method: 'POST', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/submit`, payload: psmocPayload(u, 'full', u.registrationIds[0]) }, u.adminToken));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hitFactor).toBeCloseTo(24 / 12.5, 3); // full load: A,A=10 + A,C=9 + steel 5 = 24
    expect(body.finalTimeSeconds).toBeNull();
  });

  it('scores Minimum Load with the A:5 C:3 D:1 table', async () => {
    const res = await u.app.inject(authed({ method: 'POST', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/submit`, payload: psmocPayload(u, 'min', u.registrationIds[1]) }, u.adminToken));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hitFactor).toBeCloseTo(23 / 12.5, 3); // minimum load: A,A=10 + A,C=8 + steel 5 = 23
    expect(body.hitFactor).toBeLessThan(24 / 12.5);
  });

  it('permits unlimited shots with no procedural by default', async () => {
    const res = await u.app.inject(authed({ method: 'POST', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/submit`, payload: psmocPayload(u, 'full', u.registrationIds[1], { shotsFired: 6, zone2: 'D' }) }, u.adminToken));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.warnings.some((w: string) => w.includes('unlimited-shots'))).toBe(true);
    // Stored score keeps zero procedurals despite 2 extra shots.
    const score = (await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/${body.scoreId}` }, u.adminToken))).json();
    expect(score.procedurals).toBe(0);
    expect(score.hitFactor).toBeCloseTo(22 / 12.5, 3); // A:5 C:4 D:2 → A,A=10 + A,D=7 + steel 5 = 22
  });
});

describe('PSMOC Time Scoring', () => {
  it('computes final time = raw time + zone adjustments', async () => {
    const res = await u.app.inject(authed({ method: 'POST', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/submit`, payload: psmocPayload(u, 'time', u.registrationIds[0]) }, u.adminToken));
    expect(res.statusCode).toBe(200);
    expect(res.json().finalTimeSeconds).toBe(13.5); // 12.5 + 1 (charlie)
    expect(res.json().hitFactor).toBeNull();

    await u.app.inject(authed({ method: 'POST', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/submit`, payload: psmocPayload(u, 'time', u.registrationIds[1], { timeSeconds: 13.0 }) }, u.adminToken));
  });

  it('sorts stage results by final time and marks the fastest as winner', async () => {
    const res = await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/results/stages/${u.stages.time}` }, u.adminToken));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const rows = body.divisions[0].rows as { registrationId: string; finalTimeSeconds: number | null; timeAdjustmentsSeconds: number | null; isWinner: boolean }[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.registrationId)).toEqual([u.registrationIds[0], u.registrationIds[1]]);
    expect(rows[0].finalTimeSeconds).toBe(13.5);
    expect(rows[1].finalTimeSeconds).toBe(14.0);
    expect(rows[0].isWinner).toBe(true);
    expect(rows[0].timeAdjustmentsSeconds).toBe(1);
  });

  it('never awards stage points for time-scoring stages', async () => {
    const persisted = u.db
      .prepare('SELECT final_time_seconds, stage_points FROM stage_results WHERE stage_id = ?')
      .all(u.stages.time) as { final_time_seconds: number | null; stage_points: number | null }[];
    expect(persisted).toHaveLength(2);
    for (const row of persisted) {
      expect(row.final_time_seconds).not.toBeNull();
      expect(row.stage_points).toBeNull();
    }
  });
});

describe('results surfaces', () => {
  it('reports the time-scoring winner via stage summaries', async () => {
    // Ensure stage results are computed/persisted for every stage first.
    await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/results` }, u.adminToken));
    const res = await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/results/stages` }, u.adminToken));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const time = body.find((s: { scoringMethod: string }) => s.scoringMethod === 'PSMOC_TIME');
    const pf = body.find((s: { scoringMethod: string }) => s.scoringMethod === 'PSMOC_POINTS_FACTOR');
    expect(time.divisionWinnerFinalTime).toBe(13.5);
    expect(time.divisionWinnerHf).toBeNull();
    expect(pf.divisionWinnerFinalTime).toBeNull();
    expect(typeof pf.divisionWinnerHf).toBe('number');
  });

  it('match standings only aggregate points-factor stages', async () => {
    const res = await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/results` }, u.adminToken));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.overall).toHaveLength(2);
    const reg0 = body.overall.find((r: { registrationId: string }) => r.registrationId === u.registrationIds[0]);
    const reg1 = body.overall.find((r: { registrationId: string }) => r.registrationId === u.registrationIds[1]);
    // reg0: stage1 full-load win = 25; stage2 unscored = 0.
    expect(reg0.matchTotal).toBeCloseTo(25, 2);
    // reg1: stage1 25 * (22/24) share (D zone under full load) + stage2 minimum-load win 25.
    expect(reg1.matchTotal).toBeCloseTo(25 * (22 / 24) + 25, 2);
    expect(reg1.matchTotal).toBeGreaterThan(reg0.matchTotal);
  });

  it('scorecards report renders final time for time-scoring stages', async () => {
    const res = await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/reports/scorecards.html` }, u.adminToken));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Final');
    expect(res.body).toContain('13.5');
  });
});