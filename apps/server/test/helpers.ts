import Database from 'better-sqlite3';
import { migrate, type Db } from '../src/db/client.js';
import { buildApp } from '../src/index.js';
import { createUser } from '../src/services/users.js';
import { createOrganization } from '../src/services/orgs.js';
import { createRuleset, seedCategoriesForRuleset, seedDivisionsForRuleset } from '../src/services/rulesets.js';
import { createMatch, setMatchDisciplines, setMatchRuleset, setMatchDivisionsCategories, publishMatch } from '../src/services/matches.js';
import { createStage, setStageTargets } from '../src/services/stages.js';
import { createSquad } from '../src/services/squads.js';
import { createShooter } from '../src/services/shooters.js';
import { registerCompetitor } from '../src/services/registrations.js';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';


export interface TestUniverse {
  db: Db;
  app: FastifyInstance;
  orgId: string;
  matchId: string;
  stageId: string;
  superToken: string;
  adminToken: string;
  registrationIds: string[];
  targetIds: string[];
  dbFile: string;
}

export function openTestDb(): { db: Db; dbFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'psa-test-'));
  const file = join(dir, 'test.db');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return { db, dbFile: file };
}

export async function seedUniverse(): Promise<TestUniverse> {
  const { db, dbFile } = openTestDb();

  const actor = { userId: 'seed', username: 'seed' };
  const superUser = createUser(db, { username: 'admin', email: 'admin@t.example', password: 'admin-pw', displayName: 'Admin', role: 'PLATFORM_SUPER_ADMIN', isSuperAdmin: true }, actor);

  const org = createOrganization(db, { name: 'Test Org', shortName: 'TST' }, actor);
  const orgAdmin = createUser(db, { username: 'orgadmin', email: 'orgadmin@t.example', password: 'org-pw', displayName: 'Org Admin', role: 'ORGANIZATION_ADMIN', organizationId: org.id }, actor);

  const ruleset = createRuleset(db, { organizationId: null, name: 'Test Handgun', organizationCode: 'PPSA', discipline: 'HANDGUN', version: '1.0', effectiveDate: '2026-01-01', seedDivisionsAndCategories: true }, actor);
  seedDivisionsForRuleset(db, ruleset.id, 'HANDGUN', actor);
  seedCategoriesForRuleset(db, ruleset.id, 'HANDGUN', actor);

  const divisions = db.prepare('SELECT id, name FROM divisions WHERE ruleset_id = ?').all(ruleset.id) as { id: string; name: string }[];
  const cats = db.prepare('SELECT id, name FROM categories WHERE ruleset_id = ?').all(ruleset.id) as { id: string; name: string }[];
  const prod = divisions.find((d) => d.name === 'Production')!.id;
  const standard = divisions.find((d) => d.name === 'Standard')!.id;
  const overall = cats.find((c) => c.name === 'Overall')!.id;
  void standard;

  const match = createMatch(db, org.id, { name: 'Test Match', matchType: 'CLUB_SHOOT', startDate: '2026-05-01', venue: 'Range', matchLevel: 1, sanctioningStatus: 'CLUB' }, actor);
  setMatchDisciplines(db, match, ['HANDGUN'], actor);
  const configured = setMatchRuleset(db, match, ruleset.id, actor);
  setMatchDivisionsCategories(db, configured, { divisionIds: [prod, standard], categoryIds: [overall] }, actor);

  const stage = createStage(db, configured, { number: 1, name: 'Sci-Fi', courseType: 'SHORT', scoringMethod: 'COMSTOCK', minimumRounds: 3, maximumStagePoints: 25 }, actor);
  setStageTargets(db, configured, stage, [
    { number: 1, targetType: 'PAPER', requiredHits: 2 },
    { number: 2, targetType: 'PAPER', requiredHits: 2 },
    { number: 3, targetType: 'POPPER', requiredHits: 1 },
  ], actor);
  const targetIds = (db.prepare('SELECT id FROM stage_targets WHERE stage_id = ? ORDER BY number').all(stage.id) as { id: string }[]).map((t) => t.id);

  const squad = createSquad(db, configured, { name: 'Squad A' }, actor);

  const registrationIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const shooter = createShooter(db, { firstName: `First${i}`, lastName: `Last${i}`, email: `s${i}@t.example` }, actor);
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
    stageId: stage.id,
    superToken,
    adminToken,
    registrationIds,
    targetIds,
    dbFile,
  };
}

export async function closeUniverse(u: TestUniverse): Promise<void> {
  await u.app.close();
  u.db.close();
  rmSync(dirname(u.dbFile), { recursive: true, force: true });
}

export async function login(app: FastifyInstance, username: string, password: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { usernameOrEmail: username, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  const cookies = res.cookies.filter((c) => c.name === 'psa_session');
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export function authed(opts: InjectOptions, token: string): InjectOptions {
  return {
    ...opts,
    headers: { ...(opts.headers ?? {}), cookie: token },
  };
}

export interface FullScore {
  timeSeconds: number;
  targets: { targetId: string; zoneHits: string[] }[];
  misses: number;
  paperNoShoots: number;
  procedurals: number;
  penaltiesOther: number;
  shotsFired: number | null;
}

export function fullScore(targetIds: string[]): FullScore {
  return {
    timeSeconds: 12.5,
    targets: [
      { targetId: targetIds[0], zoneHits: ['A', 'A'] },
      { targetId: targetIds[1], zoneHits: ['A', 'C'] },
      { targetId: targetIds[2], zoneHits: ['A'] },
    ],
    misses: 0,
    paperNoShoots: 0,
    procedurals: 0,
    penaltiesOther: 0,
    shotsFired: null,
  };
}

export function enterScorePayload(u: TestUniverse, registrationId: string, score: FullScore, status = 'SUBMITTED') {
  return {
    matchId: u.matchId,
    stageId: u.stageId,
    registrationId,
    ...score,
    status,
    confirmPin: status === 'SUBMITTED' ? '1234' : undefined,
  };
}