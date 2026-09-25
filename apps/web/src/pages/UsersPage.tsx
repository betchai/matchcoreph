import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { UserRoundPlus } from 'lucide-react';
import { MATCH_ROLE_ASSIGNABLE, ROLE_LABELS, type UserRole } from '@blinkscore/core';
import { api } from '../lib/api.js';
import { useAuth, useOrgPerm } from '../store/auth.js';
import { Badge, Button, Card, Empty, ErrorBanner, Field, Input, Select, Spinner, Table, Td, Th } from '../components/ui.js';

interface UserRow {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  role: UserRole | null;
  locked: boolean;
  mustChangePassword?: boolean;
}

const roleTone = (role: string): 'sky' | 'violet' | 'amber' | 'slate' =>
  role === 'PLATFORM_SUPER_ADMIN' ? 'sky'
    : role === 'PLATFORM_ADMIN' ? 'violet'
    : role === 'ORGANIZATION_ADMIN' ? 'amber'
    : 'slate';

const ASSIGNABLE = [...MATCH_ROLE_ASSIGNABLE];

const emptyDraft = () => ({
  username: '',
  displayName: '',
  email: '',
  password: '',
  role: 'SCOREKEEPER' as UserRole,
});

type Draft = ReturnType<typeof emptyDraft>;

export default function UsersPage() {
  const { orgId = '' } = useParams();
  const me = useAuth((s) => s.user);
  const canManage = useOrgPerm(orgId, 'org.users.manage');
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [editId, setEditId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('VIEWER');

  const load = () => {
    setError('');
    void api<UserRow[]>(`/api/orgs/${orgId}/users`)
      .then((u) => { setRows(u); setEditId((id) => (id && u.some((x) => x.id === id) ? id : null)); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load users'));
  };

  useEffect(load, [orgId]);

  function startCreate() {
    setDraft(emptyDraft());
    setFormOpen(true);
  }

  async function saveUser(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.username.trim() || !draft.email.trim() || !draft.password) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/orgs/${orgId}/users`, {
        method: 'POST',
        json: {
          username: draft.username.trim(),
          displayName: draft.displayName.trim() || null,
          email: draft.email.trim(),
          password: draft.password,
          role: draft.role,
        },
      });
      setNotice('User added.');
      setFormOpen(false);
      setDraft(emptyDraft());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add user');
    } finally {
      setBusy(false);
    }
  }

  async function saveRole(u: UserRow, role: UserRole) {
    if (role === u.role) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/orgs/${orgId}/users/${u.id}/role`, { method: 'PATCH', json: { role } });
      setNotice(`Role updated to ${ROLE_LABELS[role]}.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update role');
    } finally {
      setBusy(false);
    }
  }

  async function toggleLock(u: UserRow) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/orgs/${orgId}/users/${u.id}/locked`, { method: 'PATCH', json: { locked: !u.locked } });
      setNotice(u.locked ? 'User unlocked.' : 'User locked.');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status');
    } finally {
      setBusy(false);
    }
  }

  async function removeFromOrg(u: UserRow) {
    if (!window.confirm(`Remove ${u.displayName || u.username} from this organization? Their account stays on the platform.`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/orgs/${orgId}/users/${u.id}/role`, { method: 'DELETE' });
      setNotice(`${u.username} removed from the organization.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove user');
    } finally {
      setBusy(false);
    }
  }

  if (error && rows === null) return <ErrorBanner message={error} />;
  if (!rows) return <Spinner />;

  const isSelf = (u: UserRow) => u.id === me?.id;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Users</h2>
          <p className="mt-0.5 text-sm text-muted">
            People with access to this organization · <Link to={`/orgs/${orgId}`} className="font-medium text-brand hover:text-gold">Back to org</Link>
          </p>
        </div>
        {canManage && (
          <Button kind="secondary" onClick={formOpen ? () => setFormOpen(false) : startCreate}>
            <UserRoundPlus className="h-4 w-4" /> {formOpen ? 'Cancel' : 'Add user'}
          </Button>
        )}
      </div>

      {canManage && formOpen && (
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">Add a user to this organization</h3>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={saveUser}>
            <Field label="Username" required><Input value={draft.username} onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))} required /></Field>
            <Field label="Display name"><Input value={draft.displayName} onChange={(e) => setDraft((d) => ({ ...d, displayName: e.target.value }))} /></Field>
            <Field label="Email" required><Input type="email" value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} required /></Field>
            <Field label="Password" required><Input type="password" value={draft.password} onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))} required /></Field>
            <Field label="Role">
              <Select value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value as UserRole }))}>
                {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-2 lg:col-span-5 flex items-center justify-end gap-2">
              <Button type="submit" disabled={busy || !draft.username.trim() || !draft.email.trim() || !draft.password} kind="gold">{busy ? <Spinner className="h-4 w-4" /> : null} Add user</Button>
            </div>
          </form>
        </Card>
      )}

      {notice ? <p className="text-sm text-emerald-400">{notice}</p> : null}
      {error && rows ? <ErrorBanner message={error} /> : null}

      {rows.length === 0 ? (
        <Card className="p-4"><Empty>No users yet for this organization.</Empty></Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <thead>
              <tr className="text-left">
                <Th>User</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th right />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <Td>
                    <span className="font-semibold text-ink">{u.displayName || u.username}</span>
                    {isSelf(u) ? <span className="ml-1.5 text-xs text-muted">(you)</span> : null}
                  </Td>
                  <Td><span className="text-muted">{u.email}</span></Td>
                  <Td><Badge tone={roleTone(u.role ?? '')}>{u.role ? ROLE_LABELS[u.role as UserRole] ?? u.role.replace(/_/g, ' ') : 'No role'}</Badge></Td>
                  <Td><Badge tone={u.locked ? 'slate' : 'emerald'}>{u.locked ? 'Locked' : 'Active'}</Badge></Td>
                  <Td right>
                    {canManage && !isSelf(u) ? (
                      <div className="flex items-center justify-end gap-1.5">
                        {editId === u.id ? (
                          <>
                            <Select value={editRole} onChange={(e) => setEditRole(e.target.value as UserRole)} className="w-44">
                              {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                            </Select>
                            <Button kind="secondary" className="px-2.5 py-1 text-xs" disabled={busy} onClick={() => { setEditId(null); void saveRole(u, editRole); }}>Save</Button>
                            <Button kind="ghost" className="px-2.5 py-1 text-xs" onClick={() => setEditId(null)}>Cancel</Button>
                          </>
                        ) : (
                          <Button kind="ghost" className="px-2.5 py-1 text-xs" onClick={() => { setEditRole(u.role ?? 'VIEWER'); setEditId(u.id); }}>Manage</Button>
                        )}
                        <Button kind="ghost" className="px-2.5 py-1 text-xs" disabled={busy} onClick={() => { void toggleLock(u); }}>{u.locked ? 'Unlock' : 'Lock'}</Button>
                        <Button kind="ghost" className="px-2.5 py-1 text-xs text-[#ff6b6b]" disabled={busy} onClick={() => { void removeFromOrg(u); }}>Remove</Button>
                      </div>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}