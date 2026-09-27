import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getMatch } from '../src/services/matches.js';
import { createStage } from '../src/services/stages.js';
import { createUser } from '../src/services/users.js';
import { authed, closeUniverse, enterScorePayload, fullScore, login, seedUniverse, type TestUniverse } from './helpers.js';

interface AssignmentUniverse extends TestUniverse {
  stage2Id: string;
  skId: string;
  skToken: string;
}

let u: AssignmentUniverse;

beforeAll(async () => {
  const base = await seedUniverse();
  const actor = { userId: 'seed', username: 'seed' };
  const match = getMatch(base.db, base.orgId, base.matchId);
  const stage2 = createStage(base.db, match, { number: 2, name: 'Blaster', courseType: 'SHORT', scoringMethod: 'COMSTOCK', minimumRounds: 3, maximumStagePoints: 25 }, actor);
  const sk = createUser(base.db, { username: 'sk1', email: 'sk1@t.example', password: 'sk-pw', displayName: 'Sk One', role: 'SCOREKEEPER', organizationId: base.orgId }, actor);
  const skToken = await login(base.app, 'sk1', 'sk-pw');
  u = { ...base, stage2Id: stage2.id, skId: sk.id, skToken };
});

afterAll(async () => {
  await closeUniverse(u);
});

const assignUrl = () => `/api/orgs/${u.orgId}/matches/${u.matchId}/assignments`;
const scoresUrl = () => `/api/orgs/${u.orgId}/matches/${u.matchId}/scores`;

describe('scorekeeper stage assignments', () => {
  it('an unassigned scorekeeper cannot enter scores', async () => {
    const payload = enterScorePayload(u, u.registrationIds[0], fullScore(u.targetIds), 'SUBMITTED');
    const res = await u.app.inject(authed({ method: 'POST', url: `${scoresUrl()}/submit`, payload }, u.skToken));
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('STAGE_NOT_ASSIGNED');

    const list = await u.app.inject(authed({ method: 'GET', url: `${scoresUrl()}?stageId=${u.stageId}` }, u.skToken));
    expect(list.statusCode).toBe(403);
  });

  it('only platform and organization admins can manage assignments', async () => {
    const md = createUser(u.db, { username: 'md1', email: 'md1@t.example', password: 'md-pw', displayName: 'MD', role: 'MATCH_DIRECTOR', organizationId: u.orgId }, { userId: 'seed', username: 'seed' });
    const mdToken = await login(u.app, 'md1', 'md-pw');

    const mdDenied = await u.app.inject(authed({ method: 'POST', url: assignUrl(), payload: { userId: u.skId, stageId: u.stageId } }, mdToken));
    expect(mdDenied.statusCode).toBe(403);

    const skDenied = await u.app.inject(authed({ method: 'POST', url: assignUrl(), payload: { userId: u.skId, stageId: u.stageId } }, u.skToken));
    expect(skDenied.statusCode).toBe(403);

    const create = await u.app.inject(authed({ method: 'POST', url: assignUrl(), payload: { userId: u.skId, stageId: u.stageId } }, u.adminToken));
    expect(create.statusCode).toBe(200);
    expect(create.json().username).toBe('sk1');

    const dup = await u.app.inject(authed({ method: 'POST', url: assignUrl(), payload: { userId: u.skId, stageId: u.stageId } }, u.adminToken));
    expect(dup.statusCode).toBe(409);

    const list = await u.app.inject(authed({ method: 'GET', url: assignUrl() }, u.superToken));
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    const users = await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/users` }, u.adminToken));
    expect(users.statusCode).toBe(200);
    expect(users.json().find((x: { username: string }) => x.username === 'sk1')?.role).toBe('SCOREKEEPER');

    const assignmentId = list.json()[0].id as string;
    const removed = await u.app.inject(authed({ method: 'DELETE', url: `${assignUrl()}/${assignmentId}` }, u.adminToken));
    expect(removed.statusCode).toBe(200);
  });

  it('a scorekeeper can only score their assigned stages', async () => {
    const create = await u.app.inject(authed({ method: 'POST', url: assignUrl(), payload: { userId: u.skId, stageId: u.stageId } }, u.adminToken));
    expect(create.statusCode).toBe(200);

    const me = await u.app.inject(authed({ method: 'GET', url: `${assignUrl()}/me` }, u.skToken));
    expect(me.statusCode).toBe(200);
    expect(me.json().stageIds).toEqual([u.stageId]);

    const listOk = await u.app.inject(authed({ method: 'GET', url: `${scoresUrl()}?stageId=${u.stageId}` }, u.skToken));
    expect(listOk.statusCode).toBe(200);

    const listOther = await u.app.inject(authed({ method: 'GET', url: `${scoresUrl()}?stageId=${u.stage2Id}` }, u.skToken));
    expect(listOther.statusCode).toBe(403);

    const ok = await u.app.inject(
      authed({ method: 'POST', url: `${scoresUrl()}/submit`, payload: enterScorePayload(u, u.registrationIds[0], fullScore(u.targetIds), 'SUBMITTED') }, u.skToken),
    );
    expect(ok.statusCode).toBe(200);

    const p2 = { ...enterScorePayload(u, u.registrationIds[0], fullScore(u.targetIds), 'SUBMITTED'), stageId: u.stage2Id };
    const denied = await u.app.inject(authed({ method: 'POST', url: `${scoresUrl()}/submit`, payload: p2 }, u.skToken));
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toBe('STAGE_NOT_ASSIGNED');

    const row = u.db.prepare('SELECT id FROM match_assignments WHERE user_id = ? AND match_id = ?').get(u.skId, u.matchId) as { id: string };
    const removed = await u.app.inject(authed({ method: 'DELETE', url: `${assignUrl()}/${row.id}` }, u.adminToken));
    expect(removed.statusCode).toBe(200);

    const after = await u.app.inject(authed({ method: 'GET', url: `${scoresUrl()}?stageId=${u.stageId}` }, u.skToken));
    expect(after.statusCode).toBe(403);
  });
});