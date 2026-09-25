import type { Db } from '../db/client.js';
import { uuid, notFound, conflict, badRequest } from './utils.js';
import { audit } from './audit.js';
import { getRuleset, listDivisions, listCategories, divisionById, categoryById } from './rulesets.js';
import type {
  Discipline,
  Match,
  MatchType,
  ResultVisibility,
  SanctioningStatus,
  TieBreakMethod,
} from '@blinkscore/core';
import { MATCH_TYPES } from '@blinkscore/core';

export interface MatchWizardState {
  stepBasic: boolean;
  stepEventType: boolean;
  stepDisciplines: boolean;
  stepRuleset: boolean;
  stepDivisionsCategories: boolean;
  stepStages: boolean;
  stepSquads: boolean;
  stepRegistrations: boolean;
  stepPublish: boolean;
  completedSteps: string[];
  nextStep: string;
  readyToPublish: boolean;
}

export function mapMatch(row: Record<string, unknown>): Match {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    matchType: row.match_type as MatchType,
    startDate: String(row.start_date),
    startTime: (row.start_time as string) ?? null,
    endDate: (row.end_date as string) ?? null,
    venue: (row.venue as string) ?? null,
    matchDirectorUserId: (row.match_director_user_id as string) ?? null,
    rangeMasterUserId: (row.range_master_user_id as string) ?? null,
    matchLevel: Number(row.match_level) as Match['matchLevel'],
    sanctioningStatus: row.sanctioning_status as SanctioningStatus,
    status: row.status as Match['status'],
    visibility: row.visibility as ResultVisibility,
    rulesetId: String(row.ruleset_id),
    rulesetVersion: String(row.ruleset_version),
    aggregateMethod: (row.aggregate_method as Match['aggregateMethod']) ?? null,
    tieBreakMethod: (row.tie_break_method as TieBreakMethod) ?? 'NONE',
    tournamentParentId: (row.tournament_parent_id as string) ?? null,
    publishedAt: (row.published_at as string) ?? null,
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getMatch(db: Db, organizationId: string, matchId: string): Match {
  const row = db
    .prepare('SELECT * FROM matches WHERE id = ? AND organization_id = ?')
    .get(matchId, organizationId) as Record<string, unknown> | undefined;
  if (!row) throw notFound('Match not found in this organization.');
  return mapMatch(row);
}

export function listMatches(
  db: Db,
  organizationId: string,
  filters: { status?: string; type?: string; from?: string; search?: string } = {},
): Match[] {
  const where = ['organization_id = @org'];
  const params: Record<string, unknown> = { org: organizationId };
  if (filters.status) {
    where.push('status = @status');
    params.status = filters.status;
  }
  if (filters.type) {
    where.push('match_type = @type');
    params.type = filters.type;
  }
  if (filters.from) {
    where.push('start_date >= @from');
    params.from = filters.from;
  }
  if (filters.search) {
    where.push('name LIKE @search');
    params.search = `%${filters.search}%`;
  }
  const rows = db
    .prepare(`SELECT * FROM matches WHERE ${where.join(' AND ')} ORDER BY start_date DESC, created_at DESC LIMIT 500`)
    .all(params) as Record<string, unknown>[];
  return rows.map(mapMatch);
}

export function createMatch(
  db: Db,
  organizationId: string,
  input: {
    name: string;
    matchType: MatchType;
    startDate: string;
    startTime?: string | null;
    endDate?: string | null;
    venue?: string | null;
    matchDirectorUserId?: string | null;
    rangeMasterUserId?: string | null;
    matchLevel?: number;
    sanctioningStatus?: SanctioningStatus;
  },
  actor: { userId: string; username: string | null },
): Match {
  if (!MATCH_TYPES.includes(input.matchType)) throw badRequest('BAD_MATCH_TYPE', 'Invalid match type.');
  const id = uuid();
  const now = new Date().toISOString();
  const defaults = seedRulesetFor(db, organizationId, (input as { discipline?: Discipline } | null)?.discipline, actor);
  db.prepare(
    `INSERT INTO matches
      (id, organization_id, name, match_type, start_date, start_time, end_date, venue,
       match_director_user_id, range_master_user_id, match_level, sanctioning_status, status,
       visibility, ruleset_id, ruleset_version, tie_break_method, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'PRIVATE', ?, ?, 'NONE', ?, ?, ?)`,
  ).run(
    id,
    organizationId,
    input.name,
    input.matchType,
    input.startDate,
    input.startTime ?? null,
    input.endDate ?? null,
    input.venue ?? null,
    input.matchDirectorUserId ?? null,
    input.rangeMasterUserId ?? null,
    input.matchLevel ?? 1,
    input.sanctioningStatus ?? 'CLUB',
    defaults.id,
    defaults.version,
    actor.userId,
    now,
    now,
  );
  // Seed the organization default ruleset's divisions & categories as the match's initial choice.
  const divs = listDivisions(db, defaults.id, true);
  const cats = listCategories(db, defaults.id, true);
  const insDiv = db.prepare('INSERT INTO match_divisions (id, match_id, division_id) VALUES (?, ?, ?)');
  for (const d of divs) insDiv.run(uuid(), id, d.id);
  const insCat = db.prepare('INSERT INTO match_categories (id, match_id, category_id) VALUES (?, ?, ?)');
  for (const c of cats) insCat.run(uuid(), id, c.id);

  audit(db, {
    organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'MATCH_CREATED',
    entity: 'matches',
    entityId: id,
    newValue: { name: input.name, matchType: input.matchType, startDate: input.startDate },
  });
  return getMatch(db, organizationId, id);
}

/** Resolves which ruleset a freshly created match should snapshot. */
function seedRulesetFor(
  db: Db,
  organizationId: string,
  disciplineHint: Discipline | undefined,
  actor: { userId: string; username: string | null },
): { id: string; version: string } {
  const discipline = disciplineHint ?? 'HANDGUN';
  const row = db
    .prepare("SELECT id, version FROM rulesets WHERE discipline = ? AND status = 'ACTIVE' AND organization_code = 'PPSA' ORDER BY effective_date DESC LIMIT 1")
    .get(discipline) as Record<string, unknown> | undefined;
  if (row) return { id: String(row.id), version: String(row.version) };
  const ppsa = db
    .prepare("SELECT id, version FROM rulesets WHERE discipline = ? AND status = 'ACTIVE' ORDER BY effective_date DESC LIMIT 1")
    .get(discipline) as Record<string, unknown> | undefined;
  if (ppsa) return { id: String(ppsa.id), version: String(ppsa.version) };
  throw conflict('NO_RULESET', `No active ruleset is available for ${discipline}. Ask the platform administrator to configure one.`);
}

export function updateMatch(
  db: Db,
  match: Match,
  patch: Partial<Match>,
  actor: { userId: string; username: string | null },
  orgName?: string,
): Match {
  const merged = { ...match, ...patch };
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE matches SET
       name=?, match_type=?, start_date=?, start_time=?, end_date=?, venue=?,
       match_director_user_id=?, range_master_user_id=?, match_level=?, sanctioning_status=?,
       status=?, visibility=?, aggregate_method=?, tie_break_method=?, updated_at=?
     WHERE id=?`,
  ).run(
    merged.name,
    merged.matchType,
    merged.startDate,
    merged.startTime ?? null,
    merged.endDate ?? null,
    merged.venue ?? null,
    merged.matchDirectorUserId ?? null,
    merged.rangeMasterUserId ?? null,
    merged.matchLevel,
    merged.sanctioningStatus,
    merged.status,
    merged.visibility,
    merged.aggregateMethod ?? null,
    merged.tieBreakMethod,
    now,
    merged.id,
  );
  audit(db, {
    organizationId: merged.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'MATCH_MODIFIED',
    entity: 'matches',
    entityId: merged.id,
    oldValue: match,
    newValue: merged,
  });
  void orgName;
  return getMatch(db, merged.organizationId, merged.id);
}

export function setMatchDisciplines(
  db: Db,
  match: Match,
  disciplines: Discipline[],
  actor: { userId: string; username: string | null },
): void {
  const id = match.id;
  const run = () => {
    db.prepare('DELETE FROM match_disciplines WHERE match_id = ?').run(id);
    const ins = db.prepare('INSERT INTO match_disciplines (id, match_id, discipline) VALUES (?, ?, ?)');
    for (const d of disciplines) ins.run(uuid(), id, d);
  };
  run();
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'MATCH_MODIFIED',
    entity: 'match_disciplines',
    entityId: id,
    newValue: { disciplines },
  });
}

export function setMatchRuleset(
  db: Db,
  match: Match,
  rulesetId: string,
  actor: { userId: string; username: string | null },
): Match {
  const rs = getRuleset(db, rulesetId);
  // Ensure the ruleset discipline is among the match disciplines.
  const md = db.prepare('SELECT discipline FROM match_disciplines WHERE match_id = ?').all(match.id) as {
    discipline: string;
  }[];
  if (md.length > 0 && !md.some((m) => m.discipline === rs.discipline)) {
    setMatchDisciplines(db, match, [...md.map((m) => m.discipline as Discipline), rs.discipline], actor);
  } else if (md.length === 0) {
    setMatchDisciplines(db, match, [rs.discipline], actor);
  }
  db.prepare('UPDATE matches SET ruleset_id = ?, ruleset_version = ?, updated_at = ? WHERE id = ?').run(
    rs.id,
    rs.version,
    new Date().toISOString(),
    match.id,
  );
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'RULESET_CHANGED',
    entity: 'matches',
    entityId: match.id,
    oldValue: match.rulesetId,
    newValue: rulesetId,
  });
  return getMatch(db, match.organizationId, match.id);
}

export function setMatchDivisionsCategories(
  db: Db,
  match: Match,
  input: { divisionIds: string[]; categoryIds: string[] },
  actor: { userId: string; username: string | null },
): void {
  for (const d of input.divisionIds) {
    const div = divisionById(db, d);
    if (div.rulesetId !== match.rulesetId) {
      throw conflict('DIVISION_RULESET_MISMATCH', `Division "${div.name}" belongs to a different ruleset than the match.`);
    }
  }
  for (const c of input.categoryIds) {
    const cat = categoryById(db, c);
    if (cat.rulesetId !== match.rulesetId) {
      throw conflict('CATEGORY_RULESET_MISMATCH', `Category "${cat.name}" belongs to a different ruleset than the match.`);
    }
  }
  db.prepare('DELETE FROM match_divisions WHERE match_id = ?').run(match.id);
  db.prepare('DELETE FROM match_categories WHERE match_id = ?').run(match.id);
  const insDiv = db.prepare('INSERT INTO match_divisions (id, match_id, division_id) VALUES (?, ?, ?)');
  for (const d of input.divisionIds) insDiv.run(uuid(), match.id, d);
  const insCat = db.prepare('INSERT INTO match_categories (id, match_id, category_id) VALUES (?, ?, ?)');
  for (const c of input.categoryIds) insCat.run(uuid(), match.id, c);
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'MATCH_MODIFIED',
    entity: 'matches',
    entityId: match.id,
    newValue: { divisionIds: input.divisionIds, categoryIds: input.categoryIds },
  });
}

export function wizardState(db: Db, match: Match): MatchWizardState {
  const disciplines = db.prepare('SELECT discipline FROM match_disciplines WHERE match_id = ?').all(match.id).length;
  const divisions = db.prepare('SELECT count(*) c FROM match_divisions WHERE match_id = ?').get(match.id) as { c: number };
  const categories = db.prepare('SELECT count(*) c FROM match_categories WHERE match_id = ?').get(match.id) as { c: number };
  const stages = db.prepare('SELECT count(*) c FROM stages WHERE match_id = ? AND active = 1').get(match.id) as { c: number };
  const squads = db.prepare('SELECT count(*) c FROM squads WHERE match_id = ?').get(match.id) as { c: number };
  const registrations = db.prepare('SELECT count(*) c FROM match_registrations WHERE match_id = ?').get(match.id) as { c: number };

  const stepBasic = Boolean(match.name && match.startDate);
  const stepEventType = Boolean(match.matchType);
  const stepDisciplines = disciplines > 0;
  const stepRuleset = match.rulesetId !== '';
  const stepDivisionsCategories = Number(divisions.c) > 0 && Number(categories.c) > 0;
  const stepStages = Number(stages.c) > 0;
  const stepSquads = Number(squads.c) > 0 || match.matchType === 'TOURNAMENT';
  const stepRegistrations = Number(registrations.c) > 0;
  const stepPublish = false;

  const order = ['stepBasic', 'stepEventType', 'stepDisciplines', 'stepRuleset', 'stepDivisionsCategories', 'stepStages', 'stepSquads', 'stepRegistrations'] as const;
  const steps: { [k in (typeof order)[number]]: boolean } = {
    stepBasic,
    stepEventType,
    stepDisciplines,
    stepRuleset,
    stepDivisionsCategories,
    stepStages,
    stepSquads,
    stepRegistrations,
  };
  const completedSteps = order.filter((s) => steps[s]);
  const nextStep = order.find((s) => !steps[s]) ?? 'stepPublish';
  const readyToPublish = completedSteps.length === order.length && match.status !== 'COMPLETED';

  return {
    stepBasic,
    stepEventType,
    stepDisciplines,
    stepRuleset,
    stepDivisionsCategories,
    stepStages,
    stepSquads,
    stepRegistrations,
    stepPublish,
    completedSteps: [...completedSteps],
    nextStep,
    readyToPublish,
  };
}

export function publishMatch(db: Db, match: Match, actor: { userId: string; username: string | null }): Match {
  const w = wizardState(db, match);
  if (!w.readyToPublish) {
    throw badRequest('INCOMPLETE_CONFIG', `Match cannot be published yet. Complete step "${w.nextStep}" first.`);
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE matches SET status = 'PUBLISHED', visibility = 'INTERNAL', published_at = ?, updated_at = ? WHERE id = ?").run(
    now,
    now,
    match.id,
  );
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'MATCH_PUBLISHED',
    entity: 'matches',
    entityId: match.id,
    newValue: { status: 'PUBLISHED', visibility: 'INTERNAL', publishedAt: now },
  });
  return getMatch(db, match.organizationId, match.id);
}

export function setMatchStatus(
  db: Db,
  match: Match,
  status: Match['status'],
  actor: { userId: string; username: string | null },
): Match {
  const allowed: Match['status'][] = ['DRAFT', 'CONFIGURED', 'PUBLISHED', 'ONGOING', 'COMPLETED', 'CANCELLED', 'ARCHIVED'];
  if (!allowed.includes(status)) throw badRequest('BAD_STATUS', 'Invalid match status.');
  if (match.status === 'COMPLETED' && status !== 'ARCHIVED') {
    throw conflict('MATCH_COMPLETED', 'A completed match may only be archived.');
  }
  db.prepare('UPDATE matches SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), match.id);
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'MATCH_MODIFIED',
    entity: 'matches',
    entityId: match.id,
    oldValue: match.status,
    newValue: status,
  });
  return getMatch(db, match.organizationId, match.id);
}

export function deleteMatch(db: Db, match: Match, actor: { userId: string; username: string | null }): void {
  if (!['DRAFT', 'CONFIGURED'].includes(match.status)) {
    throw conflict('MATCH_NOT_DELETABLE', 'Only matches in DRAFT or CONFIGURED status can be deleted.');
  }
  db.prepare('DELETE FROM matches WHERE id = ?').run(match.id);
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'MATCH_MODIFIED',
    entity: 'matches',
    entityId: match.id,
    oldValue: match.status,
    newValue: 'DELETED',
  });
}

export function matchView(db: Db, match: Match): Record<string, unknown> {
  const disciplines = db.prepare('SELECT ROWID, discipline FROM match_disciplines WHERE match_id = ?').all(match.id) as {
    discipline: Discipline;
  }[];
  const divisions = db
    .prepare('SELECT d.* FROM match_divisions md JOIN divisions d ON d.id = md.division_id WHERE md.match_id = ?')
    .all(match.id) as Record<string, unknown>[];
  const categories = db
    .prepare('SELECT c.* FROM match_categories mc JOIN categories c ON c.id = mc.category_id WHERE mc.match_id = ?')
    .all(match.id) as Record<string, unknown>[];
  const stages = db.prepare('SELECT * FROM stages WHERE match_id = ? AND active = 1 ORDER BY number').all(match.id) as Record<string, unknown>[];
  const squads = db.prepare('SELECT * FROM squads WHERE match_id = ? ORDER BY name').all(match.id) as Record<string, unknown>[];
  const registrations = db.prepare('SELECT count(*) c FROM match_registrations WHERE match_id = ?').get(match.id) as { c: number };
  const rs = getRuleset(db, match.rulesetId);
  return {
    ...match,
    disciplineCodes: disciplines.map((d) => d.discipline),
    divisions: divisions.map((d) => ({
      id: String(d.id),
      code: String(d.code),
      name: String(d.name),
      discipline: d.discipline,
    })),
    categories: categories.map((c) => ({
      id: String(c.id),
      code: String(c.code),
      name: String(c.name),
    })),
    stageCount: stages.length,
    squadCount: squads.length,
    registrationCount: Number(registrations.c),
    ruleset: { ...rs, parameters: [] },
    wizard: wizardState(db, match),
  };
}

export function matchControlStats(db: Db, match: Match): Record<string, unknown> {
  const total = (db.prepare('SELECT count(*) c FROM match_registrations WHERE match_id = ?').get(match.id) as { c: number }).c;
  const checkedIn = (db.prepare("SELECT count(*) c FROM match_registrations WHERE match_id = ? AND status IN ('CHECKED_IN','ACTIVE','COMPLETED','DQ')").get(match.id) as { c: number }).c;
  const scoringStatuses = "('CHECKED_IN','ACTIVE','COMPLETED')";
  const scored = (db.prepare(`SELECT count(DISTINCT registration_id) c FROM scores s JOIN match_registrations r ON r.id = s.registration_id WHERE s.match_id = ? AND r.status IN ${scoringStatuses}`).get(match.id) as { c: number }).c;
  const verified = (db.prepare("SELECT count(DISTINCT registration_id) c FROM scores WHERE match_id = ? AND status IN ('VERIFIED','LOCKED','CORRECTED')").get(match.id) as { c: number }).c;
  const disputed = (db.prepare('SELECT count(*) c FROM disputes WHERE match_id = ? AND status = ?').get(match.id, 'OPEN') as { c: number }).c;
  const stages = db.prepare('SELECT * FROM stages WHERE match_id = ? AND active = 1 ORDER BY number').all(match.id) as Record<string, unknown>[];
  const stageStatuses = stages.map((s) => {
    const got = (db.prepare('SELECT count(DISTINCT registration_id) c FROM scores WHERE stage_id = ? AND time_seconds IS NOT NULL').get(s.id) as { c: number }).c;
    return { stageId: String(s.id), number: Number(s.number), name: String(s.name), scoredCount: Number(got), totalRegistrations: total };
  });
  return {
    totalCompetitors: total,
    checkedIn,
    scored,
    verified,
    pendingVerification: Math.max(0, scored - verified),
    disputed,
    stagesCompleted: stageStatuses.filter((s) => s.scoredCount >= Math.max(1, Math.ceil(total * 0.5))).length,
    overallCompletionPct: total === 0 ? 0 : Math.round((scored / Math.max(1, total)) * 100),
    stageStatuses,
  };
}