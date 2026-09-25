import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAnyPerm } from '../store/auth.js';
import { Card, Empty, ErrorBanner, Spinner, Table, Td, Th } from '../components/ui.js';

interface AuditRow {
  id: string;
  organizationId: string | null;
  userId: string | null;
  username: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

const detailText = (row: AuditRow): string => {
  const parts: string[] = [];
  if (row.entity) parts.push(row.entity);
  const value = row.newValue ?? row.oldValue;
  if (value) {
    try {
      const parsed = JSON.parse(value);
      const text = JSON.stringify(parsed);
      parts.push(text.length > 180 ? `${text.slice(0, 180)}…` : text);
    } catch {
      parts.push(row.entityId ?? '');
    }
  }
  return parts.join(' · ');
};

export default function AuditPage() {
  const can = useAnyPerm('platform.viewAudit');
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState('');
  const [orgNames, setOrgNames] = useState<Record<string, string>>({});

  useEffect(() => {
    setError('');
    Promise.all([
      api<AuditRow[]>('/api/platform/audit').then(setRows),
      api<{ id: string; name: string; shortName?: string | null }[]>('/api/platform/orgs')
        .then((orgs) => setOrgNames(Object.fromEntries(orgs.map((o) => [o.id, o.shortName || o.name]))))
        .catch(() => undefined),
    ]).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load audit log'));
  }, []);

  if (!can) return <ErrorBanner message="You don't have permission to view the platform audit log." />;
  if (error && rows === null) return <ErrorBanner message={error} />;
  if (!rows) return <Spinner />;
  if (rows.length === 0) return <Card className="p-4"><Empty>No audit activity recorded yet.</Empty></Card>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">Audit log</h2>
        <p className="mt-0.5 text-sm text-muted">Platform-wide activity trail, newest first.</p>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      <Card className="overflow-x-auto">
        <Table>
          <thead>
            <tr className="text-left">
              <Th>When</Th>
              <Th>User</Th>
              <Th>Organization</Th>
              <Th>Action</Th>
              <Th>Details</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td mono>{new Date(r.createdAt).toLocaleString()}</Td>
                <Td><span className="font-semibold text-ink">{r.username ?? 'system'}</span></Td>
                <Td><span className="text-muted">{r.organizationId ? (orgNames[r.organizationId] ?? r.organizationId.slice(0, 8)) : 'platform'}</span></Td>
                <Td><span className="text-xs font-bold uppercase tracking-wide text-ink">{r.action.replace(/_/g, ' ')}</span></Td>
                <Td><span className="text-muted">{detailText(r)}</span></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}