import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { DDL, SCHEMA_VERSION } from './schema.js';

export type Db = Database.Database;

export function openDb(dataDir?: string): Db {
  const dir = dataDir ?? process.env.PSA_DATA_DIR ?? path.resolve(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'ppsa.db');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  const colsFor = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  // V2: shooters became a platform-wide roster. Some environments reached
  // user_version=2 before the rebuild code existed, so detect by shape too.
  const shootersOrgScoped = colsFor('shooters').includes('organization_id');
  const rebuildShooters = shootersOrgScoped;
  if (rebuildShooters) db.exec('PRAGMA foreign_keys = OFF');
  const run = db.transaction(() => {
    for (const ddl of DDL) {
      db.exec(ddl);
    }
    if (rebuildShooters) {
      db.exec(`
        CREATE TABLE shooters_v2 (
          id TEXT PRIMARY KEY,
          shooter_number TEXT NOT NULL UNIQUE,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          nickname TEXT,
          email TEXT,
          phone TEXT,
          home_club TEXT,
          ppsa_membership_number TEXT,
          ipsc_alias TEXT,
          gender TEXT,
          birth_year INTEGER,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO shooters_v2
          (id, shooter_number, first_name, last_name, nickname, email, phone, home_club, ppsa_membership_number, ipsc_alias, gender, birth_year, active, created_at, updated_at)
          SELECT id, shooter_number, first_name, last_name, nickname, email, phone, home_club, ppsa_membership_number, ipsc_alias, gender, birth_year, active, created_at, updated_at FROM shooters;
        DROP TABLE shooters;
        ALTER TABLE shooters_v2 RENAME TO shooters;
        CREATE INDEX IF NOT EXISTS idx_shooters_name ON shooters(last_name, first_name);
        CREATE INDEX IF NOT EXISTS idx_shooters_ppsa ON shooters(ppsa_membership_number);
      `);
    }
    // Additive column migrations for schemas created before the column existed.
    const addable: { table: string; column: string; ddl: string }[] = [
      { table: 'scores', column: 'last_modified_by', ddl: 'ALTER TABLE scores ADD COLUMN last_modified_by TEXT' },
      { table: 'stages', column: 'load_type', ddl: 'ALTER TABLE stages ADD COLUMN load_type TEXT' },
      { table: 'scores', column: 'final_time_seconds', ddl: 'ALTER TABLE scores ADD COLUMN final_time_seconds REAL' },
      { table: 'scores', column: 'time_adjustments_seconds', ddl: 'ALTER TABLE scores ADD COLUMN time_adjustments_seconds REAL' },
      { table: 'stage_results', column: 'final_time_seconds', ddl: 'ALTER TABLE stage_results ADD COLUMN final_time_seconds REAL' },
      { table: 'match_registrations', column: 'score_pin_hash', ddl: 'ALTER TABLE match_registrations ADD COLUMN score_pin_hash TEXT' },
      { table: 'divisions', column: 'created_at', ddl: 'ALTER TABLE divisions ADD COLUMN created_at TEXT NOT NULL DEFAULT \'\'' },
      { table: 'divisions', column: 'updated_at', ddl: 'ALTER TABLE divisions ADD COLUMN updated_at TEXT NOT NULL DEFAULT \'\'' },
      { table: 'categories', column: 'created_at', ddl: 'ALTER TABLE categories ADD COLUMN created_at TEXT NOT NULL DEFAULT \'\'' },
      { table: 'categories', column: 'updated_at', ddl: 'ALTER TABLE categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT \'\'' },
      { table: 'stage_targets', column: 'created_at', ddl: 'ALTER TABLE stage_targets ADD COLUMN created_at TEXT NOT NULL DEFAULT \'\'' },
      { table: 'stage_targets', column: 'updated_at', ddl: 'ALTER TABLE stage_targets ADD COLUMN updated_at TEXT NOT NULL DEFAULT \'\'' },
    ];
    for (const { table, column, ddl } of addable) {
      if (!colsFor(table).includes(column)) {
        db.exec(ddl);
      }
    }
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  });
  run();
  if (rebuildShooters) db.exec('PRAGMA foreign_keys = ON');
}

/** Maps a snake_case row to camelCase. */
export function cam<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())] = value;
  }
  return out;
}

export function camAll<T extends Record<string, unknown>>(rows: T[]): Record<string, unknown>[] {
  return rows.map(cam);
}

export function jsonParse<T = unknown>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}