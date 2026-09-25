import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Badge, Button, Card, Empty, ErrorBanner, Field, Input, Select, Spinner, Td, Th } from '../components/ui.js';

const COURSE_TYPES = ['SHORT', 'MEDIUM', 'LONG', 'CLASSIFIER'] as const;
const SCORING_METHODS = ['COMSTOCK', 'VIRGINIA_COUNT', 'FIXED_TIME', 'PSMOC_POINTS_FACTOR', 'PSMOC_TIME'] as const;
const LOAD_TYPES = ['FULL_LOAD', 'MINIMUM_LOAD'] as const;
const TARGET_TYPES = ['PAPER', 'PAPER_NO_SHOOT', 'STEEL', 'POPPER', 'PLATE', 'CUSTOM'] as const;

/** Load-type selection applies to PSMOC paper point tables; empty for IPSC/PPSA. */
const isPsmocMethod = (m: string): boolean => m === 'PSMOC_POINTS_FACTOR' || m === 'PSMOC_TIME';

/** Targets that are scored by zone hits (paper-like) vs hit-or-miss (steel-like). */
const isPaperLike = (type: string): boolean => type === 'PAPER' || type === 'CUSTOM';

/** Auto-name prefix per target type (T1…Tn paper, P1…Pn plates, PP1… poppers, etc.). */
const TARGET_NAME_PREFIX: Record<string, string> = {
  PAPER: 'T',
  PLATE: 'P',
  POPPER: 'PP',
  STEEL: 'S',
  PAPER_NO_SHOOT: 'NS',
  CUSTOM: 'X',
};

const defaultTargetName = (type: string, sequence: number): string =>
  `${TARGET_NAME_PREFIX[type] ?? 'TG'}${sequence}`;

interface StageRow {
  id: string;
  number: number;
  name: string;
  courseType: string;
  scoringMethod: string;
  loadType: string | null;
  minimumRounds: number | null;
  maximumRounds: number | null;
  requiredHits: number | null;
  maximumStagePoints: number;
  fixedTimeSeconds: number | null;
  classifierDesignation: string | null;
  active: boolean;
}

interface TargetRow {
  number: number;
  name: string | null;
  targetType: string;
  requiredHits: number | null;
  scoringZones: string[] | null;
  maxPoints: number | null;
}

interface DraftStage {
  number: string;
  name: string;
  courseType: string;
  scoringMethod: string;
  loadType: string;
  maximumStagePoints: string;
  minimumRounds: string;
  maximumRounds: string;
  requiredHits: string;
  fixedTimeSeconds: string;
}

const emptyDraft = (): DraftStage => ({
  number: '1',
  name: '',
  courseType: 'SHORT',
  scoringMethod: 'COMSTOCK',
  loadType: '',
  maximumStagePoints: '100',
  minimumRounds: '',
  maximumRounds: '',
  requiredHits: '',
  fixedTimeSeconds: '',
});

const numOrNull = (v: string): number | null => {
  const n = Number(v);
  return v === '' || Number.isNaN(n) ? null : n;
};

/** Serializes the load-type select: '' → null so IPSC/PPSA stages stay power-factor driven. */
const loadTypeOrNull = (v: string): 'FULL_LOAD' | 'MINIMUM_LOAD' | null =>
  v === '' ? null : (v as 'FULL_LOAD' | 'MINIMUM_LOAD');

function stageToDraft(s: StageRow): DraftStage {
  return {
    number: String(s.number),
    name: s.name,
    courseType: s.courseType,
    scoringMethod: s.scoringMethod,
    loadType: s.loadType ?? '',
    maximumStagePoints: String(s.maximumStagePoints),
    minimumRounds: s.minimumRounds === null ? '' : String(s.minimumRounds),
    maximumRounds: s.maximumRounds === null ? '' : String(s.maximumRounds),
    requiredHits: s.requiredHits === null ? '' : String(s.requiredHits),
    fixedTimeSeconds: s.fixedTimeSeconds === null ? '' : String(s.fixedTimeSeconds),
  };
}

export default function StagesPage() {
  const { orgId = '', matchId = '' } = useParams();
  const [stages, setStages] = useState<StageRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [createDraft, setCreateDraft] = useState<DraftStage>(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftStage | null>(null);
  const [targetsFor, setTargetsFor] = useState<string | null>(null);
  const [targets, setTargets] = useState<TargetRow[] | null>(null);

  const load = () => {
    setError('');
    void api<StageRow[]>(`/api/orgs/${orgId}/matches/${matchId}/stages`)
      .then(setStages)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load stages'));
  };

  useEffect(load, [orgId, matchId]);

  async function createStage(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/stages`, {
        method: 'POST',
        json: {
          number: Number(createDraft.number) || 1,
          name: createDraft.name.trim(),
          courseType: createDraft.courseType,
          scoringMethod: createDraft.scoringMethod,
          loadType: loadTypeOrNull(createDraft.loadType),
          maximumStagePoints: numOrNull(createDraft.maximumStagePoints) ?? 1,
          minimumRounds: numOrNull(createDraft.minimumRounds),
          maximumRounds: numOrNull(createDraft.maximumRounds),
          requiredHits: numOrNull(createDraft.requiredHits),
          fixedTimeSeconds: numOrNull(createDraft.fixedTimeSeconds),
        },
      });
      setCreateDraft(emptyDraft());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create stage');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(stage: StageRow) {
    setEditingId(stage.id);
    setEditDraft(stageToDraft(stage));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId || !editDraft) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/stages/${editingId}`, {
        method: 'PATCH',
        json: {
          number: Number(editDraft.number) || 1,
          name: editDraft.name.trim(),
          courseType: editDraft.courseType,
          scoringMethod: editDraft.scoringMethod,
          loadType: loadTypeOrNull(editDraft.loadType),
          maximumStagePoints: Number(editDraft.maximumStagePoints) || 0,
          minimumRounds: numOrNull(editDraft.minimumRounds),
          maximumRounds: numOrNull(editDraft.maximumRounds),
          requiredHits: numOrNull(editDraft.requiredHits),
          fixedTimeSeconds: numOrNull(editDraft.fixedTimeSeconds),
        },
      });
      cancelEdit();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update stage');
    } finally {
      setBusy(false);
    }
  }

  async function removeStage(stage: StageRow) {
    if (!window.confirm(`Delete stage ${stage.number} — ${stage.name}?`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/stages/${stage.id}`, { method: 'DELETE' });
      setTargetsFor(null);
      setTargets(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete stage');
    } finally {
      setBusy(false);
    }
  }

  async function toggleTargets(stage: StageRow) {
    if (targetsFor === stage.id) {
      setTargetsFor(null);
      setTargets(null);
      return;
    }
    setError('');
    try {
      const rows = await api<TargetRow[]>(`/api/orgs/${orgId}/matches/${matchId}/stages/${stage.id}/targets`);
      setTargets(rows.map((t) => ({ ...t, scoringZones: t.scoringZones ?? [] })));
      setTargetsFor(stage.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load targets');
    }
  }

  function addTarget() {
    setTargets((prev) => {
      const base = prev ?? [];
      const papers = base.filter((t) => t.targetType === 'PAPER').length;
      return [
        ...base,
        { number: base.length + 1, name: defaultTargetName('PAPER', papers + 1), targetType: 'PAPER', requiredHits: null, scoringZones: [], maxPoints: null },
      ];
    });
  }

  /** Bulk-adds identical targets (paper scored by zones, plates hit/miss), auto-named by type. */
  function addManyTargets(type: 'PAPER' | 'PLATE', count: number) {
    setTargets((prev) => {
      const base = prev ?? [];
      const nextNumber = base.reduce((m, t) => Math.max(m, t.number || 0), 0) + 1;
      const existingOfType = base.filter((t) => t.targetType === type).length;
      const additions: TargetRow[] = Array.from({ length: count }, (_, i) => ({
        number: nextNumber + i,
        name: defaultTargetName(type, existingOfType + i + 1),
        targetType: type,
        requiredHits: type === 'PAPER' ? 2 : 1,
        scoringZones: type === 'PAPER' ? ['A', 'C', 'D'] : null,
        maxPoints: null,
      }));
      return [...base, ...additions];
    });
  }

  function updateTarget(index: number, patch: Partial<TargetRow>) {
    setTargets((prev) => (prev ?? []).map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function removeTarget(index: number) {
    setTargets((prev) => (prev ?? []).filter((_, i) => i !== index));
  }

  async function saveTargets(e: React.FormEvent) {
    e.preventDefault();
    if (!targetsFor || !targets) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/stages/${targetsFor}/targets`, {
        method: 'PUT',
        json: {
          targets: targets.map((t, i) => ({
            number: t.number || i + 1,
            name: t.name ? t.name.trim() : null,
            targetType: t.targetType,
            requiredHits: t.requiredHits,
            scoringZones: t.scoringZones ?? undefined,
            maxPoints: t.maxPoints,
          })),
        },
      });
      setTargets(null);
      setTargetsFor(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save targets');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBanner message={error} />;
  if (!stages) return <Spinner />;

  const draftInput = (key: keyof DraftStage) => ({
    value: (createDraft as unknown as Record<string, string>)[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setCreateDraft((d) => ({ ...d, [key]: e.target.value })),
  });

  const isEditing = (id: string) => editingId === id;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Stages</h2>
          <p className="mt-0.5 text-sm text-muted">
            <Link to={`/orgs/${orgId}/matches/${matchId}`} className="font-medium text-brand hover:text-gold">Back to match</Link>
          </p>
        </div>
      </div>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">Add stage</h3>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={createStage}>
          <Field label="Number" required>
            <Input type="number" min={1} {...draftInput('number')} required />
          </Field>
          <Field label="Name" required>
            <Input {...draftInput('name')} placeholder="e.g. Stage 1 — Long Field Course" required />
          </Field>
          <Field label="Course type" required>
            <Select {...draftInput('courseType')} required>
              {COURSE_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Scoring method" required>
            <Select {...draftInput('scoringMethod')} required>
              {SCORING_METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </Select>
          </Field>
          <Field label="Load type" hint={isPsmocMethod(createDraft.scoringMethod) ? 'PSMOC paper point table' : 'PPSA/IPSC: leave unset (power factor governs)'}>
            <Select {...draftInput('loadType')}>
              <option value="">—</option>
              {LOAD_TYPES.map((l) => <option key={l} value={l}>{l.replace(/_/g, ' ')}</option>)}
            </Select>
          </Field>
          <Field label="Max stage points" required>
            <Input type="number" min={0} {...draftInput('maximumStagePoints')} required />
          </Field>
          <Field label="Min rounds">
            <Input type="number" min={0} {...draftInput('minimumRounds')} placeholder="optional" />
          </Field>
          <Field label="Max rounds">
            <Input type="number" min={0} {...draftInput('maximumRounds')} placeholder="optional" />
          </Field>
          <Field label="Required hits">
            <Input type="number" min={1} {...draftInput('requiredHits')} placeholder="optional" />
          </Field>
          <Field label="Fixed time (s)">
            <Input type="number" min={0} step="0.1" {...draftInput('fixedTimeSeconds')} placeholder="optional" />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={busy || !createDraft.name.trim()}>Add stage</Button>
          </div>
        </form>
      </Card>

      {stages.length === 0 ? (
        <Empty>No stages yet. Add one above.</Empty>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <Th>#</Th>
                <Th>Name</Th>
                <Th>Course</Th>
                <Th>Method</Th>
                <Th>Max pts</Th>
                <Th>Rounds</Th>
                <Th>Targets</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {stages.map((s) => (
                <StageRowView
                  key={s.id}
                  stage={s}
                  editing={isEditing(s.id)}
                  draft={isEditing(s.id) ? editDraft : null}
                  busy={busy}
                  targetsOpen={targetsFor === s.id}
                  targets={targetsFor === s.id ? targets : null}
                  onDraft={setEditDraft}
                  onStartEdit={() => startEdit(s)}
                  onCancelEdit={cancelEdit}
                  onSaveEdit={saveEdit}
                  onRemove={() => removeStage(s)}
                  onToggleTargets={() => toggleTargets(s)}
                  onAddTarget={addTarget}
                  onAddManyTargets={addManyTargets}
                  onUpdateTarget={updateTarget}
                  onRemoveTarget={removeTarget}
                  onSaveTargets={saveTargets}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function StageRowView(props: {
  stage: StageRow;
  editing: boolean;
  draft: DraftStage | null;
  busy: boolean;
  targetsOpen: boolean;
  targets: TargetRow[] | null;
  onDraft: (d: DraftStage) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (e: React.FormEvent) => void;
  onRemove: () => void;
  onToggleTargets: () => void;
  onAddTarget: () => void;
  onAddManyTargets: (type: 'PAPER' | 'PLATE', count: number) => void;
  onUpdateTarget: (index: number, patch: Partial<TargetRow>) => void;
  onRemoveTarget: (index: number) => void;
  onSaveTargets: (e: React.FormEvent) => void;
}) {
  const { stage, editing, draft, busy } = props;

  if (editing && draft) {
    const editSetter = (key: keyof DraftStage) => ({
      value: (draft as unknown as Record<string, string>)[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        props.onDraft({ ...draft, [key]: e.target.value }),
    });
    return (
      <tr className="border-b border-line">
        <td colSpan={8} className="p-3">
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={props.onSaveEdit}>
            <Field label="Number" required><Input type="number" min={1} {...editSetter('number')} required /></Field>
            <Field label="Name" required><Input {...editSetter('name')} required /></Field>
            <Field label="Course type" required>
              <Select {...editSetter('courseType')} required>
                {COURSE_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Scoring method" required>
              <Select {...editSetter('scoringMethod')} required>
                {SCORING_METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
              </Select>
            </Field>
            <Field label="Load type" hint={isPsmocMethod(draft.scoringMethod) ? 'PSMOC paper point table' : 'PPSA/IPSC: leave unset (power factor governs)'}>
              <Select {...editSetter('loadType')}>
                <option value="">—</option>
                {LOAD_TYPES.map((l) => <option key={l} value={l}>{l.replace(/_/g, ' ')}</option>)}
              </Select>
            </Field>
            <Field label="Max stage points" required><Input type="number" min={0} {...editSetter('maximumStagePoints')} required /></Field>
            <Field label="Min rounds"><Input type="number" min={0} {...editSetter('minimumRounds')} /></Field>
            <Field label="Max rounds"><Input type="number" min={0} {...editSetter('maximumRounds')} /></Field>
            <Field label="Required hits"><Input type="number" min={1} {...editSetter('requiredHits')} /></Field>
            <Field label="Fixed time (s)"><Input type="number" min={0} step="0.1" {...editSetter('fixedTimeSeconds')} /></Field>
            <div className="flex items-end gap-2">
              <Button type="submit" disabled={busy || !draft.name.trim()}>Save</Button>
              <Button kind="ghost" type="button" onClick={props.onCancelEdit}>Cancel</Button>
            </div>
          </form>
          {props.targetsOpen ? (
            <TargetsEditor
              targets={props.targets}
              busy={busy}
              onAdd={props.onAddTarget}
              onAddMany={props.onAddManyTargets}
              onUpdate={props.onUpdateTarget}
              onRemove={props.onRemoveTarget}
              onSave={props.onSaveTargets}
            />
          ) : null}
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className="border-b border-line">
        <Td mono>{stage.number}</Td>
        <Td><span className="font-medium text-ink">{stage.name}</span></Td>
        <Td><Badge tone="sky">{stage.courseType}</Badge></Td>
        <Td>
          <span className="flex flex-wrap items-center gap-1">
            <span>{stage.scoringMethod.replace(/_/g, ' ')}</span>
            {stage.loadType ? <Badge tone="amber">{stage.loadType.replace(/_/g, ' ')}</Badge> : null}
          </span>
        </Td>
        <Td right>{stage.maximumStagePoints}</Td>
        <Td right>
          {stage.minimumRounds !== null || stage.maximumRounds !== null
            ? `${stage.minimumRounds ?? 0}–${stage.maximumRounds ?? '∞'}`
            : '—'}
        </Td>
        <Td right>{props.targets?.length ?? '…'}</Td>
        <Td>
          <div className="flex justify-end gap-2">
            <Button kind="secondary" onClick={props.onToggleTargets}>{props.targetsOpen ? 'Close targets' : 'Targets'}</Button>
            <Button kind="secondary" onClick={props.onStartEdit}>Edit</Button>
            <Button kind="danger" onClick={props.onRemove}>Delete</Button>
          </div>
        </Td>
      </tr>
      {props.targetsOpen ? (
        <tr className="border-b border-line">
          <td colSpan={8} className="p-3">
            <TargetsEditor
              targets={props.targets}
              busy={busy}
              onAdd={props.onAddTarget}
              onAddMany={props.onAddManyTargets}
              onUpdate={props.onUpdateTarget}
              onRemove={props.onRemoveTarget}
              onSave={props.onSaveTargets}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function TargetsEditor(props: {
  targets: TargetRow[] | null;
  busy: boolean;
  onAdd: () => void;
  onAddMany: (type: 'PAPER' | 'PLATE', count: number) => void;
  onUpdate: (index: number, patch: Partial<TargetRow>) => void;
  onRemove: (index: number) => void;
  onSave: (e: React.FormEvent) => void;
}) {
  const { targets, busy } = props;
  const [bulk, setBulk] = useState('1');
  const bulkCount = Math.min(50, Math.max(1, Number.parseInt(bulk, 10) || 1));
  return (
    <form className="mt-4 space-y-3" onSubmit={props.onSave}>
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Targets</h4>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted">Quick-add:</span>
          <Input
            type="number"
            min={1}
            max={50}
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            className="w-16"
            aria-label="Number of targets to add"
          />
          <Button kind="secondary" type="button" onClick={() => props.onAddMany('PAPER', bulkCount)}>Paper</Button>
          <Button kind="secondary" type="button" onClick={() => props.onAddMany('PLATE', bulkCount)}>Plate</Button>
          <Button kind="secondary" type="button" onClick={props.onAdd}>Blank</Button>
        </div>
      </div>
      {!targets ? (
        <Spinner className="h-4 w-4" />
      ) : targets.length === 0 ? (
        <p className="text-sm text-muted">No targets configured. Add some below.</p>
      ) : (
        <div className="space-y-2">
          {targets.map((t, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-6">
              <Input
                type="number"
                min={1}
                className="sm:col-span-1"
                value={String(t.number)}
                onChange={(e) => props.onUpdate(i, { number: Number(e.target.value) || i + 1 })}
                aria-label="Target number"
              />
              <Input
                className="sm:col-span-2"
                value={t.name ?? ''}
                placeholder="Name"
                onChange={(e) => props.onUpdate(i, { name: e.target.value })}
              />
              <Select
                className="sm:col-span-1"
                value={t.targetType}
                onChange={(e) => props.onUpdate(i, { targetType: e.target.value })}
                aria-label="Target type"
              >
                {TARGET_TYPES.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}
              </Select>
              {isPaperLike(t.targetType) ? (
                <>
                  <Input
                    className="sm:col-span-1"
                    value={t.requiredHits === null ? '' : String(t.requiredHits)}
                    placeholder="Hits"
                    onChange={(e) => props.onUpdate(i, { requiredHits: numOrNull(e.target.value) })}
                  />
                  <div className="flex gap-1 sm:col-span-1">
                    {(['A', 'C', 'D'] as const).map((z) => (
                      <label key={z} className={`flex-1 cursor-pointer rounded-md border px-1 text-center text-xs ${t.scoringZones?.includes(z) ? 'border-brand bg-brand/10 text-brand' : 'border-line text-muted hover:border-brand/40'}`}>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={t.scoringZones?.includes(z) ?? false}
                          onChange={(e) => {
                            const zones = t.scoringZones ?? [];
                            props.onUpdate(i, {
                              scoringZones: e.target.checked ? [...zones, z] : zones.filter((x) => x !== z),
                            });
                          }}
                        />
                        {z}
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex items-center text-xs text-muted sm:col-span-2">
                  1 hit · hit/miss (no zones)
                </div>
              )}
              <Button kind="danger" type="button" onClick={() => props.onRemove(i)}>Remove</Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>Save targets</Button>
      </div>
    </form>
  );
}