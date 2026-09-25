import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authed, closeUniverse, enterScorePayload, fullScore, login, seedUniverse, type TestUniverse } from './helpers.js';
import { createUser } from '../src/services/users.js';
import { registerCompetitor } from '../src/services/registrations.js';
import { createShooter } from '../src/services/shooters.js';
import { getMatch } from '../src/services/matches.js';

let u: TestUniverse;

beforeAll(async () => {
  u = await seedUniverse();
});

afterAll(async () => {
  await closeUniverse(u);
});

describe('auth', () => {
  it('rejects bad credentials', async () => {
    const res = await u.app.inject({ method: 'POST', url: '/api/auth/login', payload: { usernameOrEmail: 'admin', password: 'wrong' } });
    expect(res.statusCode).toBe(401);
  });

  it('super-admin token works on orgless routes', async () => {
    const res = await u.app.inject(authed({ method: 'GET', url: '/api/orgs/me' }, u.superToken));
    expect(res.statusCode).toBe(200);
  });

  it('rejects unauthenticated org access', async () => {
    const res = await u.app.inject({ method: 'GET', url: `/api/orgs/${u.orgId}/matches` });
    expect(res.statusCode).toBe(401);
  });
});

describe('match wizard', () => {
  it('match is published with all wizard steps complete', async () => {
    const res = await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/wizard` }, u.superToken));
    const wizard = res.json();
    expect(wizard.readyToPublish).toBe(true);
    expect(wizard.stepStages).toBe(true);
  });

  it('has one stage, one squad, two registrations', async () => {
    const stages = (await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/stages` }, u.superToken))).json();
    const squads = (await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/squads` }, u.superToken))).json();
    const regs = (await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/registrations` }, u.superToken))).json();
    expect(stages).toHaveLength(1);
    expect(squads).toHaveLength(1);
    expect(regs).toHaveLength(2);
  });
});

describe('score workflow', () => {
  it('submit → verify → lock a complete score', async () => {
    const r0 = u.registrationIds[0];
    const submit = await u.app.inject(authed({ method: 'POST', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/submit`, payload: enterScorePayload(u, r0, fullScore(u.targetIds)) }, u.adminToken));
    expect(submit.statusCode).toBe(200);
    const { scoreId } = submit.json();
    expect(scoreId).toBeTruthy();

    const verify = await u.app.inject(authed({ method: 'PATCH', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/${scoreId}/workflow`, payload: { action: 'VERIFY' } }, u.adminToken));
    expect(verify.statusCode).toBe(200);
    expect(verify.json().status).toBe('VERIFIED');

    const lock = await u.app.inject(authed({ method: 'PATCH', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/${scoreId}/workflow`, payload: { action: 'LOCK' } }, u.adminToken));
    expect(lock.statusCode).toBe(200);
    expect(lock.json().status).toBe('LOCKED');
  });

  it('rejects direct re-entry of a locked/corrected slice', async () => {
    const res = await u.app.inject(authed({ method: 'POST', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores`, payload: enterScorePayload(u, u.registrationIds[0], fullScore(u.targetIds), 'DRAFT') }, u.adminToken));
    expect(res.statusCode).toBe(409);
  });

  it('idempotent offline sync by syncToken', async () => {
    const reg = u.registrationIds[1];
    const entry = { stageId: u.stageId, registrationId: reg, ...fullScore(u.targetIds), syncToken: 'offline-1' };
    const sync = (token: string) =>
      u.app.inject(authed({ method: 'POST', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/sync`, payload: { scores: [{ ...entry, syncToken: token }] } }, u.adminToken));
    const first = (await sync('offline-1')).json();
    expect(first.results[0].ok).toBe(true);
    const second = (await sync('offline-1')).json();
    expect(second.results[0].scoreId).toBe(first.results[0].scoreId);
  });

  it('correction changes a locked score and audits', async () => {
    const ls = (await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores` }, u.adminToken))).json();
    const locked = ls.find((s: { registrationId: string }) => s.registrationId === u.registrationIds[0]);
    const res = await u.app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/${locked.id}/correct`,
          payload: { field: 'timeSeconds', newValue: '11.9', reason: 'Timer reread', authorization: 'org.admin' },
        },
        u.adminToken,
      ),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('CORRECTED');
    const row = u.db.prepare('SELECT * FROM scores WHERE id = ?').get(locked.id) as { status: string; time_seconds: number };
    expect(row.status).toBe('CORRECTED');
    expect(row.time_seconds).toBe(11.9);
  });
});

describe('platform override', () => {
  it('super admin can override a verified/corrected score through the scorecard field', async () => {
    const ls = (await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores` }, u.superToken))).json();
    const s = ls.find((x: { registrationId: string }) => x.registrationId === u.registrationIds[0]);
    expect(s).toBeTruthy();
    expect(['VERIFIED', 'LOCKED', 'CORRECTED']).toContain(s.status);
    const newValue = JSON.stringify({
      targets: fullScore(u.targetIds).targets,
      timeSeconds: 13.0,
      misses: 0,
      paperNoShoots: 0,
      procedurals: 0,
      penaltiesOther: 0,
      shotsFired: null,
    });
    const res = await u.app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/${s.id}/correct`,
          payload: { field: 'scorecard', previousValue: null, newValue, reason: 'Platform verified correction', authorization: 'platform.superAdmin' },
        },
        u.superToken,
      ),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('CORRECTED');
    const row = u.db.prepare('SELECT * FROM scores WHERE id = ?').get(s.id) as { status: string; time_seconds: number };
    expect(row.status).toBe('CORRECTED');
    expect(row.time_seconds).toBe(13.0);
    const corr = u.db
      .prepare("SELECT * FROM score_corrections WHERE score_id = ? AND field = 'scorecard' ORDER BY created_at DESC LIMIT 1")
      .get(s.id) as { authorized_by: string; previous_value: string };
    expect(corr.authorized_by).toBe('platform.superAdmin');
    expect(JSON.parse(corr.previous_value).timeSeconds).toBe(11.9);
  });

  it('a PLATFORM_ADMIN role user can view scores and override with platform.admin', async () => {
    const actor = { userId: 'seed', username: 'seed' };
    const pu = createUser(u.db, { username: 'platform', email: 'platform@t.example', password: 'platform-pw', displayName: 'Platform Admin', role: 'PLATFORM_ADMIN' }, actor);
    u.db.prepare("INSERT INTO platform_admins (user_id, role, created_at) VALUES (?, 'PLATFORM_ADMIN', ?)").run(pu.id, new Date().toISOString());
    const token = await login(u.app, 'platform', 'platform-pw');

    const list = await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores` }, token));
    expect(list.statusCode).toBe(200);
    const s = (list.json() as { registrationId: string; id: string; status: string }[]).find(
      (x) => x.registrationId === u.registrationIds[0],
    );
    expect(s).toBeTruthy();

    const newValue = JSON.stringify({
      targets: fullScore(u.targetIds).targets,
      timeSeconds: 14.2,
      misses: 0,
      paperNoShoots: 0,
      procedurals: 0,
      penaltiesOther: 0,
      shotsFired: null,
    });
    const res = await u.app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/${s!.id}/correct`,
          payload: { field: 'scorecard', previousValue: null, newValue, reason: 'Platform admin override', authorization: 'platform.admin' },
        },
        token,
      ),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('CORRECTED');
    const row = u.db.prepare('SELECT * FROM scores WHERE id = ?').get(s!.id) as { time_seconds: number };
    expect(row.time_seconds).toBe(14.2);
  });

  it('rejects a platform-only authorization token from a non-platform user', async () => {
    const ls = (await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores` }, u.adminToken))).json();
    const s = (ls as { registrationId: string; id: string }[]).find((x) => x.registrationId === u.registrationIds[0]);
    const res = await u.app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/${s!.id}/correct`,
          payload: { field: 'timeSeconds', newValue: '20.0', reason: 'attempt', authorization: 'platform.admin' },
        },
        u.adminToken,
      ),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('CORRECTION_NOT_AUTHORIZED');
  });
});

describe('results', () => {
  it('returns overall standings', async () => {
    const res = await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/results` }, u.adminToken));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.overall)).toBe(true);
    expect(body.overall.length).toBe(2);
  });

  it('does not report unscored competitors as a tie', async () => {
    const prod = (u.db.prepare("SELECT id FROM divisions WHERE name = 'Production'").get() as { id: string }).id;
    const overall = (u.db.prepare("SELECT id FROM categories WHERE name = 'Overall'").get() as { id: string }).id;
    const squadId = (u.db.prepare('SELECT id FROM squads LIMIT 1').get() as { id: string }).id;
    const shooter = await u.app.inject(authed({ method: 'POST', url: '/api/shooters', payload: { firstName: 'No', lastName: 'Scores', email: 'noscores@t.example' } }, u.adminToken));
    expect(shooter.statusCode).toBe(200);
    const reg = await u.app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/registrations`,
          payload: { shooterId: shooter.json().id, divisionId: prod, categoryId: overall, declaredPowerFactor: 'MINOR', squadId, scorePin: '1234' },
        },
        u.adminToken,
      ),
    );
    expect(reg.statusCode).toBe(200);

    const res = await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/results` }, u.adminToken));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const scored = body.overall.filter((r: { hasScores: boolean }) => r.hasScores);
    const unscored = body.overall.find((r: { hasScores: boolean }) => !r.hasScores);
    expect(scored.length).toBe(2);
    expect(unscored).toBeTruthy();
    expect(unscored.rankDisplay).toBe('–');
    expect(unscored.tie).toBe(false);
    expect(scored.some((r: { tie: boolean }) => r.tie)).toBe(false);
  });
});

describe('point-cap hardening (entry rejected 422)', () => {
  it('rejects a steel target scored above its ceiling without saving', async () => {
    // Plate/popper ceiling is 5 (one hit); recording two hits produces 10.
    const before = u.db.prepare('SELECT COUNT(*) c FROM scores WHERE registration_id = ? AND stage_id = ?').get(u.registrationIds[1], u.stageId) as { c: number };
    const res = await u.app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/submit`,
          payload: {
            matchId: u.matchId,
            stageId: u.stageId,
            registrationId: u.registrationIds[1],
            timeSeconds: 10.0,
            targets: [
              { targetId: u.targetIds[0], zoneHits: ['A', 'A'] },
              { targetId: u.targetIds[1], zoneHits: ['A', 'A'] },
              { targetId: u.targetIds[2], hits: 2 },
            ],
            misses: 0,
            paperNoShoots: 0,
            procedurals: 0,
            penaltiesOther: 0,
            shotsFired: null,
            confirmPin: '1234',
          },
        },
        u.adminToken,
      ),
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('TARGET_POINTS_EXCEEDED');
    const after = u.db.prepare('SELECT COUNT(*) c FROM scores WHERE registration_id = ? AND stage_id = ?').get(u.registrationIds[1], u.stageId) as { c: number };
    expect(after.c).toBe(before.c); // nothing new persisted
  });

  it('rejects a score whose raw points exceed the declared stage maximum (misdeclared stage)', async () => {
    // Builds a 2nd stage declaring max 10 but a 25-point layout (2 paper + 1 popper).
    const st = await u.app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/stages`,
          payload: { number: 2, name: 'Tight', courseType: 'SHORT', scoringMethod: 'COMSTOCK', minimumRounds: 5, maximumRounds: 5, maximumStagePoints: 10 },
        },
        u.adminToken,
      ),
    );
    expect(st.statusCode).toBe(200);
    const stage2 = st.json();
    const put = await u.app.inject(
      authed(
        {
          method: 'PUT',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/stages/${stage2.id}/targets`,
          payload: {
            targets: [
              { number: 1, targetType: 'PAPER', requiredHits: 2 },
              { number: 2, targetType: 'PAPER', requiredHits: 2 },
              { number: 3, targetType: 'POPPER', requiredHits: 1 },
            ],
          },
        },
        u.adminToken,
      ),
    );
    expect(put.statusCode).toBe(200);
    const got = (await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/stages/${stage2.id}/targets` }, u.adminToken))).json() as { id: string; requiredHits: number | null; targetType: string }[];
    const t2 = got.map((t) => ({ id: t.id, targetType: t.targetType }));
    const paperIds = t2.filter((t) => t.targetType === 'PAPER').map((t) => t.id);

    const res = await u.app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores`,
          payload: {
            matchId: u.matchId,
            stageId: stage2.id,
            registrationId: u.registrationIds[1],
            timeSeconds: 12.5,
            targets: [
              ...paperIds.map((id) => ({ targetId: id, zoneHits: ['A', 'A'] })),
              { targetId: t2.find((t) => t.targetType === 'POPPER')!.id, hits: 1 },
            ],
            misses: 0,
            paperNoShoots: 0,
            procedurals: 0,
            penaltiesOther: 0,
            shotsFired: null,
          },
        },
        u.adminToken,
      ),
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('STAGE_POINTS_EXCEEDED');
  });

  it('rejects a zone hit the target does not declare (422)', async () => {
    const st = await u.app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/stages`,
          payload: { number: 3, name: 'A-Dee Only', courseType: 'SHORT', scoringMethod: 'COMSTOCK', minimumRounds: 2, maximumRounds: 2, maximumStagePoints: 10 },
        },
        u.adminToken,
      ),
    );
    expect(st.statusCode).toBe(200);
    const stage3 = st.json();
    const put = await u.app.inject(
      authed(
        {
          method: 'PUT',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/stages/${stage3.id}/targets`,
          payload: { targets: [{ number: 1, targetType: 'PAPER', requiredHits: 2, scoringZones: ['A', 'C'] }] },
        },
        u.adminToken,
      ),
    );
    expect(put.statusCode).toBe(200);
    const target = ((await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/stages/${stage3.id}/targets` }, u.adminToken))).json() as { id: string }[])[0];

    const res = await u.app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores`,
          payload: {
            matchId: u.matchId,
            stageId: stage3.id,
            registrationId: u.registrationIds[1],
            timeSeconds: 5.0,
            targets: [{ targetId: target.id, zoneHits: ['A', 'D'] }], // D is not a declared zone
            misses: 0,
            paperNoShoots: 0,
            procedurals: 0,
            penaltiesOther: 0,
            shotsFired: null,
          },
        },
        u.adminToken,
      ),
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('ZONE_NOT_RECORDABLE');
  });
});

describe('shooter verification PIN (submit)', () => {
  it('rejects submit with a wrong PIN (403)', async () => {
    const payload = { ...enterScorePayload(u, u.registrationIds[1], fullScore(u.targetIds)), confirmPin: '9999' };
    const res = await u.app.inject(authed({ method: 'POST', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/submit`, payload }, u.adminToken));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('SCORE_PIN_MISMATCH');
  });

  it('rejects submit when no PIN was set at registration (400)', async () => {
    const shooter = createShooter(u.db, { firstName: 'No', lastName: 'Pin', email: 'nopin@t.example' }, { userId: 'seed', username: 'seed' });
    const prod = (u.db.prepare("SELECT id FROM divisions WHERE name = 'Production'").get() as { id: string }).id;
    const overall = (u.db.prepare("SELECT id FROM categories WHERE name = 'Overall'").get() as { id: string }).id;
    const squadId = (u.db.prepare('SELECT id FROM squads LIMIT 1').get() as { id: string }).id;
    const reg = registerCompetitor(u.db, getMatch(u.db, u.orgId, u.matchId), { shooterId: shooter.id, divisionId: prod, categoryId: overall, declaredPowerFactor: 'MINOR', squadId }, { userId: 'seed', username: 'seed' });
    const res = await u.app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/submit`,
          payload: { ...enterScorePayload(u, reg.id, fullScore(u.targetIds)), confirmPin: '1234' },
        },
        u.adminToken,
      ),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('SCORE_PIN_NOT_SET');
  });

  it('accepts a submit with the correct PIN', async () => {
    const res = await u.app.inject(authed({ method: 'POST', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/submit`, payload: enterScorePayload(u, u.registrationIds[1], fullScore(u.targetIds)) }, u.adminToken));
    expect(res.statusCode).toBe(200);
  });
});

describe('paper target hit caps (hard rules)', () => {
  it('rejects a paper target recorded with more than its stipulated hits (422)', async () => {
    const res = await u.app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/submit`,
          payload: enterScorePayload(u, u.registrationIds[1], {
            timeSeconds: 12.5,
            targets: [
              { targetId: u.targetIds[0], zoneHits: ['A', 'A', 'A'] }, // 3 hits on a 2-hit paper target
              { targetId: u.targetIds[1], zoneHits: ['A', 'C'] },
              { targetId: u.targetIds[2], hits: 1 },
            ],
            misses: 0,
            paperNoShoots: 0,
            procedurals: 0,
            penaltiesOther: 0,
            shotsFired: null,
          }),
        },
        u.adminToken,
      ),
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('TARGET_HITS_EXCEEDED');
  });

  it('derives and persists the miss for an under-hit paper target', async () => {
    const submit = await u.app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores`,
          payload: enterScorePayload(u, u.registrationIds[1], {
            timeSeconds: 12.5,
            targets: [
              { targetId: u.targetIds[0], zoneHits: ['A'] }, // 1 of 2 required → 1 derived miss
              { targetId: u.targetIds[1], zoneHits: ['A', 'C'] },
              { targetId: u.targetIds[2], hits: 1 },
            ],
            misses: 0,
            paperNoShoots: 0,
            procedurals: 0,
            penaltiesOther: 0,
            shotsFired: null,
          }, 'DRAFT'),
        },
        u.adminToken,
      ),
    );
    expect(submit.statusCode).toBe(200);
    const { scoreId } = submit.json();
    const got = (await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/${scoreId}` }, u.adminToken))).json();
    expect(got.misses).toBe(1);
  });
});

describe('forgotten PIN recovery', () => {
  it('lets an authorized submitter reset a competitor PIN (audited)', async () => {
    const res = await u.app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/forgot-pin`,
          payload: { registrationId: u.registrationIds[1], pin: '4321' },
        },
        u.adminToken,
      ),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().hasScorePin).toBe(true);

    const submit = await u.app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/submit`,
          payload: { ...enterScorePayload(u, u.registrationIds[1], fullScore(u.targetIds)), confirmPin: '4321' },
        },
        u.adminToken,
      ),
    );
    expect(submit.statusCode).toBe(200);
  });

  it('rejects an invalid reset PIN (400)', async () => {
    const res = await u.app.inject(
      authed(
        {
          method: 'POST',
          url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores/forgot-pin`,
          payload: { registrationId: u.registrationIds[1], pin: '12' },
        },
        u.adminToken,
      ),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('SCORE_PIN_INVALID');
  });
});