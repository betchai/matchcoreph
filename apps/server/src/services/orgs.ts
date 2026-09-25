import type { Db } from '../db/client.js';
import { uuid, notFound, conflict, badRequest } from './utils.js';
import { audit } from './audit.js';
import type { Organization } from '@blinkscore/core';

export function orgById(db: Db, organizationId: string): Organization {
  const row = db.prepare('SELECT * FROM organizations WHERE id = ?').get(organizationId) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound('Organization not found.');
  return mapOrg(row);
}

export function mapOrg(row: Record<string, unknown>): Organization {
  return {
    id: String(row.id),
    name: String(row.name),
    shortName: String(row.short_name),
    logoUrl: (row.logo_url as string) ?? null,
    address: (row.address as string) ?? null,
    city: (row.city as string) ?? null,
    province: (row.province as string) ?? null,
    country: (row.country as string) ?? null,
    email: (row.email as string) ?? null,
    phone: (row.phone as string) ?? null,
    website: (row.website as string) ?? null,
    activeStatus: row.active_status as 'active' | 'inactive',
    branding: JSON.parse(String(row.branding ?? '{}')) as Record<string, unknown>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createOrganization(
  db: Db,
  input: {
    name: string;
    shortName: string;
    logoUrl?: string | null;
    address?: string | null;
    city?: string | null;
    province?: string | null;
    country?: string | null;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
  },
  actor?: { userId: string | null; username: string | null },
): Organization {
  const existing = db.prepare('SELECT id FROM organizations WHERE name = ?').get(input.name);
  if (existing) throw conflict('ORG_EXISTS', 'An organization with that name already exists.');
  if (!input.shortName.trim()) throw badRequest('SHORT_NAME_REQUIRED', 'A short name is required.');
  const id = uuid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO organizations
      (id, name, short_name, logo_url, address, city, province, country, email, phone, website, active_status, branding, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', '{}', ?, ?)`,
  ).run(
    id,
    input.name,
    input.shortName,
    input.logoUrl ?? null,
    input.address ?? null,
    input.city ?? null,
    input.province ?? null,
    input.country ?? null,
    input.email ?? null,
    input.phone ?? null,
    input.website ?? null,
    now,
    now,
  );
  audit(db, {
    organizationId: id,
    userId: actor?.userId ?? null,
    username: actor?.username ?? null,
    action: 'ORGANIZATION_CREATED',
    entity: 'organizations',
    entityId: id,
    newValue: { name: input.name, shortName: input.shortName },
  });
  return orgById(db, id);
}

export function updateOrganization(
  db: Db,
  organizationId: string,
  patch: Partial<Organization>,
  actor?: { userId: string | null; username: string | null },
): Organization {
  const org = orgById(db, organizationId);
  const merged = { ...org, ...patch };
  if (merged.name !== org.name) {
    const existing = db.prepare('SELECT id FROM organizations WHERE name = ? AND id != ?').get(merged.name, organizationId);
    if (existing) throw conflict('ORG_EXISTS', 'An organization with that name already exists.');
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE organizations SET
       name=?, short_name=?, logo_url=?, address=?, city=?, province=?, country=?,
       email=?, phone=?, website=?, active_status=?, branding=?, updated_at=?
     WHERE id=?`,
  ).run(
    merged.name,
    merged.shortName,
    merged.logoUrl ?? null,
    merged.address ?? null,
    merged.city ?? null,
    merged.province ?? null,
    merged.country ?? null,
    merged.email ?? null,
    merged.phone ?? null,
    merged.website ?? null,
    merged.activeStatus,
    JSON.stringify(merged.branding ?? {}),
    now,
    organizationId,
  );
  audit(db, {
    organizationId,
    userId: actor?.userId ?? null,
    username: actor?.username ?? null,
    action: 'ORGANIZATION_MODIFIED',
    entity: 'organizations',
    entityId: organizationId,
    oldValue: org,
    newValue: merged,
  });
  return orgById(db, organizationId);
}

export function listOrganizations(db: Db, includeInactive = true): Organization[] {
  const rows = includeInactive
    ? db.prepare('SELECT * FROM organizations ORDER BY name').all()
    : db.prepare("SELECT * FROM organizations WHERE active_status = 'active' ORDER BY name").all();
  return (rows as Record<string, unknown>[]).map(mapOrg);
}

export function organizationStats(db: Db, organizationId: string): Record<string, unknown> {
  const org = orgById(db, organizationId);
  const shooters = (db.prepare('SELECT COUNT(*) c FROM shooters').get() as Record<string, unknown>).c;
  const matches = (db.prepare('SELECT COUNT(*) c FROM matches WHERE organization_id = ?').get(organizationId) as Record<string, unknown>).c;
  const activeMatches = (db.prepare("SELECT COUNT(*) c FROM matches WHERE organization_id = ? AND status NOT IN ('COMPLETED','CANCELLED','ARCHIVED')").get(organizationId) as Record<string, unknown>).c;
  const upcoming = (db.prepare("SELECT COUNT(*) c FROM matches WHERE organization_id = ? AND start_date >= date('now') AND status NOT IN ('COMPLETED','CANCELLED','ARCHIVED')").get(organizationId) as Record<string, unknown>).c;
  const pendingScores = (
    db.prepare(
      "SELECT COUNT(*) c FROM scores s JOIN matches m ON m.id = s.match_id WHERE m.organization_id = ? AND s.status IN ('DRAFT','SUBMITTED')",
    ).get(organizationId) as Record<string, unknown>
  ).c;
  return {
    ...org,
    stats: { shooters: Number(shooters), matches: Number(matches), activeMatches: Number(activeMatches), upcomingMatches: Number(upcoming), pendingScores: Number(pendingScores) },
  };
}