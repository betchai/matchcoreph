import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDb, type Db } from './client.js';
import { createOrganization } from '../services/orgs.js';
import { createUser } from '../services/users.js';
import {
  createRuleset,
  getRuleset,
  listCategories as listRulesetCategories,
  listDivisions,
  listRulesets,
  seedCategoriesForRuleset,
  seedDivisionsForRuleset,
} from '../services/rulesets.js';
import { createMatch, publishMatch, setMatchDisciplines, setMatchDivisionsCategories, setMatchRuleset } from '../services/matches.js';
import { createStage, setStageTargets, stageTargets } from '../services/stages.js';
import { createSquad } from '../services/squads.js';
import { createShooter } from '../services/shooters.js';
import { registerCompetitor } from '../services/registrations.js';
import { enterScore } from '../services/scores.js';
import { RULESET_DEFAULTS } from '@blinkscore/core';
import type { Discipline } from '@blinkscore/core';

const DISCIPLINE_FROM_KEY: Record<string, Discipline> = {
  'IPSC-HANDGUN-2026': 'HANDGUN',
  'PPSA-HANDGUN-2026': 'HANDGUN',
  'PSMOC-HANDGUN-2026': 'HANDGUN',
  'IPSC-PCC-2026': 'PCC',
  'IPSC-RIFLE-2026': 'RIFLE',
  'IPSC-MINI-RIFLE-2026': 'MINI_RIFLE',
  'IPSC-SHOTGUN-2026': 'SHOTGUN',
  'IPSC-ACTION-AIR-2026': 'ACTION_AIR',
};

function seedDefaultRulesets(db: Db, actor: { userId: string; username: string | null }): void {
  for (const [key, def] of Object.entries(RULESET_DEFAULTS)) {
    const existing = listRulesets(db).find((r) => r.organizationCode === def.organizationCode && r.name === def.name);
    if (existing) continue;
    const created = createRuleset(
      db,
      {
        organizationId: null,
        name: def.name,
        organizationCode: def.organizationCode,
        discipline: (DISCIPLINE_FROM_KEY[key] ?? 'HANDGUN'),
        version: '1.0',
        effectiveDate: new Date().toISOString().slice(0, 10),
        description: def.description,
        sourceCitation: def.sourceCitation,
        parameters: def.parameters.map((p) => ({ key: p.key, value: String(p.value) })),
        seedDivisionsAndCategories: true,
      },
      actor,
    );
    console.log(`  seeded ruleset: ${created.name} (${created.discipline})`);
  }
}

// Demo competitor dataset (clearly fictional).
const SHOOTERS: { lastName: string; firstName: string; gender: 'MALE' | 'FEMALE'; division: string; category: string; pf: 'MINOR' | 'MAJOR' }[] = [
  { lastName: 'Reyes', firstName: 'Andres', gender: 'MALE', division: 'Production', category: 'Overall', pf: 'MINOR' },
  { lastName: 'Dela Cruz', firstName: 'Juan', gender: 'MALE', division: 'Production', category: 'Senior', pf: 'MINOR' },
  { lastName: 'Santos', firstName: 'Maria', gender: 'FEMALE', division: 'Production Optics', category: 'Lady', pf: 'MINOR' },
  { lastName: 'Garcia', firstName: 'Paolo', gender: 'MALE', division: 'Standard', category: 'Overall', pf: 'MAJOR' },
  { lastName: 'Torres', firstName: 'Lourdes', gender: 'FEMALE', division: 'Standard', category: 'Lady', pf: 'MINOR' },
  { lastName: 'Ramos', firstName: 'Miguel', gender: 'MALE', division: 'Open', category: 'Overall', pf: 'MAJOR' },
  { lastName: 'Aquino', firstName: 'Carlo', gender: 'MALE', division: 'Open', category: 'Senior', pf: 'MINOR' },
  { lastName: 'Navarro', firstName: 'Isabel', gender: 'FEMALE', division: 'Production Optics', category: 'Lady', pf: 'MINOR' },
];

const SQUAD_NAMES = ['Squad A', 'Squad B', 'Squad C', 'Squad D'];

type SeedStageCfg = {
  number: number;
  name: string;
  courseType: 'SHORT' | 'MEDIUM' | 'LONG' | 'CLASSIFIER';
  scoringMethod: 'COMSTOCK' | 'VIRGINIA_COUNT' | 'FIXED_TIME' | 'PSMOC_POINTS_FACTOR' | 'PSMOC_TIME';
  loadType?: 'FULL_LOAD' | 'MINIMUM_LOAD';
  minimumRounds: number;
  maximumStagePoints: number;
  classifierDesignation?: string;
  targets: { number: number; targetType: string; requiredHits: number }[];
};

type SeedMatchCfg = {
  name: string;
  matchType: 'CLUB_SHOOT' | 'CUP' | 'TOURNAMENT' | 'CHAMPIONSHIP';
  matchNumberPrefix: string;
  divisions: string[];
  categories: string[];
  stages: SeedStageCfg[];
  squadNames: string[];
  shooters: typeof SHOOTERS;
};

const STAGES: SeedStageCfg[] = [
  {
    number: 1,
    name: 'Fast Fire Short',
    courseType: 'SHORT',
    scoringMethod: 'COMSTOCK',
    minimumRounds: 8,
    maximumStagePoints: 40,
    targets: [
      { number: 1, targetType: 'PAPER', requiredHits: 2 },
      { number: 2, targetType: 'PAPER', requiredHits: 2 },
      { number: 3, targetType: 'POPPER', requiredHits: 1 },
    ],
  },
  {
    number: 2,
    name: 'Long Range Standards',
    courseType: 'MEDIUM',
    scoringMethod: 'VIRGINIA_COUNT',
    minimumRounds: 12,
    maximumStagePoints: 60,
    targets: [
      { number: 1, targetType: 'PAPER', requiredHits: 3 },
      { number: 2, targetType: 'PAPER', requiredHits: 3 },
      { number: 3, targetType: 'PAPER', requiredHits: 2 },
      { number: 4, targetType: 'PAPER', requiredHits: 2 },
    ],
  },
  {
    number: 3,
    name: 'Challenge of Steel',
    courseType: 'MEDIUM',
    scoringMethod: 'COMSTOCK',
    minimumRounds: 10,
    maximumStagePoints: 50,
    targets: [
      { number: 1, targetType: 'POPPER', requiredHits: 1 },
      { number: 2, targetType: 'POPPER', requiredHits: 1 },
      { number: 3, targetType: 'PLATE', requiredHits: 1 },
    ],
  },
  {
    number: 4,
    name: 'Marathon Long',
    courseType: 'LONG',
    scoringMethod: 'COMSTOCK',
    minimumRounds: 24,
    maximumStagePoints: 120,
    targets: [
      { number: 1, targetType: 'PAPER', requiredHits: 2 },
      { number: 2, targetType: 'PAPER', requiredHits: 2 },
      { number: 3, targetType: 'PAPER', requiredHits: 2 },
      { number: 4, targetType: 'PAPER', requiredHits: 2 },
      { number: 5, targetType: 'PAPER', requiredHits: 2 },
      { number: 6, targetType: 'PAPER', requiredHits: 2 },
      { number: 7, targetType: 'POPPER', requiredHits: 1 },
    ],
  },
  {
    number: 5,
    name: 'Classifier: CM 01-01',
    courseType: 'CLASSIFIER',
    scoringMethod: 'COMSTOCK',
    minimumRounds: 12,
    maximumStagePoints: 60,
    classifierDesignation: 'CM 01-01',
    targets: [
      { number: 1, targetType: 'PAPER', requiredHits: 4 },
      { number: 2, targetType: 'PAPER', requiredHits: 4 },
    ],
  },
];

// Short-course-only match for the PPSA (IPSC-style) ruleset.
const PPSA_SHORT_STAGES: SeedStageCfg[] = [
  {
    number: 1,
    name: 'Fast Fire Short',
    courseType: 'SHORT',
    scoringMethod: 'COMSTOCK',
    minimumRounds: 8,
    maximumStagePoints: 40,
    targets: [
      { number: 1, targetType: 'PAPER', requiredHits: 2 },
      { number: 2, targetType: 'PAPER', requiredHits: 2 },
      { number: 3, targetType: 'POPPER', requiredHits: 1 },
    ],
  },
  {
    number: 2,
    name: 'Steel Sprint',
    courseType: 'SHORT',
    scoringMethod: 'COMSTOCK',
    minimumRounds: 4,
    maximumStagePoints: 20,
    targets: [
      { number: 1, targetType: 'POPPER', requiredHits: 1 },
      { number: 2, targetType: 'POPPER', requiredHits: 1 },
      { number: 3, targetType: 'PLATE', requiredHits: 1 },
      { number: 4, targetType: 'PLATE', requiredHits: 1 },
    ],
  },
  {
    number: 3,
    name: 'Four Paper Pickup',
    courseType: 'SHORT',
    scoringMethod: 'COMSTOCK',
    minimumRounds: 8,
    maximumStagePoints: 40,
    targets: [
      { number: 1, targetType: 'PAPER', requiredHits: 2 },
      { number: 2, targetType: 'PAPER', requiredHits: 2 },
      { number: 3, targetType: 'PAPER', requiredHits: 2 },
      { number: 4, targetType: 'PAPER', requiredHits: 2 },
    ],
  },
  {
    number: 4,
    name: 'Standards Quick',
    courseType: 'SHORT',
    scoringMethod: 'VIRGINIA_COUNT',
    minimumRounds: 8,
    maximumStagePoints: 40,
    targets: [
      { number: 1, targetType: 'PAPER', requiredHits: 3 },
      { number: 2, targetType: 'PAPER', requiredHits: 3 },
      { number: 3, targetType: 'PAPER', requiredHits: 2 },
    ],
  },
];

// Short-course-only match for the PSMOC ruleset exercising both PSMOC methods.
const PSMOC_SHORT_STAGES: SeedStageCfg[] = [
  {
    number: 1,
    name: 'Full Load Short',
    courseType: 'SHORT',
    scoringMethod: 'PSMOC_POINTS_FACTOR',
    loadType: 'FULL_LOAD',
    minimumRounds: 8,
    maximumStagePoints: 40,
    targets: [
      { number: 1, targetType: 'PAPER', requiredHits: 2 },
      { number: 2, targetType: 'PAPER', requiredHits: 2 },
      { number: 3, targetType: 'PAPER', requiredHits: 2 },
      { number: 4, targetType: 'PAPER', requiredHits: 2 },
    ],
  },
  {
    number: 2,
    name: 'Minimum Load Short',
    courseType: 'SHORT',
    scoringMethod: 'PSMOC_POINTS_FACTOR',
    loadType: 'MINIMUM_LOAD',
    minimumRounds: 8,
    maximumStagePoints: 35,
    targets: [
      { number: 1, targetType: 'PAPER', requiredHits: 2 },
      { number: 2, targetType: 'PAPER', requiredHits: 2 },
      { number: 3, targetType: 'PAPER', requiredHits: 2 },
      { number: 4, targetType: 'POPPER', requiredHits: 1 },
    ],
  },
  {
    number: 3,
    name: 'Time Score Short',
    courseType: 'SHORT',
    scoringMethod: 'PSMOC_TIME',
    minimumRounds: 8,
    maximumStagePoints: 40,
    targets: [
      { number: 1, targetType: 'PAPER', requiredHits: 2 },
      { number: 2, targetType: 'PAPER', requiredHits: 2 },
      { number: 3, targetType: 'PAPER', requiredHits: 2 },
      { number: 4, targetType: 'PAPER', requiredHits: 2 },
    ],
  },
];

function seedClubMatch(
  db: Db,
  org: { id: string },
  orgActor: { userId: string; username: string | null },
  adminActor: { userId: string; username: string | null },
  rulesetId: string,
  cfg: SeedMatchCfg,
): void {
  const existing = db.prepare('SELECT id FROM matches WHERE name = ?').get(cfg.name) as { id: string } | undefined;
  if (existing) {
    console.log(`ℹ Match "${cfg.name}" already exists, skipping.`);
    return;
  }

  const matchDate = new Date();
  matchDate.setDate(matchDate.getDate() + 21);
  const startDate = matchDate.toISOString().slice(0, 10);

  const match = createMatch(
    db,
    org.id,
    {
      name: cfg.name,
      matchType: cfg.matchType,
      startDate,
      startTime: '08:00',
      venue: 'SJEPSC Range, San Juan, La Union',
      matchDirectorUserId: orgActor.userId,
      rangeMasterUserId: orgActor.userId,
      matchLevel: 1,
      sanctioningStatus: 'CLUB',
    },
    orgActor,
  );
  console.log(`✔ Match: ${cfg.name}`);

  setMatchDisciplines(db, match, ['HANDGUN'], orgActor);
  seedDivisionsForRuleset(db, rulesetId, 'HANDGUN', adminActor);
  seedCategoriesForRuleset(db, rulesetId, 'HANDGUN', adminActor);
  const configured = setMatchRuleset(db, match, rulesetId, orgActor);

  const divisions = listDivisions(db, rulesetId);
  const divisionByName = Object.fromEntries(divisions.map((d) => [d.name, d.id]));
  const categoryByName = Object.fromEntries(listRulesetCategories(db, rulesetId).map((c) => [c.name, c.id]));

  setMatchDivisionsCategories(
    db,
    configured,
    {
      divisionIds: cfg.divisions.map((n) => divisionByName[n] as string).filter((id): id is string => Boolean(id)),
      categoryIds: cfg.categories.map((n) => categoryByName[n] as string).filter((id): id is string => Boolean(id)),
    },
    orgActor,
  );

  const stages = cfg.stages.map((s) => {
    const stage = createStage(db, configured, { ...s, maximumRounds: s.minimumRounds }, orgActor);
    setStageTargets(db, configured, stage, s.targets, orgActor);
    return { ...s, id: stage.id };
  });
  console.log(`✔ Stages: ${stages.map((s) => s.name).join(', ')}`);

  const squads = cfg.squadNames.map((name, i) => createSquad(db, configured, { name, stageNumber: (i % stages.length) + 1 }, orgActor));
  console.log(`✔ Squads: ${squads.map((s) => s.name).join(', ')}`);

  const registrations = cfg.shooters.map((s, i) => {
    const shooter = createShooter(
      db,
      {
        lastName: s.lastName,
        firstName: s.firstName,
        email: `${s.firstName.toLowerCase()}.${s.lastName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
        gender: s.gender,
      },
      orgActor,
    );
    return registerCompetitor(
      db,
      configured,
      {
        shooterId: shooter.id,
        divisionId: divisionByName[s.division],
        categoryId: categoryByName[s.category],
        declaredPowerFactor: s.pf,
        squadId: squads[i % squads.length]?.id ?? '',
        matchNumber: `${cfg.matchNumberPrefix}-${String(i + 1).padStart(3, '0')}`,
        scorePin: String(1000 + i),
      },
      orgActor,
    );
  });
  console.log(`✔ Registrations: ${registrations.length}`);

  const stageId = stages[0]?.id ?? '';
  const paperTargets = stageTargets(db, stageId).filter((t) => t.targetType === 'PAPER');
  for (let i = 0; i < Math.min(2, registrations.length); i++) {
    enterScore(
      db,
      configured,
      {
        stageId,
        registrationId: registrations[i]!.id,
        timeSeconds: 18.4 + i,
        targets: paperTargets.map((t) => ({ targetId: t.id, zoneHits: ['A', 'A'] })),
        misses: 0,
        paperNoShoots: 0,
        procedurals: 0,
        penaltiesOther: 0,
        shotsFired: undefined,
        status: 'DRAFT',
      },
      orgActor,
    );
  }
  console.log('✔ Demo draft scores seeded on stage 1');

  publishMatch(db, configured, orgActor);
  console.log(`✔ Match published: ${cfg.name}`);
}

export function seed(db: Db): void {
  const superAdmin =
    (db.prepare('SELECT id, username FROM users WHERE username = ?').get('rhenabeth') as { id: string; username: string } | undefined) ??
    createUser(
      db,
      { username: 'rhenabeth', email: 'rhenabeth@example.com', password: 'rhenabeth-admin', displayName: 'RhenaBeth', role: 'PLATFORM_SUPER_ADMIN', isSuperAdmin: true },
      { userId: 'seed', username: null },
    );
  const adminActor = { userId: superAdmin.id, username: superAdmin.username };
  db.prepare(
    "INSERT INTO platform_admins (user_id, role, created_at) SELECT ?, 'PLATFORM_ADMIN', ? WHERE NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = ?)",
  ).run(superAdmin.id, new Date().toISOString(), superAdmin.id);
  console.log('✔ Super admin rhenabeth ready (+ PLATFORM_ADMIN)');

  seedDefaultRulesets(db, adminActor);

  const ppsaRuleset = getRuleset(db, (listRulesets(db).find((r) => r.organizationCode === 'PPSA')?.id ?? ''));
  const rulesetId = ppsaRuleset.id;

  const org =
    (db.prepare('SELECT id, name FROM organizations WHERE name = ?').get('San Juan Elyu Practical Shooters, Inc.') as { id: string; name: string } | undefined) ??
    createOrganization(
      db,
      {
        name: 'San Juan Elyu Practical Shooters, Inc.',
        shortName: 'SJEPSC',
        city: 'San Juan',
        province: 'La Union',
        country: 'Philippines',
        website: 'https://sjepsc.example.ph',
        email: 'secretariat@sjepsc.example.ph',
      },
      adminActor,
    );
  console.log(`✔ Organization: ${org.name}`);

  const orgAdmin =
    (db.prepare('SELECT id, username FROM users WHERE username = ?').get('sjepsc.admin') as { id: string; username: string } | undefined) ??
    createUser(
      db,
      { username: 'sjepsc.admin', email: 'sjepsc.admin@example.com', password: 'sjepsc-admin', displayName: 'SJEPSC Secretariat', role: 'ORGANIZATION_ADMIN', organizationId: org.id },
      adminActor,
    );
  const orgActor = { userId: orgAdmin.id, username: orgAdmin.username };
  console.log('✔ Org admin sjepsc.admin ready');

  const COMMON_DIVISIONS = ['Production', 'Production Optics', 'Standard', 'Open'];
  const COMMON_CATEGORIES = ['Overall', 'Lady', 'Senior'];

  seedClubMatch(db, org, orgActor, adminActor, rulesetId, {
    name: 'San Juan Club Shoot',
    matchType: 'CLUB_SHOOT',
    matchNumberPrefix: 'SJ',
    divisions: COMMON_DIVISIONS,
    categories: COMMON_CATEGORIES,
    stages: STAGES,
    squadNames: SQUAD_NAMES,
    shooters: SHOOTERS,
  });

  seedClubMatch(db, org, orgActor, adminActor, rulesetId, {
    name: 'PPSA Short Course Shoot',
    matchType: 'CLUB_SHOOT',
    matchNumberPrefix: 'PPSA',
    divisions: COMMON_DIVISIONS,
    categories: COMMON_CATEGORIES,
    stages: PPSA_SHORT_STAGES,
    squadNames: ['Squad A', 'Squad B'],
    shooters: SHOOTERS,
  });

  const psmocRuleset = getRuleset(db, (listRulesets(db).find((r) => r.organizationCode === 'PSMOC')?.id ?? ''));
  seedClubMatch(db, org, orgActor, adminActor, psmocRuleset.id, {
    name: 'PSMOC Short Course Shoot',
    matchType: 'CLUB_SHOOT',
    matchNumberPrefix: 'PSMO',
    divisions: COMMON_DIVISIONS,
    categories: COMMON_CATEGORIES,
    stages: PSMOC_SHORT_STAGES,
    squadNames: ['Squad A', 'Squad B'],
    shooters: SHOOTERS,
  });

  console.log('\nSeed complete.');
  console.log('  login: rhenabeth / rhenabeth-admin  (super admin)');
  console.log('  login: sjepsc.admin / sjepsc-admin  (org admin)');
  console.log('  matches: San Juan Club Shoot · PPSA Short Course Shoot · PSMOC Short Course Shoot');
}

function main(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = process.env.PSA_DATA_DIR ?? path.resolve(here, '../../../..', 'data');
  const db = openDb(dir);
  seed(db);
  db.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}