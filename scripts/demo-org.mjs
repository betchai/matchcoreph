#!/usr/bin/env node
/// Creates a demo organization, its admin, a demo match, and registered shooters.
/// Idempotent: reuses anything already created; repairs an incomplete Demo Match.
/// Usage: BASE=http://localhost:4000 node scripts/demo-org.mjs
const BASE = process.env.BASE ?? 'http://localhost:4000';

let cookie = '';
async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  if (!res.ok) {
    const msg = typeof data === 'object' && data && data.message ? data.message : text.slice(0, 300);
    throw new Error(`${method} ${path} -> ${res.status}: ${msg}`);
  }
  return data;
}

const ORG_NAME = 'Demo Shooting Club';
const ORG_SHORT = 'DEMO';
const ADMIN_USER = 'demo.admin';
const ADMIN_PASS = 'demo-admin';
const MATCH_NAME = 'Demo Match';
const SHOOTERS = [
  ['Ramon', 'Bautista', 'MALE', 'DEMO'],
  ['Cesar', 'Rosales', 'MALE', 'DEMO'],
  ['Mia', 'Santos', 'FEMALE', 'DEMO'],
  ['Paolo', 'Villanueva', 'MALE', 'DEMO'],
  ['Diana', 'Reyes', 'FEMALE', 'DEMO'],
  ['Marco', 'Cruz', 'MALE', 'DEMO'],
];

async function main() {
  await req('POST', '/api/auth/login', { usernameOrEmail: 'rhenabeth', password: 'rhenabeth-admin' });
  console.log('· logged in as rhenabeth (platform super admin)');

  let org = (await req('GET', '/api/platform/orgs')).find((o) => o.shortName === ORG_SHORT || o.name === ORG_NAME);
  if (!org) {
    org = await req('POST', '/api/platform/orgs', { name: ORG_NAME, shortName: ORG_SHORT, city: 'Metro Manila', province: 'NCR', country: 'PH', email: 'demo@example.com' });
    console.log(`· created organization ${ORG_NAME} (${org.id})`);
  } else {
    console.log(`· reusing organization ${org.name} (${org.id})`);
  }
  const orgId = org.id;

  const users = await req('GET', `/api/orgs/${orgId}/users`);
  if (!users.find((u) => u.username === ADMIN_USER)) {
    await req('POST', `/api/orgs/${orgId}/users`, {
      username: ADMIN_USER,
      email: 'demo.admin@example.com',
      password: ADMIN_PASS,
      displayName: 'Demo Admin',
      role: 'ORGANIZATION_ADMIN',
      organizationId: orgId,
    });
    console.log(`· created admin user "${ADMIN_USER}" / "${ADMIN_PASS}"`);
  } else {
    console.log(`· reusing admin user "${ADMIN_USER}"`);
  }

  let matches = await req('GET', `/api/orgs/${orgId}/matches`);
  let match = matches.find((m) => m.name === MATCH_NAME);
  let created = false;
  if (!match) {
    match = await req('POST', `/api/orgs/${orgId}/matches`, {
      name: MATCH_NAME,
      matchType: 'CLUB_SHOOT',
      startDate: new Date().toISOString().slice(0, 10),
      startTime: '08:00',
      endDate: new Date().toISOString().slice(0, 10),
      venue: 'Camp Aguinaldo Range',
      registrationFee: 800,
      matchLevel: 2,
      sanctioningStatus: 'CLUB',
    });
    created = true;
    console.log(`· created match "${MATCH_NAME}" (${match.id})`);
  } else {
    console.log(`· reusing match "${match.name}" (${match.id})`);
  }
  const matchId = match.id;
  const view = await req('GET', `/api/orgs/${orgId}/matches/${matchId}`);

  if (Number(view.registrationCount ?? 0) >= SHOOTERS.length) {
    console.log(`· match already has ${view.registrationCount} registrations; skipping setup`);
    if (view.status === 'DRAFT') {
      await req('POST', `/api/orgs/${orgId}/matches/${matchId}/publish`);
      console.log('· published match');
    }
  } else {
    const rulesetId = view.ruleset?.id;
    if (!rulesetId) throw new Error('Match has no ruleset (createMatch should have seeded one).');
    const rule = (await req('GET', '/api/rulesets')).find((r) => r.id === rulesetId);
    console.log(`· match ruleset "${rule?.name ?? rulesetId}" (${rulesetId})`);

    if (!view.disciplineCodes?.length) {
      await req('POST', `/api/orgs/${orgId}/matches/${matchId}/disciplines`, { disciplines: [rule?.discipline ?? 'HANDGUN'] });
      console.log(`· set discipline ${rule?.discipline ?? 'HANDGUN'}`);
    }

    const divs = await req('GET', `/api/rulesets/${rulesetId}/divisions`);
    const cats = await req('GET', `/api/rulesets/${rulesetId}/categories`);
    const divIds = divs.map((d) => d.id);
    const catIds = cats.map((c) => c.id);
    await req('POST', `/api/orgs/${orgId}/matches/${matchId}/divisions-categories`, { divisionIds: divIds, categoryIds: catIds });
    if (created || !view.divisions?.length) console.log(`· enabled ${divIds.length} divisions, ${catIds.length} categories`);
    else console.log(`· reconciled ${divIds.length} divisions, ${catIds.length} categories with match ruleset`);

    let stages = await req('GET', `/api/orgs/${orgId}/matches/${matchId}/stages`);
    if (!stages.length) {
      const defs = [
        { number: 1, name: 'Slicks & Stones', courseType: 'SHORT', scoringMethod: 'COMSTOCK', minimumRounds: 8, maximumRounds: 12, requiredHits: 8, maximumStagePoints: 80 },
        { number: 2, name: 'Stairway to VII', courseType: 'MEDIUM', scoringMethod: 'COMSTOCK', minimumRounds: 16, maximumRounds: 16, requiredHits: 16, maximumStagePoints: 160 },
        { number: 3, name: 'Wind of Change', courseType: 'LONG', scoringMethod: 'COMSTOCK', minimumRounds: 24, maximumRounds: 32, requiredHits: 24, maximumStagePoints: 240 },
      ];
      stages = [];
      for (const d of defs) {
        stages.push(await req('POST', `/api/orgs/${orgId}/matches/${matchId}/stages`, d));
      }
      console.log(`· created ${stages.length} stages`);
    } else {
      console.log(`· reusing ${stages.length} existing stages`);
    }

    let squads = await req('GET', `/api/orgs/${orgId}/matches/${matchId}/squads`);
    if (!squads.length) {
      for (const n of ['Alpha Squad', 'Bravo Squad']) {
        squads.push(await req('POST', `/api/orgs/${orgId}/matches/${matchId}/squads`, { name: n }));
      }
      console.log('· created 2 squads');
    } else {
      console.log(`· reusing ${squads.length} existing squads`);
    }

    const payments = [
      { paid: true, mode: 'CASH' },
      { paid: true, mode: 'GCASH' },
      { paid: true, mode: 'SPLIT' },
      { paid: true, mode: 'CASH' },
      { paid: false, mode: null },
      { paid: false, mode: null },
    ];

    const pfFor = (divId) => {
      const d = divs.find((x) => x.id === divId) ?? divs[0];
      return d.majorAllowed || d.minorPowerFactor ? 'MINOR' : 'NOT_APPLICABLE';
    };

    const registered = [];
    for (let i = 0; i < SHOOTERS.length; i++) {
      const [firstName, lastName, gender, club] = SHOOTERS[i];
      const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@demo.example.com`.replace(/ñ/g, 'n');
      let shooter;
      try {
        shooter = await req('POST', '/api/shooters', { firstName, lastName, gender, homeClub: club, email, ppsaMembershipNumber: `DEMO-${String(i + 1).padStart(3, '0')}` });
      } catch {
        const found = await req('GET', `/api/shooters?search=${encodeURIComponent(lastName)}`);
        shooter = found.find((s) => s.firstName === firstName && s.lastName === lastName);
        if (!shooter) throw new Error(`Could not find/create shooter ${firstName} ${lastName}`);
      }
      const pay = payments[i];
      try {
        const reg = await req('POST', `/api/orgs/${orgId}/matches/${matchId}/registrations`, {
          shooterId: shooter.id,
          divisionId: divIds[i % divIds.length],
          categoryId: catIds[i % catIds.length],
          declaredPowerFactor: pfFor(divIds[i % divIds.length]),
          squadId: squads[i % squads.length].id,
          scorePin: '0000',
          paid: pay.paid,
          paymentMode: pay.mode,
        });
        registered.push(reg);
      } catch (err) {
        if (/ALREADY_REGISTERED/.test(String(err))) registered.push(shooter.id);
        else throw err;
      }
    }
    console.log(`· registered ${registered.length} shooters`);

    const after = await req('GET', `/api/orgs/${orgId}/matches/${matchId}`);
    if (after.status === 'DRAFT') {
      await req('POST', `/api/orgs/${orgId}/matches/${matchId}/publish`);
      console.log('· published match');
    } else {
      console.log(`· match already ${after.status}`);
    }
  }

  const finalView = await req('GET', `/api/orgs/${orgId}/matches/${matchId}`);
  console.log('\nDemo ready:');
  console.log(`  Organization : ${ORG_NAME} (id ${orgId})`);
  console.log(`  Admin login  : ${ADMIN_USER} / ${ADMIN_PASS}`);
  console.log(`  Match        : ${MATCH_NAME} — ${finalView.ruleset?.name}, ${finalView.stageCount} stages, ${finalView.squadCount} squads, ${finalView.registrationCount} registrations`);
  console.log(`  URL          : ${BASE}/orgs/${orgId}  (login as ${ADMIN_USER})`);
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});