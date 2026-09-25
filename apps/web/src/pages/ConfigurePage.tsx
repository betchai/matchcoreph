import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, CheckCircle2, ChevronRight, Circle, Rocket, UserPlus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useOrgPerm } from '../store/auth.js';
import { Badge, Button, Card, ComboBox, Empty, ErrorBanner, Field, Input, Notice, PageHeader, Select, Spinner, Table, Td, Th } from '../components/ui.js';

type MatchView = {
  id: string;
  name: string;
  matchType: string;
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  venue: string | null;
  matchLevel: number | null;
  sanctioningStatus: string | null;
  status: string;
  disciplineCodes: string[];
  divisions: { id: string; code: string; name: string }[];
  categories: { id: string; code: string; name: string }[];
  stageCount: number;
  squadCount: number;
  registrationCount: number;
  ruleset: { id: string; name: string; organizationCode: string; discipline: string; version: string; status: string } | null;
  wizard: Record<string, unknown>;
};

type RulesetRow = { id: string; name: string; organizationCode: string; discipline: string; version: string; status: string };
type Division = { id: string; code: string; name: string; discipline: string; majorAllowed: boolean; maximumCapacity: number | null };
type Category = { id: string; code: string; name: string };
type SquadRow = { id: string; name: string; memberCount: number; stageNumber: number | null };
type StageRow = { id: string; number: number; name: string };
type RegistrationRow = { id: string; shooterId: string; firstName: string; lastName: string; divisionId: string | null; divisionName: string | null; categoryId: string | null; declaredPowerFactor: string; squadId: string | null; squadName: string | null; status: string; hasScorePin?: boolean };
type ShooterRow = { id: string; shooterNumber: string; firstName: string; lastName: string; nickname: string | null; homeClub: string | null };

const DISCIPLINE_LABELS: Record<string, string> = {
  HANDGUN: 'Handgun', PCC: 'PCC', RIFLE: 'Rifle', MINI_RIFLE: 'Mini rifle', SHOTGUN: 'Shotgun', ACTION_AIR: 'Action air',
};
const MATCH_TYPES = ['CLUB_SHOOT', 'CUP', 'TOURNAMENT', 'CHAMPIONSHIP'];
const SANCTIONS = ['CLUB', 'PENDING_SANCTION', 'PPSA_SANCTIONED', 'IPSC_SANCTIONED'];
const COMPETITOR_STATUSES = ['REGISTERED', 'CHECKED_IN', 'ACTIVE', 'COMPLETED', 'DNS', 'DNF', 'DQ', 'WITHDRAWN'];
const MATCH_STATUSES = ['DRAFT', 'CONFIGURED', 'PUBLISHED', 'ONGOING', 'COMPLETED', 'ARCHIVED'];

type StepKey = 'basic' | 'disciplines' | 'ruleset' | 'divisions' | 'squads' | 'registrations' | 'publish';

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'basic', label: '1. Basics' },
  { key: 'disciplines', label: '2. Disciplines' },
  { key: 'ruleset', label: '3. Ruleset' },
  { key: 'divisions', label: '4. Divisions & categories' },
  { key: 'squads', label: '5. Squads' },
  { key: 'registrations', label: '6. Registrations' },
  { key: 'publish', label: '7. Publish' },
];

export default function ConfigurePage() {
  const { orgId = '', matchId = '' } = useParams();
  const [view, setView] = useState<MatchView | null>(null);
  const [step, setStep] = useState<StepKey>('basic');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canEdit = useOrgPerm(orgId, 'match.edit');
  const canRegister = useOrgPerm(orgId, 'registration.manage');

  const reloadView = () => {
    setError('');
    void api<MatchView>(`/api/orgs/${orgId}/matches/${matchId}`)
      .then(setView)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load match'));
  };

  useEffect(() => {
    const first = (next: StepKey) => {
      const m = view?.wizard;
      if (!m) return next;
      const order: [keyof typeof m, StepKey][] = [
        ['stepBasic', 'basic'], ['stepEventType', 'basic'], ['stepDisciplines', 'disciplines'],
        ['stepRuleset', 'ruleset'], ['stepDivisionsCategories', 'divisions'], ['stepStages', 'squads'],
        ['stepSquads', 'squads'], ['stepRegistrations', 'registrations'],
      ] as [keyof typeof m, StepKey][];
      const firstIncomplete = order.find(([k]) => !m[k]);
      return (firstIncomplete ? firstIncomplete[1] : 'publish') as StepKey;
    };
    setStep((cur) => (cur === 'basic' ? first(cur) : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(reloadView, [orgId, matchId]);

  const wizard = view?.wizard ?? {};
  const completedCount = useMemo(
    () => ['stepBasic', 'stepEventType', 'stepDisciplines', 'stepRuleset', 'stepDivisionsCategories', 'stepStages', 'stepSquads', 'stepRegistrations']
      .filter((k) => wizard[k]).length,
    [wizard],
  );

  if (error && !view) return <ErrorBanner message={error} />;
  if (!view) return <Spinner />;

  const wizChecklist = [
    ['stepBasic', 'Name & date entered'],
    ['stepEventType', 'Match type set'],
    ['stepDisciplines', 'Discipline(s) chosen'],
    ['stepRuleset', 'Ruleset selected'],
    ['stepDivisionsCategories', 'Divisions & categories'],
    ['stepStages', 'Stages configured'],
    ['stepSquads', 'Squads (or tournament)'],
    ['stepRegistrations', 'Competitors registered'],
  ] as [string, string][];

  return (
    <div>
      <PageHeader
        title={view.name}
        subtitle={`Setup progress: ${completedCount}/8 · ${view.status}`}
        actions={
          ['PUBLISHED', 'CONFIGURED'].includes(view.status) ? (
            <Button kind="ghost" disabled>Read only until published</Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <Card className="p-3">
          <nav className="flex flex-col gap-1">
            {STEPS.map(({ key, label }) => {
              const active = step === key;
              return (
                <button
                  key={key}
                  onClick={() => setStep(key)}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                    active ? 'bg-[#e5b842]/15 font-bold text-[#f4cf6f]' : 'text-muted hover:bg-app hover:text-ink'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {wizard[keyToWizardKey(key)] ? (
                      <CheckCircle2 className="h-4 w-4 text-green" />
                    ) : (
                      <Circle className={`h-4 w-4 ${active ? 'text-[#f4cf6f]' : 'text-[#5a5e63]'}`} />
                    )}
                    {label}
                  </span>
                  {active ? <ChevronRight className="h-4 w-4" /> : null}
                </button>
              );
            })}
            <div className="mt-3 border-t border-line pt-3 text-xs leading-5 text-muted">
              <p className="mb-1 font-semibold text-muted">
                Next: {wizard.nextStep ? String(wizard.nextStep).replace('step', '') : '—'}
              </p>
              {wizChecklist.map(([k, label]) => (
                <p key={k} className="flex items-center gap-1.5">
                  {wizard[k] ? <Check className="h-3 w-3 text-green" /> : <Circle className="h-3 w-3 text-[#5a5e63]" />}
                  {label}
                </p>
              ))}
            </div>
          </nav>
        </Card>

        <div className="space-y-4">
          {step === 'basic' && <BasicForm view={view} orgId={orgId} matchId={matchId} canEdit={canEdit} onSaved={reloadView} setError={setError} setNotice={setNotice} />}
          {step === 'disciplines' && <DisciplinesForm view={view} orgId={orgId} matchId={matchId} canEdit={canEdit} onSaved={reloadView} setError={setError} setNotice={setNotice} />}
          {step === 'ruleset' && <RulesetForm view={view} orgId={orgId} matchId={matchId} canEdit={canEdit} onSaved={reloadView} setError={setError} setNotice={setNotice} />}
          {step === 'divisions' && <DivisionsForm view={view} orgId={orgId} matchId={matchId} canEdit={canEdit} onSaved={reloadView} setError={setError} setNotice={setNotice} />}
          {step === 'squads' && <SquadsForm orgId={orgId} matchId={matchId} canEdit={canEdit} onSaved={reloadView} setError={setError} setNotice={setNotice} />}
          {step === 'registrations' && <RegistrationsForm orgId={orgId} matchId={matchId} divisions={view.divisions} categories={view.categories} canRegister={canRegister} onSaved={reloadView} setError={setError} setNotice={setNotice} />}
          {step === 'publish' && <PublishForm view={view} orgId={orgId} matchId={matchId} wizard={wizard} completedCount={completedCount} canEdit={canEdit} onSaved={reloadView} setError={setError} setNotice={setNotice} />}
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {error ? <ErrorBanner message={error} /> : null}
        {notice ? <Notice>{notice}</Notice> : null}
      </div>
    </div>
  );

  function keyToWizardKey(key: StepKey): string {
    switch (key) {
      case 'basic': return 'stepBasic';
      case 'disciplines': return 'stepDisciplines';
      case 'ruleset': return 'stepRuleset';
      case 'divisions': return 'stepDivisionsCategories';
      case 'squads': return 'stepSquads';
      case 'registrations': return 'stepRegistrations';
      case 'publish': return 'stepPublish';
    }
  }
}

function FieldBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-bold text-ink">{title}</h3>
      {children}
    </Card>
  );
}

function BasicForm({ view, orgId, matchId, canEdit, onSaved, setError, setNotice }: {
  view: MatchView;
  orgId: string;
  matchId: string;
  canEdit: boolean;
  onSaved: () => void;
  setError: (s: string) => void;
  setNotice: (s: string) => void;
}) {
  const [name, setName] = useState(view.name);
  const [matchType, setMatchType] = useState(view.matchType || 'CLUB_SHOOT');
  const [startDate, setStartDate] = useState(view.startDate?.slice(0, 10) ?? '');
  const [startTime, setStartTime] = useState(view.startTime ?? '');
  const [venue, setVenue] = useState(view.venue ?? '');
  const [matchLevel, setMatchLevel] = useState(String(view.matchLevel ?? 1));
  const [sanctioningStatus, setSanctioningStatus] = useState(view.sanctioningStatus ?? 'CLUB');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}`, {
        method: 'PATCH',
        json: {
          name: name.trim() || undefined,
          matchType,
          startDate: startDate || undefined,
          startTime: startTime || null,
          venue: venue || null,
          matchLevel: Number(matchLevel),
          sanctioningStatus,
        },
      });
      setNotice('Basics saved.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save basics');
    } finally {
      setSaving(false);
    }
  }

  return (
    <FieldBlock title="Basics">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Match name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} required />
        </Field>
        <Field label="Match type" required>
          <Select value={matchType} onChange={(e) => setMatchType(e.target.value)} disabled={!canEdit}>
            {MATCH_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
          </Select>
        </Field>
        <Field label="Start date" required>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={!canEdit} required />
        </Field>
        <Field label="Start time">
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Venue">
          <Input value={venue} onChange={(e) => setVenue(e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Level" required>
          <Select value={matchLevel} onChange={(e) => setMatchLevel(e.target.value)} disabled={!canEdit}>
            {[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>Level {l}</option>)}
          </Select>
        </Field>
        <Field label="Sanctioning">
          <Select value={sanctioningStatus} onChange={(e) => setSanctioningStatus(e.target.value)} disabled={!canEdit}>
            {SANCTIONS.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
          </Select>
        </Field>
      </div>
      <div className="mt-4">
        <Button kind="primary" onClick={() => void save()} disabled={!canEdit || saving}>
          {saving ? <Spinner className="h-4 w-4" /> : null} Save basics
        </Button>
      </div>
    </FieldBlock>
  );
}

function DisciplinesForm({ view, orgId, matchId, canEdit, onSaved, setError, setNotice }: {
  view: MatchView;
  orgId: string;
  matchId: string;
  canEdit: boolean;
  onSaved: () => void;
  setError: (s: string) => void;
  setNotice: (s: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>(view.disciplineCodes);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/disciplines`, { method: 'POST', json: { disciplines: selected } });
      setNotice('Disciplines saved.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save disciplines');
    } finally {
      setSaving(false);
    }
  }

  return (
    <FieldBlock title="Disciplines">
      <p className="mb-3 text-xs text-muted">Disciplines determine which rulesets and divisions are eligible for this match.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {Object.entries(DISCIPLINE_LABELS).map(([code, label]) => {
          const active = selected.includes(code);
          return (
            <label
              key={code}
              className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition ${
                active ? 'border-brand/40 bg-[#e5b842]/10 text-[#f4cf6f]' : 'border-line bg-panel text-muted hover:border-brand/50'
              }`}
            >
              <span className="flex items-center gap-2">
                {active ? <CheckCircle2 className="h-4 w-4 text-brand" /> : <Circle className="h-4 w-4 text-[#5a5e63]" />}
                {label}
              </span>
              <input
                type="checkbox"
                checked={active}
                onChange={() => setSelected(active ? selected.filter((c) => c !== code) : [...selected, code])}
                className="sr-only"
              />
            </label>
          );
        })}
      </div>
      <div className="mt-4">
        <Button kind="primary" onClick={() => void save()} disabled={!canEdit || selected.length === 0 || saving}>
          {saving ? <Spinner className="h-4 w-4" /> : null} Save disciplines
        </Button>
      </div>
    </FieldBlock>
  );
}

function RulesetForm({ view, orgId, matchId, canEdit, onSaved, setError, setNotice }: {
  view: MatchView;
  orgId: string;
  matchId: string;
  canEdit: boolean;
  onSaved: () => void;
  setError: (s: string) => void;
  setNotice: (s: string) => void;
}) {
  const [rulesets, setRulesets] = useState<RulesetRow[] | null>(null);
  const [rulesetId, setRulesetId] = useState(view.ruleset?.id ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api<RulesetRow[]>('/api/rulesets')
      .then(setRulesets)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load rulesets'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const eligible = useMemo(
    () => (rulesets ?? []).filter((r) => view.disciplineCodes.length === 0 || view.disciplineCodes.includes(r.discipline)),
    [rulesets, view.disciplineCodes],
  );

  async function save() {
    if (!rulesetId) return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/ruleset`, { method: 'POST', json: { rulesetId } });
      setNotice('Ruleset selected.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set ruleset');
    } finally {
      setSaving(false);
    }
  }

  const current = view.ruleset;
  return (
    <FieldBlock title="Ruleset">
      {current ? (
        <div className="mb-4 rounded-lg border border-green/25 bg-[#1f4a35] px-3 py-2.5 text-sm text-green">
          Current: {current.organizationCode} {current.discipline} v{current.version} · {current.name}
        </div>
      ) : (
        <div className="mb-4 rounded-lg border border-amber/30 bg-amber-50 px-3 py-2.5 text-sm text-amber">
          No ruleset selected yet — this is required before scoring.
        </div>
      )}
      {rulesets === null ? (
        <Spinner />
      ) : eligible.length === 0 ? (
        <Empty>No rulesets available for the selected discipline(s). An administrator must create one first.</Empty>
      ) : (
        <>
          <Select value={rulesetId} onChange={(e) => setRulesetId(e.target.value)} className="w-full">
            <option value="">Select a ruleset…</option>
            {eligible.map((r) => (
              <option key={r.id} value={r.id} disabled={r.status !== 'ACTIVE'}>
                {r.organizationCode} · {r.discipline} · v{r.version} ({r.status}) {r.name}
              </option>
            ))}
          </Select>
          <p className="mt-2 text-xs text-muted">Only active rulesets are linked. The ruleset pins scoring rules for this match history.</p>
          <div className="mt-4">
            <Button kind="primary" onClick={() => void save()} disabled={!canEdit || !rulesetId || saving}>
              {saving ? <Spinner className="h-4 w-4" /> : null} Use this ruleset
            </Button>
          </div>
        </>
      )}
    </FieldBlock>
  );
}

function DivisionsForm({ view, orgId, matchId, canEdit, onSaved, setError, setNotice }: {
  view: MatchView;
  orgId: string;
  matchId: string;
  canEdit: boolean;
  onSaved: () => void;
  setError: (s: string) => void;
  setNotice: (s: string) => void;
}) {
  const rulesetId = view.ruleset?.id;
  const [divisions, setDivisions] = useState<Division[] | null>(null);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [selDivs, setSelDivs] = useState<string[]>(view.divisions.map((d) => d.id));
  const [selCats, setSelCats] = useState<string[]>(view.categories.map((c) => c.id));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!rulesetId) return;
    setError('');
    Promise.all([
      api<Division[]>(`/api/rulesets/${rulesetId}/divisions`),
      api<Category[]>(`/api/rulesets/${rulesetId}/categories`),
    ])
      .then(([d, c]) => {
        setDivisions(d);
        setCategories(c);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load divisions'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesetId]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/divisions-categories`, {
        method: 'POST',
        json: { divisionIds: selDivs, categoryIds: selCats },
      });
      setNotice('Divisions & categories saved.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save divisions');
    } finally {
      setSaving(false);
    }
  }

  if (!rulesetId) {
    return <FieldBlock title="Divisions & categories"><Empty>Select a ruleset first.</Empty></FieldBlock>;
  }
  if (divisions === null || categories === null) return <Spinner />;

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <FieldBlock title="Divisions & categories">
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Divisions <span className="ml-1 text-pink" title="Required">*</span></h4>
      <div className="mb-5 grid gap-2 sm:grid-cols-2">
        {divisions.map((d) => {
          const active = selDivs.includes(d.id);
          return (
            <label
              key={d.id}
              className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition ${
                active ? 'border-brand/40 bg-[#e5b842]/10 text-[#f4cf6f]' : 'border-line bg-panel text-muted hover:border-brand/50'
              }`}
            >
              <span className="flex items-center gap-2">
                {active ? <CheckCircle2 className="h-4 w-4 text-brand" /> : <Circle className="h-4 w-4 text-[#5a5e63]" />}
                <span>
                  {d.name}
                  <span className="ml-2 text-[10px] uppercase text-muted">
                    {d.code}{d.majorAllowed ? ' · Major allowed' : ''}{d.maximumCapacity ? ` · cap ${d.maximumCapacity}` : ''}
                  </span>
                </span>
              </span>
              <input type="checkbox" checked={active} onChange={() => toggle(selDivs, setSelDivs, d.id)} className="sr-only" />
            </label>
          );
        })}
      </div>
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Categories</h4>
      <div className="grid gap-2 sm:grid-cols-2">
        {categories.map((c) => {
          const active = selCats.includes(c.id);
          return (
            <label
              key={c.id}
              className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
                active ? 'border-green/40 bg-[#1f4a35] text-green' : 'border-line bg-panel text-muted hover:border-brand/50'
              }`}
            >
              <span className="flex items-center gap-2">
                {active ? <CheckCircle2 className="h-4 w-4 text-green" /> : <Circle className="h-4 w-4 text-[#5a5e63]" />}
                {c.name}
              </span>
              <input type="checkbox" checked={active} onChange={() => toggle(selCats, setSelCats, c.id)} className="sr-only" />
            </label>
          );
        })}
      </div>
      <div className="mt-4">
        <Button kind="primary" onClick={() => void save()} disabled={!canEdit || selDivs.length === 0 || saving}>
          {saving ? <Spinner className="h-4 w-4" /> : null} Save choices
        </Button>
      </div>
    </FieldBlock>
  );
}

function SquadsForm({ orgId, matchId, canEdit, onSaved, setError, setNotice }: {
  orgId: string;
  matchId: string;
  canEdit: boolean;
  onSaved: () => void;
  setError: (s: string) => void;
  setNotice: (s: string) => void;
}) {
  const [squads, setSquads] = useState<SquadRow[] | null>(null);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [name, setName] = useState('');
  const [stageNumber, setStageNumber] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError('');
    void api<SquadRow[]>(`/api/orgs/${orgId}/matches/${matchId}/squads/overview`)
      .then(setSquads)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load squads'));
  };

  useEffect(() => {
    void api<StageRow[]>(`/api/orgs/${orgId}/matches/${matchId}/stages`)
      .then(setStages)
      .catch(() => setStages([]));
  }, [orgId, matchId]);

  useEffect(load, [orgId, matchId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/squads`, { method: 'POST', json: { name: name.trim(), stageNumber: stageNumber ? Number(stageNumber) : null } });
      setName('');
      setStageNumber('');
      load();
      onSaved();
      setNotice('Squad added.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add squad');
    } finally {
      setBusy(false);
    }
  }

  async function setStage(q: SquadRow, stageNumber: string) {
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/squads/${q.id}`, { method: 'PATCH', json: { stageNumber: stageNumber ? Number(stageNumber) : null } });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update squad');
    }
  }

  async function remove(id: string) {
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/squads/${id}`, { method: 'DELETE' });
      load();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete squad');
    }
  }

  function stageName(n: number | null): string {
    if (n === null) return 'No stage';
    return stages.find((s) => s.number === n)?.name ?? `Stage ${n}`;
  }

  if (squads === null) return <Spinner />;
  return (
    <FieldBlock title="Squads">
      <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={create}>
        <div className="space-y-1.5">
          <span className="block text-xs font-bold text-muted">Squad name <span className="ml-1 text-pink" title="Required">*</span></span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Squad 1" disabled={!canEdit} required className="w-48" />
        </div>
        <div className="space-y-1.5">
          <span className="block text-xs font-bold text-muted">Starting stage</span>
          <Select value={stageNumber} onChange={(e) => setStageNumber(e.target.value)} disabled={!canEdit} className="w-40">
            <option value="">None</option>
            {stages.map((s) => <option key={s.id} value={s.number}>{s.name || `Stage ${s.number}`}</option>)}
          </Select>
        </div>
        <Button type="submit" kind="gold" disabled={!canEdit || busy || !name.trim()}>{busy ? <Spinner className="h-4 w-4" /> : null} Add squad</Button>
        {stages.length === 0 ? <span className="text-xs text-muted">Tip: add stages first to pick a starting rotation for each squad.</span> : null}
      </form>
      {squads.length === 0 ? (
        <Empty>No squads yet. Squads are required (or use a tournament match).</Empty>
      ) : (
        <ul className="grid gap-2">
          {squads.map((q) => (
            <li key={q.id}>
              <Card className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-sm font-medium text-ink">{q.name}</span>
                <span className="flex items-center gap-3 text-sm">
                  <span className="text-xs text-muted">{q.memberCount} member{q.memberCount === 1 ? '' : 's'}</span>
                  {canEdit ? (
                    <Select
                      className="w-40 px-2 py-1 text-xs"
                      value={q.stageNumber === null ? '' : String(q.stageNumber)}
                      onChange={(e) => void setStage(q, e.target.value)}
                      title="Starting stage"
                    >
                      <option value="">No stage</option>
                      {stages.map((s) => <option key={s.id} value={s.number}>{s.name || `Stage ${s.number}`}</option>)}
                    </Select>
                  ) : (
                    <span className="text-xs text-muted">{stageName(q.stageNumber)}</span>
                  )}
                  {canEdit && (
                    <button onClick={() => void remove(q.id)} className="text-xs font-semibold text-red transition hover:text-[#ff9b9b]">Delete</button>
                  )}
                </span>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </FieldBlock>
  );
}

function RegistrationsForm({ orgId, matchId, divisions, categories, canRegister, onSaved, setError, setNotice }: {
  orgId: string;
  matchId: string;
  divisions: { id: string; code: string; name: string }[];
  categories: { id: string; code: string; name: string }[];
  canRegister: boolean;
  onSaved: () => void;
  setError: (s: string) => void;
  setNotice: (s: string) => void;
}) {
  const [rows, setRows] = useState<RegistrationRow[] | null>(null);
  const [squads, setSquads] = useState<SquadRow[]>([]);
  const [shooters, setShooters] = useState<ShooterRow[] | null>(null);
  const [search, setSearch] = useState('');
  const [shooterId, setShooterId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [squadId, setSquadId] = useState('');
  const [pf, setPf] = useState('MINOR');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const load = () => {
    setError('');
    void Promise.all([
      api<RegistrationRow[]>(`/api/orgs/${orgId}/matches/${matchId}/registrations`),
      api<SquadRow[]>(`/api/orgs/${orgId}/matches/${matchId}/squads/overview`),
    ])
      .then(([regs, sqs]) => { setRows(regs); setSquads(sqs); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  };

  useEffect(load, [orgId, matchId]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void api<ShooterRow[]>(`/api/shooters?search=${encodeURIComponent(search)}`).then(setShooters).catch(() => setShooters([]));
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const addShooterVisible = search.trim().length >= 1 && (shooters?.length ?? 0) === 0;

  async function register(e: React.FormEvent) {
    e.preventDefault();
    if (!shooterId) return;
    if (pin.length !== 4) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/registrations`, {
        method: 'POST',
        json: { shooterId, divisionId: divisionId || null, categoryId: categoryId || null, declaredPowerFactor: pf, squadId: squadId || null, scorePin: pin },
      });
      setShooterId('');
      setSearch('');
      setDivisionId('');
      setCategoryId('');
      setSquadId('');
      setPin('');
      setFormOpen(false);
      load();
      onSaved();
      setNotice('Competitor registered.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register competitor');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(reg: RegistrationRow, status: string) {
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/registrations/${reg.id}/status`, { method: 'PATCH', json: { status, reason: status === 'DQ' ? 'DQ (see audit trail)' : undefined } });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status');
    }
  }

  if (rows === null) return <Spinner />;
  return (
    <FieldBlock title={`Competitors (${rows.length})`}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-muted">Register shooters from your club roster, then check them in on match day.</p>
        {canRegister && (
          <Button kind="gold" onClick={() => setFormOpen(!formOpen)}>
            <UserPlus className="h-4 w-4" /> Register
          </Button>
        )}
      </div>

      {formOpen && (
        <form onSubmit={register} className="mb-4 rounded-lg border border-line bg-app p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Shooter" required>
              <ComboBox
                value={shooterId}
                onChange={(id) => setShooterId(id)}
                onSearch={(t) => setSearch(t)}
                options={(shooters ?? []).map((s) => ({
                  id: s.id,
                  label: `${s.lastName}, ${s.firstName} · ${s.shooterNumber}`,
                }))}
                placeholder="Type a name or membership number…"
              />
            </Field>
            <Field label="Division">
              <Select value={divisionId} onChange={(e) => setDivisionId(e.target.value)}>
                <option value="">—</option>
                {divisions.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
              </Select>
            </Field>
            <Field label="Category">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">—</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Power factor">
              <Select value={pf} onChange={(e) => setPf(e.target.value)}>
                <option value="MINOR">Minor</option>
                <option value="MAJOR">Major</option>
                <option value="NOT_APPLICABLE">Not applicable</option>
              </Select>
            </Field>
            <Field label="Squad">
              <Select value={squadId} onChange={(e) => setSquadId(e.target.value)}>
                <option value="">—</option>
                {squads.map((q) => <option key={q.id} value={q.id}>{q.name}{q.stageNumber ? ` · starts stage ${q.stageNumber}` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Verify PIN (4 digits)" required>
              <Input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                placeholder="e.g. 2468"
                maxLength={4}
              />
              <p className="mt-1 text-xs text-muted">The shooter enters this PIN to confirm each score on match day.</p>
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="submit" kind="gold" disabled={busy || !shooterId || pin.length !== 4}>{busy ? <Spinner className="h-4 w-4" /> : null} Register</Button>
            {addShooterVisible && (
              <span className="self-center text-xs text-muted">
                No shooter found? <Link to={`/orgs/${orgId}/shooters`} className="font-medium text-brand hover:underline">Add them in the club roster</Link> first.
              </span>
            )}
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <Empty>No competitors yet.</Empty>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <Table>
            <thead className="sticky top-0">
              <tr>
                <Th>Competitor</Th>
                <Th>Division</Th>
                <Th>Category</Th>
                <Th>PF</Th>
                <Th>Squad</Th>
                <Th>Status</Th>
                <Th>Order</Th>
                <Th>Verify</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td><span className="font-medium">{r.lastName}, {r.firstName}</span></Td>
                  <Td><span className="text-muted">{r.divisionName ?? '—'}</span></Td>
                  <Td>
                    {canRegister && r.status === 'REGISTERED' ? (
                      <Select
                        className="w-32 px-2 py-1 text-xs"
                        value={r.categoryId ?? ''}
                        onChange={(e) => {
                          void api(`/api/orgs/${orgId}/matches/${matchId}/registrations/${r.id}`, { method: 'PATCH', json: { categoryId: e.target.value || null } })
                            .then(load)
                            .catch((err) => setError(err instanceof Error ? err.message : 'Could not update category'));
                        }}
                      >
                        <option value="">—</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </Select>
                    ) : (
                      <span className="text-muted">{categories.find((c) => c.id === r.categoryId)?.name ?? '—'}</span>
                    )}
                  </Td>
                  <Td><span className="text-muted">{r.declaredPowerFactor}</span></Td>
                  <Td>
                    {canRegister && r.status === 'REGISTERED' ? (
                      <Select
                        className="w-32 px-2 py-1 text-xs"
                        value={r.squadId ?? ''}
                        onChange={(e) => {
                          void api(`/api/orgs/${orgId}/matches/${matchId}/registrations/${r.id}`, { method: 'PATCH', json: { squadId: e.target.value || null } })
                            .then(load)
                            .catch((err) => setError(err instanceof Error ? err.message : 'Could not update squad'));
                        }}
                      >
                        <option value="">—</option>
                        {squads.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                      </Select>
                    ) : (
                      <span className="text-muted">{r.squadName ?? '—'}</span>
                    )}
                  </Td>
                  <Td>
                    {canRegister && r.status === 'REGISTERED' ? (
                      <Select
                        className="w-36 px-2 py-1 text-xs"
                        value={r.status}
                        onChange={(e) => {
                          if (e.target.value === 'CHECKED_IN') {
                            void api(`/api/orgs/${orgId}/matches/${matchId}/checkin`, { method: 'POST', json: { registrationId: r.id } }).then(load).catch((err) => setError(err instanceof Error ? err.message : 'Check-in failed'));
                          } else {
                            void setStatus(r, e.target.value);
                          }
                        }}
                      >
                        {COMPETITOR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </Select>
                    ) : (
                      <Badge tone={r.status === 'DQ' ? 'rose' : r.status === 'CHECKED_IN' ? 'emerald' : 'slate'}>{r.status}</Badge>
                    )}
                  </Td>
                  <Td><span className="text-muted">{r.squadName ?? '—'}</span></Td>
                  <Td>
                    {r.hasScorePin ? (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600"><Check className="h-3 w-3" /> PIN set</span>
                    ) : (
                      <span className="text-[10px] text-muted">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </FieldBlock>
  );
}

function PublishForm({ view, wizard, completedCount, orgId, matchId, canEdit, onSaved, setError, setNotice }: {
  view: MatchView;
  wizard: Record<string, unknown>;
  completedCount: number;
  orgId: string;
  matchId: string;
  canEdit: boolean;
  onSaved: () => void;
  setError: (s: string) => void;
  setNotice: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const ready = completedCount === 8;

  async function publish() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/publish`, { method: 'POST' });
      setNotice('Match published.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish match');
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/status`, { method: 'POST', json: { status } });
      setNotice(`Status set to ${status}.`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FieldBlock title="Publish">
      <div className="mb-4 rounded-lg border border-line bg-app p-4 text-sm text-ink">
        <p className="mb-2 flex items-center gap-2 font-medium">
          {ready ? <CheckCircle2 className="h-5 w-5 text-green" /> : <Circle className="h-5 w-5 text-amber" />}
          {ready ? 'All setup steps are complete.' : `Setup incomplete (${completedCount}/8).`}
        </p>
        <p className="text-xs text-muted">
          Publishing moves the match to {view.status === 'PUBLISHED' ? 'PUBLISHED' : 'PUBLISHED'} (visible internally) and locks the ruleset for scoring.
        </p>
        {!ready && (
          <p className="mt-2 text-xs text-amber">
            Still needed: {(() => {
              const missing = wizard.nextStep ? String(wizard.nextStep).replace('step', '') : '—';
              return missing === 'publish' ? 'all steps complete but not yet published' : `"${missing}"`;
            })()}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {view.status !== 'PUBLISHED' && (
          <Button kind="gold" onClick={() => void publish()} disabled={!ready || !canEdit || busy}>
            {busy ? <Spinner className="h-4 w-4" /> : null} <Rocket className="h-4 w-4" /> Publish match
          </Button>
        )}
        <label className="flex items-center gap-2 text-xs text-muted">
          Match status
          <Select
            className="w-44 px-2 py-1 text-xs"
            value={view.status}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value !== view.status) void changeStatus(e.target.value);
            }}
          >
            {MATCH_STATUSES.map((s) => (
              <option key={s} value={s} disabled={s === 'CANCELLED'}>{s}</option>
            ))}
          </Select>
        </label>
      </div>
    </FieldBlock>
  );
}