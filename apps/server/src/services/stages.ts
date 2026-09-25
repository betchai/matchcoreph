import type { Db } from '../db/client.js';
import { uuid, notFound, badRequest } from './utils.js';
import { audit } from './audit.js';
import type { Match, Stage, StageTarget } from '@blinkscore/core';
import { SCORING_METHODS, SCORING_ZONES, LOAD_TYPES, TARGET_TYPES } from '@blinkscore/core';

export function mapStage(row: Record<string, unknown>): Stage {
  return {
    id: String(row.id),
    matchId: String(row.match_id),
    number: Number(row.number),
    name: String(row.name),
    courseType: row.course_type as Stage['courseType'],
    scoringMethod: row.scoring_method as Stage['scoringMethod'],
    loadType: (row.load_type as Stage['loadType']) ?? null,
    minimumRounds: (row.minimum_rounds as number) ?? null,
    maximumRounds: (row.maximum_rounds as number) ?? null,
    requiredHits: (row.required_hits as number) ?? null,
    maximumStagePoints: Number(row.maximum_stage_points),
    fixedTimeSeconds: (row.fixed_time_seconds as number) ?? null,
    classifierDesignation: (row.classifier_designation as string) ?? null,
    startPosition: (row.start_position as string) ?? null,
    startCondition: (row.start_condition as string) ?? null,
    firearmCondition: (row.firearm_condition as string) ?? null,
    procedure: (row.procedure as string) ?? null,
    briefing: (row.briefing as string) ?? null,
    description: (row.description as string) ?? null,
    diagramUrl: (row.diagram_url as string) ?? null,
    active: Number(row.active) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapStageTarget(row: Record<string, unknown>): StageTarget {
  return {
    id: String(row.id),
    stageId: String(row.stage_id),
    number: Number(row.number),
    name: (row.name as string) ?? null,
    targetType: row.target_type as StageTarget['targetType'],
    requiredHits: (row.required_hits as number) ?? null,
    scoringZones: (row.scoring_zones as string | null)
      ? (JSON.parse(row.scoring_zones as string) as StageTarget['scoringZones'])
      : null,
    noShootRelatedTargetId: (row.no_shoot_related_target_id as string) ?? null,
    maxPoints: (row.max_points as number) ?? null,
    active: Number(row.active) === 1,
  };
}

export function getStage(db: Db, match: Match, stageId: string): Stage {
  const row = db
    .prepare('SELECT * FROM stages WHERE id = ? AND match_id = ?')
    .get(stageId, match.id) as Record<string, unknown> | undefined;
  if (!row) throw notFound('Stage not found.');
  return mapStage(row);
}

export function createStage(
  db: Db,
  match: Match,
  input: {
    number: number;
    name: string;
    courseType: string;
    scoringMethod: string;
    loadType?: 'FULL_LOAD' | 'MINIMUM_LOAD' | null;
    minimumRounds?: number | null;
    maximumRounds?: number | null;
    requiredHits?: number | null;
    maximumStagePoints: number;
    fixedTimeSeconds?: number | null;
    classifierDesignation?: string | null;
    startPosition?: string | null;
    startCondition?: string | null;
    firearmCondition?: string | null;
    procedure?: string | null;
    briefing?: string | null;
    description?: string | null;
    diagramUrl?: string | null;
  },
  actor: { userId: string; username: string | null } | null,
): Stage {
  if (!SCORING_METHODS.includes(input.scoringMethod as Stage['scoringMethod'])) {
    throw badRequest('BAD_METHOD', 'Invalid scoring method.');
  }
  if (input.loadType && !LOAD_TYPES.includes(input.loadType as (typeof LOAD_TYPES)[number])) {
    throw badRequest('BAD_LOAD_TYPE', 'Invalid load type.');
  }
  if (input.number <= 0) throw badRequest('BAD_STAGE_NUMBER', 'Stage number must be positive.');
  const existing = db.prepare('SELECT id FROM stages WHERE match_id = ? AND number = ?').get(match.id, input.number);
  if (existing) throw badRequest('STAGE_EXISTS', `A stage already exists at number ${input.number}.`);

  const id = uuid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO stages
      (id, match_id, organization_id, number, name, course_type, scoring_method, load_type, minimum_rounds, maximum_rounds,
       required_hits, maximum_stage_points, fixed_time_seconds, classifier_designation, start_position,
       start_condition, firearm_condition, procedure, briefing, description, diagram_url, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    id,
    match.id,
    match.organizationId,
    input.number,
    input.name,
    input.courseType,
    input.scoringMethod,
    input.loadType ?? null,
    input.minimumRounds ?? null,
    input.maximumRounds ?? null,
    input.requiredHits ?? null,
    input.maximumStagePoints,
    input.fixedTimeSeconds ?? null,
    input.classifierDesignation ?? null,
    input.startPosition ?? null,
    input.startCondition ?? null,
    input.firearmCondition ?? null,
    input.procedure ?? null,
    input.briefing ?? null,
    input.description ?? null,
    input.diagramUrl ?? null,
    now,
    now,
  );
  if (actor) {
    audit(db, {
      organizationId: match.organizationId,
      userId: actor.userId,
      username: actor.username,
      action: 'STAGE_CREATED',
      entity: 'stages',
      entityId: id,
      newValue: { number: input.number, name: input.name },
    });
  }
  return getStage(db, match, id);
}

export function updateStage(
  db: Db,
  match: Match,
  stage: Stage,
  patch: Partial<Stage>,
  actor: { userId: string; username: string | null } | null,
): Stage {
  const merged = { ...stage, ...patch };
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE stages SET
       number=?, name=?, course_type=?, scoring_method=?, load_type=?, minimum_rounds=?, maximum_rounds=?, required_hits=?,
       maximum_stage_points=?, fixed_time_seconds=?, classifier_designation=?, start_position=?, start_condition=?,
       firearm_condition=?, procedure=?, briefing=?, description=?, diagram_url=?, active=?, updated_at=?
     WHERE id=?`,
  ).run(
    merged.number,
    merged.name,
    merged.courseType,
    merged.scoringMethod,
    merged.loadType ?? null,
    merged.minimumRounds ?? null,
    merged.maximumRounds ?? null,
    merged.requiredHits ?? null,
    merged.maximumStagePoints,
    merged.fixedTimeSeconds ?? null,
    merged.classifierDesignation ?? null,
    merged.startPosition ?? null,
    merged.startCondition ?? null,
    merged.firearmCondition ?? null,
    merged.procedure ?? null,
    merged.briefing ?? null,
    merged.description ?? null,
    merged.diagramUrl ?? null,
    merged.active ? 1 : 0,
    now,
    stage.id,
  );
  if (actor) {
    audit(db, {
      organizationId: match.organizationId,
      userId: actor.userId,
      username: actor.username,
      action: 'STAGE_MODIFIED',
      entity: 'stages',
      entityId: stage.id,
      oldValue: stage,
      newValue: merged,
    });
  }
  return getStage(db, match, stage.id);
}

export function listStages(db: Db, match: Match, includeInactive = false): Stage[] {
  const rows = includeInactive
    ? db.prepare('SELECT * FROM stages WHERE match_id = ? ORDER BY number').all(match.id)
    : db.prepare('SELECT * FROM stages WHERE match_id = ? AND active = 1 ORDER BY number').all(match.id);
  return (rows as Record<string, unknown>[]).map(mapStage);
}

export function stageTargets(db: Db, stageId: string, includeInactive = false): StageTarget[] {
  const rows = includeInactive
    ? db.prepare('SELECT * FROM stage_targets WHERE stage_id = ? ORDER BY number').all(stageId)
    : db.prepare('SELECT * FROM stage_targets WHERE stage_id = ? AND active = 1 ORDER BY number').all(stageId);
  return (rows as Record<string, unknown>[]).map(mapStageTarget);
}

export function setStageTargets(
  db: Db,
  match: Match,
  stage: Stage,
  targets: {
    number: number;
    name?: string | null;
    targetType: string;
    requiredHits?: number | null;
    scoringZones?: string[] | null;
    noShootRelatedTargetId?: string | null;
    maxPoints?: number | null;
  }[],
  actor: { userId: string; username: string | null } | null,
): StageTarget[] {
  for (const t of targets) {
    if (!TARGET_TYPES.includes(t.targetType as StageTarget['targetType'])) {
      throw badRequest('BAD_TARGET_TYPE', `Invalid target type "${t.targetType}".`);
    }
    if (t.requiredHits !== null && t.requiredHits !== undefined && t.requiredHits < 1) {
      throw badRequest('BAD_REQUIRED_HITS', 'Required hits must be at least 1.');
    }
    if (t.scoringZones && t.scoringZones.length > 0) {
      for (const z of t.scoringZones) {
        if (!SCORING_ZONES.includes(z as (typeof SCORING_ZONES)[number])) {
          throw badRequest('BAD_ZONE', `Invalid scoring zone "${z}".`);
        }
      }
    }
  }
  const id = stage.id;
  db.prepare('DELETE FROM stage_targets WHERE stage_id = ?').run(id);
  const ins = db.prepare(
    'INSERT INTO stage_targets (id, stage_id, match_id, number, name, target_type, required_hits, scoring_zones, no_shoot_related_target_id, max_points, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
  );
  const now = new Date().toISOString();
  for (const t of targets) {
    ins.run(
      uuid(),
      id,
      match.id,
      t.number,
      t.name ?? null,
      t.targetType,
      t.requiredHits ?? null,
      t.scoringZones && t.scoringZones.length > 0 ? JSON.stringify(t.scoringZones) : null,
      t.noShootRelatedTargetId ?? null,
      t.maxPoints ?? null,
      now,
      now,
    );
  }
  if (actor) {
    audit(db, {
      organizationId: match.organizationId,
      userId: actor.userId,
      username: actor.username,
      action: 'STAGE_MODIFIED',
      entity: 'stage_targets',
      entityId: id,
      newValue: { targetCount: targets.length },
    });
  }
  return stageTargets(db, id);
}

export function deleteStage(db: Db, match: Match, stage: Stage, actor: { userId: string; username: string | null }): void {
  const scoreCount = (db.prepare('SELECT count(*) c FROM scores WHERE stage_id = ?').get(stage.id) as { c: number }).c;
  if (Number(scoreCount) > 0) {
    // Soft-delete to preserve historical scores; marks the stage inactive.
    db.prepare('UPDATE stages SET active = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), stage.id);
  } else {
    db.prepare('DELETE FROM stages WHERE id = ?').run(stage.id);
  }
  audit(db, {
    organizationId: match.organizationId,
    userId: actor.userId,
    username: actor.username,
    action: 'STAGE_REMOVED',
    entity: 'stages',
    entityId: stage.id,
    oldValue: stage.number,
  });
}