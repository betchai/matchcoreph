import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { UserRoundPlus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAnyPerm } from '../store/auth.js';
import { Button, Card, Empty, ErrorBanner, Field, Input, Select, Spinner, Table, Td, Th } from '../components/ui.js';

type ShooterRow = {
  id: string;
  shooterNumber: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  email: string | null;
  phone: string | null;
  homeClub: string | null;
  ppsaMembershipNumber: string | null;
  ipscAlias: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY' | null;
  birthYear: number | null;
  active: boolean;
};

const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'] as const;

const emptyDraft = () => ({
  firstName: '',
  lastName: '',
  nickname: '',
  email: '',
  phone: '',
  homeClub: '',
  ppsaMembershipNumber: '',
  ipscAlias: '',
  gender: '',
  birthYear: '',
});

type Draft = ReturnType<typeof emptyDraft>;

function toDraft(s: ShooterRow): Draft {
  return {
    firstName: s.firstName,
    lastName: s.lastName,
    nickname: s.nickname ?? '',
    email: s.email ?? '',
    phone: s.phone ?? '',
    homeClub: s.homeClub ?? '',
    ppsaMembershipNumber: s.ppsaMembershipNumber ?? '',
    ipscAlias: s.ipscAlias ?? '',
    gender: s.gender ?? '',
    birthYear: s.birthYear === null ? '' : String(s.birthYear),
  };
}

const payload = (d: Draft) => ({
  firstName: d.firstName.trim(),
  lastName: d.lastName.trim(),
  nickname: d.nickname.trim() || null,
  email: d.email.trim() || null,
  phone: d.phone.trim() || null,
  homeClub: d.homeClub.trim() || null,
  ppsaMembershipNumber: d.ppsaMembershipNumber.trim() || null,
  ipscAlias: d.ipscAlias.trim() || null,
  gender: d.gender || null,
  birthYear: d.birthYear ? Number(d.birthYear) : null,
});

export default function ShootersPage() {
  const { orgId = '' } = useParams();
  const canAdd = useAnyPerm('shooter.manage');
  const canEdit = useAnyPerm('shooter.edit');
  const [rows, setRows] = useState<ShooterRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  const load = () => {
    setError('');
    void api<ShooterRow[]>(`/api/shooters?search=${encodeURIComponent(search)}`)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load shooters'));
  };

  useEffect(load, [orgId, search]);

  function startCreate() {
    setEditingId(null);
    setDraft(emptyDraft());
    setFormOpen(true);
  }

  function startEdit(s: ShooterRow) {
    setEditingId(s.id);
    setDraft(toDraft(s));
    setFormOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.firstName.trim() || !draft.lastName.trim()) return;
    setBusy(true);
    setError('');
    try {
      if (editingId) {
        await api(`/api/shooters/${editingId}`, { method: 'PATCH', json: payload(draft) });
        setNotice('Shooter updated.');
      } else {
        await api(`/api/shooters`, { method: 'POST', json: payload(draft) });
        setNotice('Shooter added to the club roster.');
      }
      setFormOpen(false);
      setEditingId(null);
      setDraft(emptyDraft());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save shooter');
    } finally {
      setBusy(false);
    }
  }

  if (error && rows === null) return <ErrorBanner message={error} />;
  if (!rows) return <Spinner />;

  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Shooters</h2>
          <p className="mt-0.5 text-sm text-muted">
            One roster shared across all organizations{orgId ? <> · <Link to={`/orgs/${orgId}`} className="font-medium text-brand hover:text-gold">Back to org</Link></> : null}
          </p>
          {canAdd && !canEdit ? <p className="mt-1 flex items-center gap-1.5 text-xs text-muted"><span className="text-pink">•</span> You can add shooters; once added, only platform administrators can edit them.</p> : null}
        </div>
        {canAdd && (
          <Button kind="secondary" onClick={formOpen ? () => { setFormOpen(false); setEditingId(null); } : startCreate}>
            <UserRoundPlus className="h-4 w-4" /> {formOpen ? 'Cancel' : 'Add shooter'}
          </Button>
        )}
      </div>

      {formOpen && (
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">{editingId ? 'Edit shooter' : 'Add shooter'}</h3>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={save}>
            <Field label="First name" required><Input value={draft.firstName} onChange={set('firstName')} required /></Field>
            <Field label="Last name" required><Input value={draft.lastName} onChange={set('lastName')} required /></Field>
            <Field label="Nickname"><Input value={draft.nickname} onChange={set('nickname')} /></Field>
            <Field label="Gender">
              <Select value={draft.gender} onChange={set('gender')}>
                <option value="">—</option>
                {GENDERS.map((g) => <option key={g} value={g}>{g.replace(/_/g, ' ').toLowerCase()}</option>)}
              </Select>
            </Field>
            <Field label="Birth year"><Input type="number" min={1900} max={2100} value={draft.birthYear} onChange={set('birthYear')} /></Field>
            <Field label="Email"><Input type="email" value={draft.email} onChange={set('email')} /></Field>
            <Field label="Phone"><Input value={draft.phone} onChange={set('phone')} /></Field>
            <Field label="Primary gun club"><Input value={draft.homeClub} onChange={set('homeClub')} placeholder="e.g. SJEPSC" /></Field>
            <Field label="PPSA membership"><Input value={draft.ppsaMembershipNumber} onChange={set('ppsaMembershipNumber')} /></Field>
            <Field label="IPSC alias"><Input value={draft.ipscAlias} onChange={set('ipscAlias')} /></Field>
            <div className="flex items-end gap-2">
              <Button type="submit" disabled={busy || !draft.firstName.trim() || !draft.lastName.trim()} kind="gold">{busy ? <Spinner className="h-4 w-4" /> : null} {editingId ? 'Save changes' : 'Add shooter'}</Button>
            </div>
          </form>
          <p className="mt-2 text-xs text-muted">Membership number is assigned automatically.</p>
        </Card>
      )}

      {notice ? <p className="text-sm text-emerald-400">{notice}</p> : null}
      {error && rows ? <ErrorBanner message={error} /> : null}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{rows.length} shooter{rows.length === 1 ? '' : 's'}</p>
        <Input type="search" className="w-64" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, club, membership…" />
      </div>

      {rows.length === 0 ? (
        <Card className="p-4"><Empty>{search ? `No shooters match “${search}”.` : 'No shooters yet. Add one to build your club roster.'}</Empty></Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <thead>
              <tr className="text-left">
                <Th>#</Th>
                <Th>Name</Th>
                <Th>Nickname</Th>
                <Th>Gender</Th>
                <Th>Primary gun club</Th>
                <Th>Membership</Th>
                <Th>Email</Th>
                <Th right />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <Td mono>{s.shooterNumber}</Td>
                  <Td><span className="font-semibold text-ink">{s.lastName}, {s.firstName}</span></Td>
                  <Td><span className="text-muted">{s.nickname ?? '—'}</span></Td>
                  <Td><span className="text-muted">{s.gender ? s.gender.replace(/_/g, ' ').toLowerCase() : '—'}</span></Td>
                  <Td><span className="text-muted">{s.homeClub ?? '—'}</span></Td>
                  <Td><span className="text-muted">{s.ppsaMembershipNumber ?? '—'}</span></Td>
                  <Td><span className="text-muted">{s.email ?? '—'}</span></Td>
                  <Td right>
                    {canEdit ? <Button kind="ghost" className="px-2.5 py-1 text-xs" onClick={() => startEdit(s)}>Edit</Button> : null}
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