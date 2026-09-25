import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authed, closeUniverse, enterScorePayload, fullScore, login, seedUniverse, type TestUniverse } from './helpers.js';
import { createOrganization } from '../src/services/orgs.js';
import { createUser } from '../src/services/users.js';

let u: TestUniverse;

beforeAll(async () => {
  u = await seedUniverse();
});

afterAll(async () => {
  await closeUniverse(u);
});

describe('tenant isolation', () => {
  it('outsider org member cannot see seed org data', async () => {
    const other = createOrganization(u.db, { name: 'Other Org', shortName: 'OTH' }, { userId: 'seed', username: 'seed' });
    createUser(u.db, { username: 'outsider', email: 'outsider@t.example', password: 'outsider-pw', displayName: 'Outsider', role: 'ORGANIZATION_ADMIN', organizationId: other.id }, { userId: 'seed', username: 'seed' });
    const token = await login(u.app, 'outsider', 'outsider-pw');

    const matches = await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches` }, token));
    expect(matches.statusCode).toBe(403);

    const stages = await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/stages` }, token));
    expect(stages.statusCode).toBe(403);
  });

  it('org admin cannot hit super-admin platform routes', async () => {
    const stats = await u.app.inject(authed({ method: 'GET', url: '/api/platform/stats' }, u.adminToken));
    expect(stats.statusCode).toBe(403);
  });

  it('platform admin can act inside any organization per their permission set', async () => {
    createUser(
      u.db,
      { username: 'padm', email: 'padm@t.example', password: 'padm-pw', displayName: 'Platform Admin', role: 'VIEWER', organizationId: u.orgId },
      { userId: 'seed', username: 'seed' },
    );
    const padmRow = u.db.prepare('SELECT id FROM users WHERE username = ?').get('padm') as { id: string };
    u.db.prepare("INSERT INTO platform_admins (user_id, role, created_at) VALUES (?, 'PLATFORM_ADMIN', ?)").run(padmRow.id, new Date().toISOString());
    const token = await login(u.app, 'padm', 'padm-pw');

    const matches = await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches` }, token));
    expect(matches.statusCode).toBe(200);

    const stats = await u.app.inject(authed({ method: 'GET', url: '/api/platform/stats' }, token));
    expect(stats.statusCode).toBe(200);

    const scores = await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores` }, token));
    expect(scores.statusCode).toBe(200);
  });

  it('platform admin can archive/cancel matches but not set arbitrary status', async () => {
    createUser(
      u.db,
      { username: 'padm2', email: 'padm2@t.example', password: 'padm2-pw', displayName: 'Platform Admin 2', role: 'VIEWER', organizationId: u.orgId },
      { userId: 'seed', username: 'seed' },
    );
    const row = u.db.prepare('SELECT id, status FROM matches WHERE id = ?').get(u.matchId) as { id: string; status: string };
    const pid = u.db.prepare('SELECT id FROM users WHERE username = ?').get('padm2') as { id: string };
    u.db.prepare("INSERT INTO platform_admins (user_id, role, created_at) VALUES (?, 'PLATFORM_ADMIN', ?)").run(pid.id, new Date().toISOString());
    const token = await login(u.app, 'padm2', 'padm2-pw');
    const url = `/api/orgs/${u.orgId}/matches/${u.matchId}/status`;
    const original = row.status;

    const archive = await u.app.inject(authed({ method: 'POST', url, payload: { status: 'ARCHIVED' } }, token));
    expect(archive.statusCode).toBe(200);

    const cancel = await u.app.inject(authed({ method: 'POST', url, payload: { status: 'CANCELLED' } }, token));
    expect(cancel.statusCode).toBe(200);

    const publish = await u.app.inject(authed({ method: 'POST', url, payload: { status: 'PUBLISHED' } }, token));
    expect(publish.statusCode).toBe(403);

    const restore = await u.app.inject(authed({ method: 'POST', url, payload: { status: original } }, u.adminToken));
    expect(restore.statusCode).toBe(200);
  });

  it('actions by org admin are audit-trailed', () => {
    const rows = u.db.prepare('SELECT action FROM audit_logs WHERE username = ?').all('orgadmin') as { action: string }[];
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('rbac scoring', () => {
  it('score entry is permitted for org admin', async () => {
    const res = await u.app.inject(authed({ method: 'POST', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/scores`, payload: enterScorePayload(u, u.registrationIds[0], fullScore(u.targetIds), 'DRAFT') }, u.adminToken));
    expect(res.statusCode).toBe(200);
  });

  it('results are denied to user with no role in the match org', async () => {
    const other = createOrganization(u.db, { name: 'Read Org', shortName: 'RD' }, { userId: 'seed', username: 'seed' });
    createUser(u.db, { username: 'ro', email: 'ro@t.example', password: 'ro-pw', displayName: 'RO', role: 'RANGE_OFFICER', organizationId: other.id }, { userId: 'seed', username: 'seed' });
    const token = await login(u.app, 'ro', 'ro-pw');
    const res = await u.app.inject(authed({ method: 'GET', url: `/api/orgs/${u.orgId}/matches/${u.matchId}/results` }, token));
    expect(res.statusCode).toBe(403);
  });

  it('org admin and match director can add shooters; only platform admin can edit', async () => {
    createUser(
      u.db,
      { username: 'md-shooter', email: 'md-shooter@t.example', password: 'md-pw', displayName: 'Match Director', role: 'MATCH_DIRECTOR', organizationId: u.orgId },
      { userId: 'seed', username: 'seed' },
    );
    const md = await login(u.app, 'md-shooter', 'md-pw');

    const byOrgAdmin = await u.app.inject(
      authed({ method: 'POST', url: '/api/shooters', payload: { firstName: 'Add', lastName: 'OrgAdmin' } }, u.adminToken),
    );
    expect(byOrgAdmin.statusCode).toBe(200);
    const orgCreated = byOrgAdmin.json<{ id: string }>().id;

    const byMd = await u.app.inject(
      authed({ method: 'POST', url: '/api/shooters', payload: { firstName: 'Add', lastName: 'MatchDir' } }, md),
    );
    expect(byMd.statusCode).toBe(200);
    const mdCreated = byMd.json<{ id: string }>().id;

    expect(
      (await u.app.inject(authed({ method: 'PATCH', url: `/api/shooters/${mdCreated}`, payload: { nickname: 'Nope' } }, u.adminToken))).statusCode,
    ).toBe(403);
    expect(
      (await u.app.inject(authed({ method: 'PATCH', url: `/api/shooters/${mdCreated}`, payload: { nickname: 'Nope' } }, md))).statusCode,
    ).toBe(403);

    const pid = u.db.prepare('SELECT id FROM users WHERE username = ?').get('md-shooter') as { id: string };
    u.db.prepare("INSERT INTO platform_admins (user_id, role, created_at) VALUES (?, 'PLATFORM_ADMIN', ?)").run(pid.id, new Date().toISOString());
    const plat = await login(u.app, 'md-shooter', 'md-pw');
    const edited = await u.app.inject(authed({ method: 'PATCH', url: `/api/shooters/${mdCreated}`, payload: { nickname: 'Edited' } }, plat));
    expect(edited.statusCode).toBe(200);
    expect(edited.json<{ nickname: string | null }>().nickname).toBe('Edited');

    u.db.prepare('DELETE FROM shooters WHERE id IN (?, ?)').run(orgCreated, mdCreated);
  });

  it('squad setup: create with starting stage, assign/reassign competitors, guard delete', async () => {
    const base = `/api/orgs/${u.orgId}/matches/${u.matchId}`;
    const alpha = await u.app.inject(authed({ method: 'POST', url: `${base}/squads`, payload: { name: 'Alpha', stageNumber: 2 } }, u.adminToken));
    expect(alpha.statusCode).toBe(200);
    const alphaId = alpha.json<{ id: string; stageNumber: number | null }>().id;
    expect(alpha.json<{ id: string; stageNumber: number | null }>().stageNumber).toBe(2);

    const beta = await u.app.inject(authed({ method: 'POST', url: `${base}/squads`, payload: { name: 'Beta' } }, u.adminToken));
    const betaId = beta.json<{ id: string }>().id;

    const regId = u.registrationIds[0];
    const assign = await u.app.inject(authed({ method: 'PATCH', url: `${base}/registrations/${regId}`, payload: { squadId: alphaId } }, u.adminToken));
    expect(assign.statusCode).toBe(200);

    const listing = await u.app.inject(authed({ method: 'GET', url: `${base}/registrations` }, u.adminToken));
    const mine = listing.json<{ id: string; squadId: string | null; squadName: string | null }[]>().find((r) => r.id === regId);
    expect(mine?.squadId).toBe(alphaId);
    expect(mine?.squadName).toBe('Alpha');

    const restage = await u.app.inject(authed({ method: 'PATCH', url: `${base}/squads/${alphaId}`, payload: { stageNumber: 3 } }, u.adminToken));
    expect(restage.statusCode).toBe(200);
    expect(restage.json<{ stageNumber: number | null }>().stageNumber).toBe(3);

    const blocked = await u.app.inject(authed({ method: 'DELETE', url: `${base}/squads/${alphaId}` }, u.adminToken));
    expect(blocked.statusCode).toBe(400);

    const move = await u.app.inject(authed({ method: 'PATCH', url: `${base}/registrations/${regId}`, payload: { squadId: betaId } }, u.adminToken));
    expect(move.statusCode).toBe(200);
    expect((await u.app.inject(authed({ method: 'DELETE', url: `${base}/squads/${alphaId}` }, u.adminToken))).statusCode).toBe(200);

    u.db.prepare('SELECT 1');
  });
});