import type { Db } from '../db/client.js';
import { uuid } from './utils.js';

export function notifyUser(db: Db, userId: string, type: string, title: string, body?: string | null): void {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO notifications (id, user_id, type, title, body, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
  ).run(uuid(), userId, type, title, body ?? null, now);
}

export function notifyRole(db: Db, role: string, type: string, title: string, body?: string | null): void {
  const rows = db.prepare('SELECT DISTINCT ur.user_id FROM user_roles ur WHERE ur.role = ?').all(role) as { user_id: string }[];
  for (const r of rows) notifyUser(db, r.user_id, type, title, body);
}

export function listNotifications(db: Db, userId: string): Record<string, unknown>[] {
  const rows = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(userId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    type: String(r.type),
    title: String(r.title),
    body: (r.body as string) ?? null,
    read: Number(r.read) === 1,
    createdAt: String(r.created_at),
  }));
}

export function unreadCount(db: Db, userId: string): number {
  const row = db.prepare('SELECT count(*) c FROM notifications WHERE user_id = ? AND read = 0').get(userId) as { c: number };
  return Number(row.c);
}

export function markNotificationRead(db: Db, userId: string, notificationId: string): void {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(notificationId, userId);
}

export function markAllRead(db: Db, userId: string): void {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId);
}