export const SCHEMA_VERSION = 3;

export const DDL: string[] = [
  // ── Platform ──────────────────────────────────────────────────────────────
  `
  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    logo_url TEXT,
    address TEXT,
    city TEXT,
    province TEXT,
    country TEXT,
    email TEXT,
    phone TEXT,
    website TEXT,
    active_status TEXT NOT NULL DEFAULT 'active',
    branding TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    locked INTEGER NOT NULL DEFAULT 0,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    last_login_at TEXT,
    is_super_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `
  CREATE TABLE IF NOT EXISTS user_roles (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (organization_id, user_id, role)
  );`,
  `
  CREATE TABLE IF NOT EXISTS platform_admins (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`,
  `
  CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    impersonates TEXT,
    expires_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON auth_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON auth_sessions(token_hash);`,
  `
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    organization_id TEXT,
    user_id TEXT,
    username TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    old_value TEXT,
    new_value TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(organization_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);`,
  `
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);`,

  // ── Rules ─────────────────────────────────────────────────────────────────
  `
  CREATE TABLE IF NOT EXISTS rulesets (
    id TEXT PRIMARY KEY,
    organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    organization_code TEXT NOT NULL,
    discipline TEXT NOT NULL,
    version TEXT NOT NULL,
    effective_date TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    source_citation TEXT,
    parent_ruleset_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (organization_code, discipline, version)
  );`,
  `
  CREATE TABLE IF NOT EXISTS rule_parameters (
    id TEXT PRIMARY KEY,
    ruleset_id TEXT NOT NULL REFERENCES rulesets(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    label TEXT,
    description TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (ruleset_id, key)
  );`,
  `
  CREATE TABLE IF NOT EXISTS divisions (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    discipline TEXT NOT NULL,
    ruleset_id TEXT NOT NULL REFERENCES rulesets(id) ON DELETE CASCADE,
    major_power_factor INTEGER NOT NULL DEFAULT 0,
    minor_power_factor INTEGER NOT NULL DEFAULT 1,
    major_allowed INTEGER NOT NULL DEFAULT 0,
    maximum_capacity INTEGER,
    equipment_restrictions TEXT,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (code, ruleset_id)
  );`,
  `
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    discipline TEXT,
    ruleset_id TEXT NOT NULL REFERENCES rulesets(id) ON DELETE CASCADE,
    description TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (code, ruleset_id)
  );`,

  // ── Shooters (platform-wide roster; not tied to an organization) ──────────
  `
  CREATE TABLE IF NOT EXISTS shooters (
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
  CREATE INDEX IF NOT EXISTS idx_shooters_name ON shooters(last_name, first_name);
  CREATE INDEX IF NOT EXISTS idx_shooters_ppsa ON shooters(ppsa_membership_number);`,

  // ── Matches ───────────────────────────────────────────────────────────────
  `
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    match_type TEXT NOT NULL,
    start_date TEXT NOT NULL,
    start_time TEXT,
    end_date TEXT,
    venue TEXT,
    match_director_user_id TEXT,
    range_master_user_id TEXT,
    match_level INTEGER NOT NULL DEFAULT 1,
    sanctioning_status TEXT NOT NULL DEFAULT 'CLUB',
    status TEXT NOT NULL DEFAULT 'DRAFT',
    visibility TEXT NOT NULL DEFAULT 'PRIVATE',
    ruleset_id TEXT NOT NULL,
    ruleset_version TEXT NOT NULL,
    aggregate_method TEXT,
    tie_break_method TEXT NOT NULL DEFAULT 'NONE',
    tournament_parent_id TEXT,
    published_at TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_matches_org ON matches(organization_id, start_date);
  CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);`,
  `
  CREATE TABLE IF NOT EXISTS match_disciplines (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    discipline TEXT NOT NULL,
    UNIQUE (match_id, discipline)
  );`,
  `
  CREATE TABLE IF NOT EXISTS match_divisions (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    division_id TEXT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
    UNIQUE (match_id, division_id)
  );`,
  `
  CREATE TABLE IF NOT EXISTS match_categories (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    UNIQUE (match_id, category_id)
  );`,
  `
  CREATE TABLE IF NOT EXISTS stages (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    name TEXT NOT NULL,
    course_type TEXT NOT NULL DEFAULT 'SHORT',
    scoring_method TEXT NOT NULL DEFAULT 'COMSTOCK',
    load_type TEXT,
    minimum_rounds INTEGER,
    maximum_rounds INTEGER,
    required_hits INTEGER,
    maximum_stage_points REAL NOT NULL DEFAULT 100,
    fixed_time_seconds REAL,
    classifier_designation TEXT,
    start_position TEXT,
    start_condition TEXT,
    firearm_condition TEXT,
    procedure TEXT,
    briefing TEXT,
    description TEXT,
    diagram_url TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (match_id, number)
  );
  CREATE INDEX IF NOT EXISTS idx_stages_match ON stages(match_id);`,
  `
  CREATE TABLE IF NOT EXISTS stage_targets (
    id TEXT PRIMARY KEY,
    stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
    match_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    name TEXT,
    target_type TEXT NOT NULL,
    required_hits INTEGER,
    scoring_zones TEXT,
    no_shoot_related_target_id TEXT,
    max_points REAL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (stage_id, number)
  );
  CREATE INDEX IF NOT EXISTS idx_stagetargets_stage ON stage_targets(stage_id);`,
  `
  CREATE TABLE IF NOT EXISTS squads (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    stage_number INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (match_id, name)
  );
  CREATE INDEX IF NOT EXISTS idx_squads_match ON squads(match_id);`,
  `
  CREATE TABLE IF NOT EXISTS match_registrations (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL,
    shooter_id TEXT NOT NULL REFERENCES shooters(id) ON DELETE CASCADE,
    shooter_number TEXT NOT NULL,
    division_id TEXT,
    category_id TEXT,
    declared_power_factor TEXT NOT NULL DEFAULT 'MINOR',
    squad_id TEXT,
    status TEXT NOT NULL DEFAULT 'REGISTERED',
    match_number TEXT,
    notes TEXT,
    score_pin_hash TEXT,
    registered_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (match_id, shooter_id)
  );
  CREATE INDEX IF NOT EXISTS idx_registrations_match ON match_registrations(match_id);
  CREATE INDEX IF NOT EXISTS idx_registrations_squad ON match_registrations(squad_id);
  CREATE INDEX IF NOT EXISTS idx_registrations_division ON match_registrations(division_id);`,
  `
  CREATE TABLE IF NOT EXISTS scores (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
    registration_id TEXT NOT NULL REFERENCES match_registrations(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    sync_status TEXT NOT NULL DEFAULT 'SYNCED',
    time_seconds REAL,
    hits_json TEXT NOT NULL DEFAULT '{}',
    misses INTEGER NOT NULL DEFAULT 0,
    paper_no_shoots INTEGER NOT NULL DEFAULT 0,
    procedurals INTEGER NOT NULL DEFAULT 0,
    penalties_other INTEGER NOT NULL DEFAULT 0,
    shots_fired INTEGER,
    penalty_events_json TEXT,
    target_details_json TEXT,
    config_errors_json TEXT,
    warnings_json TEXT,
    raw_points REAL,
    penalty_points REAL,
    net_points REAL,
    hit_factor REAL,
    final_time_seconds REAL,
    time_adjustments_seconds REAL,
    sync_token TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    entered_by TEXT,
    submitted_by TEXT,
    verified_by TEXT,
    scored_at TEXT,
    submitted_at TEXT,
    verified_at TEXT,
    locked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_modified_by TEXT,
    UNIQUE (stage_id, registration_id)
  );
  CREATE INDEX IF NOT EXISTS idx_scores_stage ON scores(stage_id);
  CREATE INDEX IF NOT EXISTS idx_scores_reg ON scores(registration_id);
  CREATE INDEX IF NOT EXISTS idx_scores_status ON scores(status);`,
  `
  CREATE TABLE IF NOT EXISTS score_corrections (
    id TEXT PRIMARY KEY,
    score_id TEXT NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
    field TEXT NOT NULL,
    previous_value TEXT,
    new_value TEXT,
    reason TEXT NOT NULL,
    authorized_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_corrections_score ON score_corrections(score_id);`,
  `
  CREATE TABLE IF NOT EXISTS disputes (
    id TEXT PRIMARY KEY,
    score_id TEXT NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
    registration_id TEXT NOT NULL,
    match_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    comment TEXT,
    attachment_url TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN',
    opened_by TEXT NOT NULL,
    resolved_by TEXT,
    resolution TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_disputes_match ON disputes(match_id, status);`,
  `
  CREATE TABLE IF NOT EXISTS attendance_records (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    registration_id TEXT NOT NULL UNIQUE,
    squad_id TEXT,
    checked_in_at TEXT NOT NULL,
    checked_in_by TEXT NOT NULL
  );`,
  `
  CREATE TABLE IF NOT EXISTS match_assignments (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    stage_id TEXT,
    squad_id TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (match_id, user_id, role, stage_id)
  );
  CREATE INDEX IF NOT EXISTS idx_assignments_match ON match_assignments(match_id);`,
  `
  CREATE TABLE IF NOT EXISTS chronograph_sessions (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    registration_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    discipline TEXT NOT NULL,
    bullet_weight_grains REAL,
    shot1_velocity REAL,
    shot2_velocity REAL,
    shot3_velocity REAL,
    calculated_power_factor REAL,
    declared_power_factor TEXT NOT NULL,
    verified_power_factor TEXT,
    final_scoring_factor TEXT,
    notes TEXT,
    recorded_by TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE (match_id, registration_id, discipline)
  );`,
  `
  CREATE TABLE IF NOT EXISTS tournament_components (
    id TEXT PRIMARY KEY,
    tournament_match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    component_match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    weight REAL NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (tournament_match_id, component_match_id)
  );`,
  `
  CREATE TABLE IF NOT EXISTS tournament_results (
    id TEXT PRIMARY KEY,
    tournament_match_id TEXT NOT NULL,
    registration_id TEXT NOT NULL,
    aggregate_points REAL,
    rank INTEGER,
    tie_count INTEGER,
    calculated_at TEXT NOT NULL,
    UNIQUE (tournament_match_id, registration_id)
  );`,
  `
  CREATE TABLE IF NOT EXISTS stage_results (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    division_id TEXT NOT NULL,
    registration_id TEXT NOT NULL,
    hit_factor REAL,
    final_time_seconds REAL,
    stage_points REAL,
    rank INTEGER,
    tie INTEGER NOT NULL DEFAULT 0,
    calculated_at TEXT NOT NULL,
    UNIQUE (stage_id, division_id, registration_id)
  );`,
  `
  CREATE TABLE IF NOT EXISTS match_results (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    division_id TEXT NOT NULL,
    registration_id TEXT NOT NULL,
    match_total REAL,
    rank INTEGER,
    tie INTEGER NOT NULL DEFAULT 0,
    calculated_at TEXT NOT NULL,
    UNIQUE (match_id, division_id, registration_id)
  );`,
];

export function nowIso(): string {
  return new Date().toISOString();
}