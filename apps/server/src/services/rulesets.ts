import type { Db } from '../db/client.js';
import { uuid, notFound, conflict, badRequest } from './utils.js';
import { audit } from './audit.js';
import {
  DISCIPLINE_DEFINITIONS,
  DIVISION_DEFAULTS,
  CATEGORY_DEFAULTS,
  RULESET_DEFAULTS,
  RULE_PARAMETER_DEFS,
  type Discipline,
  type Ruleset,
  type Division,
  type Category,
} from '@blinkscore/core';

export function mapRuleset(row: Record<string, unknown>): Ruleset {
  return {
    id: String(row.id),
    organizationId: (row.organization_id as string) ?? null,
    name: String(row.name),
    organizationCode: String(row.organization_code),
    discipline: row.discipline as Discipline,
    version: String(row.version),
    effectiveDate: String(row.effective_date),
    description: (row.description as string) ?? null,
    status: row.status as Ruleset['status'],
    sourceCitation: (row.source_citation as string) ?? null,
    parentRulesetId: (row.parent_ruleset_id as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapDivision(row: Record<string, unknown>): Division {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    discipline: row.discipline as Discipline,
    rulesetId: String(row.ruleset_id),
    majorPowerFactor: Number(row.major_power_factor) === 1,
    minorPowerFactor: Number(row.minor_power_factor) === 1,
    majorAllowed: Number(row.major_allowed) === 1,
    maximumCapacity: (row.maximum_capacity as number) ?? null,
    equipmentRestrictions: (row.equipment_restrictions as string) ?? null,
    notes: (row.notes as string) ?? null,
    active: Number(row.active) === 1,
  };
}

export function mapCategory(row: Record<string, unknown>): Category {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    discipline: (row.discipline as Discipline) ?? null,
    rulesetId: String(row.ruleset_id),
    description: (row.description as string) ?? null,
    active: Number(row.active) === 1,
  };
}

export function getRuleset(db: Db, rulesetId: string): Ruleset {
  const row = db.prepare('SELECT * FROM rulesets WHERE id = ?').get(rulesetId) as Record<string, unknown> | undefined;
  if (!row) throw notFound('Ruleset not found.');
  return mapRuleset(row);
}

export function listRulesets(db: Db, discipline?: Discipline): Ruleset[] {
  const rows = discipline
    ? db.prepare('SELECT * FROM rulesets WHERE discipline = ? ORDER BY effective_date DESC').all(discipline)
    : db.prepare('SELECT * FROM rulesets ORDER BY effective_date DESC').all();
  return (rows as Record<string, unknown>[]).map(mapRuleset);
}

export function rulesetParams(db: Db, rulesetId: string): { key: string; value: string }[] {
  const rows = db.prepare('SELECT key, value FROM rule_parameters WHERE ruleset_id = ?').all(rulesetId) as {
    key: string;
    value: string;
  }[];
  return rows;
}

export function rulesetView(db: Db, rulesetId: string): Record<string, unknown> {
  const rs = getRuleset(db, rulesetId);
  return {
    ...rs,
    parameters: rulesetParams(db, rulesetId),
    divisions: listDivisions(db, rulesetId),
    categories: listCategories(db, rulesetId),
  };
}

export function hasLockedHistory(db: Db, rulesetId: string): boolean {
  const row = db
    .prepare(
      `SELECT EXISTS(
         SELECT 1 FROM matches m
         WHERE m.ruleset_id = ?
           AND (m.status IN ('COMPLETED','ARCHIVED') OR m.visibility = 'PUBLISHED')
       ) AS used`,
    )
    .get(rulesetId) as Record<string, unknown>;
  return Number(row.used) === 1;
}

export function createRuleset(
  db: Db,
  input: {
    organizationId?: string | null;
    name: string;
    organizationCode: string;
    discipline: Discipline;
    version: string;
    effectiveDate: string;
    description?: string | null;
    sourceCitation?: string | null;
    parameters?: { key: string; value: string }[];
    seedDivisionsAndCategories?: boolean;
  },
  actor?: { userId: string | null; username: string | null },
): Ruleset {
  const dup = db
    .prepare('SELECT id FROM rulesets WHERE organization_code = ? AND discipline = ? AND version = ?')
    .get(input.organizationCode, input.discipline, input.version);
  if (dup) throw conflict('RULESET_EXISTS', 'A ruleset with that organization/discipline/version already exists.');

  const id = uuid();
  const now = new Date().toISOString();
  const defaults = RULESET_DEFAULTS[`${input.organizationCode}-${input.discipline}-${input.version.replace(/\D/g, '')}`] ??
    RULESET_DEFAULTS[input.organizationCode === 'PSMOC' ? `PSMOC-${input.discipline}-2026` :
      input.organizationCode === 'IPSC' ? `IPSC-${input.discipline}-2026` : 'PPSA-HANDGUN-2026'];

  db.prepare(
    `INSERT INTO rulesets
      (id, organization_id, name, organization_code, discipline, version, effective_date, description, status, source_citation, parent_ruleset_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NULL, ?, ?)`,
  ).run(
    id,
    input.organizationId ?? null,
    input.name,
    input.organizationCode,
    input.discipline,
    input.version,
    input.effectiveDate,
    input.description ?? defaults?.description ?? null,
    input.sourceCitation ?? defaults?.sourceCitation ?? null,
    now,
    now,
  );

  // Seed parameters (rulebook defaults or provided overrides).
  const params = input.parameters && input.parameters.length > 0 ? input.parameters : (defaults?.parameters ?? []);
  const paramInsert = db.prepare(
    'INSERT INTO rule_parameters (id, ruleset_id, key, value, label, description, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?)',
  );
  for (const p of params) {
    const def = RULE_PARAMETER_DEFS.find((d) => d.key === p.key);
    paramInsert.run(uuid(), id, p.key, p.value, now);
    void def;
  }

  if (input.seedDivisionsAndCategories !== false) {
    seedDivisionsForRuleset(db, id, input.discipline, actor);
    seedCategoriesForRuleset(db, id, input.discipline, actor);
  }

  audit(db, {
    organizationId: input.organizationId ?? null,
    userId: actor?.userId ?? null,
    username: actor?.username ?? null,
    action: 'RULESET_CHANGED',
    entity: 'rulesets',
    entityId: id,
    newValue: { name: input.name, discipline: input.discipline, version: input.version },
  });
  return getRuleset(db, id);
}

export function seedDivisionsForRuleset(
  db: Db,
  rulesetId: string,
  discipline: Discipline,
  actor?: { userId: string | null; username: string | null },
): Division[] {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO divisions
      (id, code, name, discipline, ruleset_id, major_power_factor, minor_power_factor, major_allowed, maximum_capacity, equipment_restrictions, notes, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?)`,
  );
  const created: Division[] = [];
  for (const d of DIVISION_DEFAULTS) {
    if (d.discipline !== discipline) continue;
    const existing = db.prepare('SELECT id FROM divisions WHERE code = ? AND ruleset_id = ?').get(d.code, rulesetId);
    if (existing) continue;
    const id = uuid();
    insert.run(
      id,
      d.code,
      d.name,
      d.discipline,
      rulesetId,
      d.majorAllowed ? 1 : 0,
      d.minorAllowed ? 1 : 0,
      d.majorAllowed ? 1 : 0,
      d.maximumCapacity,
      d.notes,
      now,
      now,
    );
    created.push(mapDivision(db.prepare('SELECT * FROM divisions WHERE id = ?').get(id) as Record<string, unknown>));
  }
  void actor;
  return created;
}

export function seedCategoriesForRuleset(
  db: Db,
  rulesetId: string,
  discipline: Discipline,
  actor?: { userId: string | null; username: string | null },
): Category[] {
  const now = new Date().toISOString();
  const insert = db.prepare(
    'INSERT INTO categories (id, code, name, discipline, ruleset_id, description, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
  );
  const created: Category[] = [];
  for (const c of CATEGORY_DEFAULTS) {
    const existing = db.prepare('SELECT id FROM categories WHERE code = ? AND ruleset_id = ?').get(c.code, rulesetId);
    if (existing) continue;
    const id = uuid();
    insert.run(id, c.code, c.name, discipline, rulesetId, c.description, now, now);
    created.push(mapCategory(db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Record<string, unknown>));
  }
  void actor;
  return created;
}

export function duplicateRuleset(
  db: Db,
  sourceId: string,
  version: string,
  effectiveDate: string,
  actor?: { userId: string | null; username: string | null },
): Ruleset {
  const source = getRuleset(db, sourceId);
  const dup = db
    .prepare('SELECT id FROM rulesets WHERE organization_code = ? AND discipline = ? AND version = ?')
    .get(source.organizationCode, source.discipline, version);
  if (dup) throw conflict('RULESET_EXISTS', `Version ${version} already exists for this ruleset.`);
  const id = uuid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO rulesets
      (id, organization_id, name, organization_code, discipline, version, effective_date, description, status, source_citation, parent_ruleset_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
  ).run(
    id,
    source.organizationId,
    source.name,
    source.organizationCode,
    source.discipline,
    version,
    effectiveDate,
    source.description,
    source.sourceCitation,
    sourceId,
    now,
    now,
  );
  const params = rulesetParams(db, sourceId);
  for (const p of params) {
    db.prepare('INSERT INTO rule_parameters (id, ruleset_id, key, value, label, description, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?)').run(
      uuid(),
      id,
      p.key,
      p.value,
      now,
    );
  }
  // Copy divisions & categories as new rows for the new version.
  for (const d of listDivisions(db, sourceId)) {
    db.prepare(
      `INSERT INTO divisions (id, code, name, discipline, ruleset_id, major_power_factor, minor_power_factor, major_allowed, maximum_capacity, equipment_restrictions, notes, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(uuid(), d.code, d.name, d.discipline, id, d.majorPowerFactor ? 1 : 0, d.minorPowerFactor ? 1 : 0, d.majorAllowed ? 1 : 0, d.maximumCapacity, d.equipmentRestrictions, d.notes, now, now);
  }
  for (const c of listCategories(db, sourceId)) {
    db.prepare(
      'INSERT INTO categories (id, code, name, discipline, ruleset_id, description, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    ).run(uuid(), c.code, c.name, c.discipline, id, c.description, now, now);
  }
  audit(db, {
    organizationId: source.organizationId,
    userId: actor?.userId ?? null,
    username: actor?.username ?? null,
    action: 'RULESET_CHANGED',
    entity: 'rulesets',
    entityId: id,
    oldValue: { sourceId },
    newValue: { version, effectiveDate },
  });
  return getRuleset(db, id);
}

export function setRulesetStatus(db: Db, rulesetId: string, status: 'ACTIVE' | 'INACTIVE'): Ruleset {
  const rs = getRuleset(db, rulesetId);
  if (status === 'INACTIVE' && hasLockedHistory(db, rulesetId)) {
    throw conflict('RULESET_IN_USE', 'This ruleset is used by published/completed matches and cannot be deactivated.');
  }
  db.prepare('UPDATE rulesets SET status = ? WHERE id = ?').run(status, rulesetId);
  return getRuleset(db, rulesetId);
}

export function updateRulesetParameters(
  db: Db,
  rulesetId: string,
  parameters: { key: string; value: string }[],
  actor?: { userId: string | null; username: string | null },
): { key: string; value: string }[] {
  const rs = getRuleset(db, rulesetId);
  if (hasLockedHistory(db, rulesetId)) {
    throw conflict('RULESET_LOCKED', 'This ruleset is frozen by historical matches. Duplicate it as a new version to change parameters.');
  }
  const now = new Date().toISOString();
  const upsert = db.prepare(
    'INSERT INTO rule_parameters (id, ruleset_id, key, value, label, description, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?) ON CONFLICT(ruleset_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  );
  for (const p of parameters) {
    const def = RULE_PARAMETER_DEFS.find((d) => d.key === p.key);
    if (!def) throw badRequest('UNKNOWN_PARAMETER', `Unknown rule parameter "${p.key}".`);
    def.parse(p.value); // throws on malformed value
    upsert.run(uuid(), rulesetId, p.key, p.value, now);
  }
  audit(db, {
    organizationId: rs.organizationId,
    userId: actor?.userId ?? null,
    username: actor?.username ?? null,
    action: 'RULESET_CHANGED',
    entity: 'rulesets',
    entityId: rulesetId,
    newValue: { parameters },
  });
  return rulesetParams(db, rulesetId);
}

export function listDivisions(db: Db, rulesetId: string, activeOnly = false): Division[] {
  const rows = activeOnly
    ? db.prepare('SELECT * FROM divisions WHERE ruleset_id = ? AND active = 1 ORDER BY name').all(rulesetId)
    : db.prepare('SELECT * FROM divisions WHERE ruleset_id = ? ORDER BY name').all(rulesetId);
  return (rows as Record<string, unknown>[]).map(mapDivision);
}

export function listCategories(db: Db, rulesetId: string, activeOnly = false): Category[] {
  const rows = activeOnly
    ? db.prepare('SELECT * FROM categories WHERE ruleset_id = ? AND active = 1 ORDER BY name').all(rulesetId)
    : db.prepare('SELECT * FROM categories WHERE ruleset_id = ? ORDER BY name').all(rulesetId);
  return (rows as Record<string, unknown>[]).map(mapCategory);
}

export function divisionById(db: Db, divisionId: string): Division {
  const row = db.prepare('SELECT * FROM divisions WHERE id = ?').get(divisionId) as Record<string, unknown> | undefined;
  if (!row) throw notFound('Division not found.');
  return mapDivision(row);
}

export function categoryById(db: Db, categoryId: string): Category {
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId) as Record<string, unknown> | undefined;
  if (!row) throw notFound('Category not found.');
  return mapCategory(row);
}

export function availableDisciplines(db: Db): string[] {
  return Object.keys(DISCIPLINE_DEFINITIONS);
}