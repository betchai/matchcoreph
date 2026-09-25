import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Delete, Eye, Lock, Pencil, RotateCcw, Search, ShieldCheck, X } from 'lucide-react';
import { api, ApiError } from '../lib/api.js';
import { useAuth, useOrgPerm } from '../store/auth.js';
import { useMatch } from '../lib/match.js';
import { Badge, Button, Card, Empty, ErrorBanner, Field, Input, Notice, PageHeader, Select, Spinner, Table, Td, Th } from '../components/ui.js';

type Stage = {
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
};

type Target = {
  id: string;
  number: number;
  name: string | null;
  targetType: 'PAPER' | 'PAPER_NO_SHOOT' | 'STEEL' | 'POPPER' | 'PLATE' | 'CUSTOM';
  requiredHits: number | null;
  scoringZones: string[] | null;
};

type Registration = {
  id: string;
  firstName: string;
  lastName: string;
  divisionName: string | null;
  squadName: string | null;
  declaredPowerFactor: string;
  status: string;
  shooterId: string;
};

type ScoreWithCompetitor = {
  id: string;
  registrationId: string;
  stageId: string;
  status: string;
  timeSeconds: number | null;
  hitsJson: string;
  misses: number;
  paperNoShoots: number;
  procedurals: number;
  penaltiesOther: number;
  shotsFired: number | null;
  rawPoints: number | null;
  penaltyPoints: number | null;
  netPoints: number | null;
  hitFactor: number | null;
  finalTimeSeconds: number | null;
  timeAdjustmentsSeconds: number | null;
  competitorStatus: string;
  shooterName: string;
  divisionName: string | null;
};

type TargetScoreInput = { targetId: string; zoneHits?: string[]; hits?: number; steelMisses?: number; noShootHits?: number };

interface EditorState {
  registration: Registration;
  existingId: string | null;
  existingStatus: string | null;
  mode: 'edit' | 'view' | 'override';
  reason: string;
  targets: Record<string, TargetScoreInput>;
  timeSeconds: string;
  misses: string;
  paperNoShoots: string;
  procedurals: string;
  penaltiesOther: string;
  shotsFired: string;
  confirmStep: boolean;
  pinError: string;
}

const UNSCORABLE = new Set(['DQ', 'DNS', 'DNF', 'WITHDRAWN']);

function normalizeTimeOnBlur(v: string): string {
  const t = v.trim();
  if (t === '') return '';
  const asNumber = Number(t);
  if (!Number.isFinite(asNumber)) return v;
  if (t.includes('.')) return asNumber.toFixed(2);
  const digits = t.replace(/\D/g, '');
  if (digits === '') return v;
  return (Number(digits) / 100).toFixed(2);
}

const isPaper = (t: Target) => t.targetType === 'PAPER' || t.targetType === 'CUSTOM';
const isSteel = (t: Target) => t.targetType === 'STEEL' || t.targetType === 'POPPER' || t.targetType === 'PLATE';
const isNoShoot = (t: Target) => t.targetType === 'PAPER_NO_SHOOT';

const statusTone = (s: string): 'slate' | 'sky' | 'emerald' | 'amber' | 'rose' =>
  s === 'VERIFIED' || s === 'LOCKED' ? 'emerald' : s === 'DRAFT' ? 'sky' : s === 'SUBMITTED' ? 'amber' : s === 'DISPUTED' || s === 'DQ' ? 'rose' : 'slate';

function parseScores(hitsJson: string): Record<string, TargetScoreInput> {
  try {
    const arr = JSON.parse(hitsJson || '[]') as unknown;
    if (!Array.isArray(arr)) return {};
    const map: Record<string, TargetScoreInput> = {};
    for (const t of arr) map[t.targetId] = t;
    return map;
  } catch {
    return {};
  }
}

function Stepper({ label, value, disabled, onStep }: {
  label: string;
  value: number;
  disabled: boolean;
  onStep: (delta: number) => void;
}) {
  return (
    <div>
      <span className="block pb-1 text-[11px] font-medium text-muted">{label}</span>
      <div className="inline-flex items-center overflow-hidden rounded-lg border border-line bg-panel">
        <button
          type="button"
          disabled={disabled || value <= 0}
          onClick={() => onStep(-1)}
          className="px-2.5 py-1.5 text-sm font-semibold text-muted hover:bg-app disabled:cursor-not-allowed disabled:opacity-40"
        >
          −
        </button>
        <span className="min-w-[2.25rem] border-x border-line px-2 py-1.5 text-center text-sm font-bold tabular-nums">{value}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onStep(1)}
          className="px-2.5 py-1.5 text-sm font-semibold text-muted hover:bg-app disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}

function PinPad({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  const press = (k: string) => {
    if (disabled) return;
    if (k === 'back') onChange(value.slice(0, -1));
    else if (k === 'clear') onChange('');
    else if (value.length < 4) onChange(value + k);
  };
  return (
    <div className="w-full max-w-[300px]">
      <div className="mb-4 flex justify-center gap-4 py-1">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-[16px] w-[16px] rounded-full border transition-colors ${i < value.length ? 'border-brand bg-brand' : 'border-line bg-app'}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => press(k)}
            className="rounded-xl border border-line bg-panel py-4 text-2xl font-bold text-ink shadow-sm hover:bg-app active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {k === 'back' ? <Delete className="mx-auto h-6 w-6" /> : k === 'clear' ? '⌫' : k}
          </button>
        ))}
      </div>
    </div>
  );
}

function TargetEditor({ target, required, state, set, disabled }: {
  target: Target;
  required: number;
  state: EditorState;
  set: (e: EditorState) => void;
  disabled: boolean;
}) {
  const entry = state.targets[target.id] ?? {};
  const [flash, setFlash] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const longHeld = useRef(false);

  const armLongPress = () => {
    if (disabled) return;
    longHeld.current = false;
    pressTimer.current = window.setTimeout(() => {
      longHeld.current = true;
      set({ ...state, targets: { ...state.targets, [target.id]: { targetId: target.id, zoneHits: [] } } });
      setFlash(true);
      window.setTimeout(() => setFlash(false), 600);
    }, 600);
  };
  const disarmLongPress = () => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  if (isPaper(target)) {
    const zones = target.scoringZones?.length ? target.scoringZones : ['A', 'C', 'D'];
    const hits = [...(entry.zoneHits ?? [])];
    const counts: Record<string, number> = {};
    for (const z of hits) counts[z] = (counts[z] ?? 0) + 1;
    const cap = required;
    const total = hits.length;
    const tap = (z: string) => {
      if (disabled) return;
      set({ ...state, targets: { ...state.targets, [target.id]: { targetId: target.id, zoneHits: [...hits, z].slice(0, cap) } } });
    };
    const handleTap = (z: string) => {
      if (longHeld.current) {
        longHeld.current = false;
        return;
      }
      tap(z);
    };
    return (
      <div className={`rounded-xl border bg-panel px-3.5 py-3 transition-shadow ${flash ? 'border-brand/50 ring-2 ring-brand/30' : 'border-line'}`}>
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-xs font-bold text-ink">
            {target.number}. {target.name || 'Paper'} <span className="font-medium text-muted">· {required} hits</span>
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted">{target.targetType}</span>
            <button
              type="button"
              disabled={disabled || total === 0}
              onClick={() => set({ ...state, targets: { ...state.targets, [target.id]: { targetId: target.id, zoneHits: [] } } })}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-muted hover:bg-app disabled:cursor-not-allowed disabled:opacity-40"
              title="Clear this target's recorded hits"
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2.5">
          {zones.map((z) => {
            const count = counts[z] ?? 0;
            return (
              <button
                key={z}
                type="button"
                disabled={disabled || total >= cap}
                onPointerDown={armLongPress}
                onPointerUp={disarmLongPress}
                onPointerLeave={disarmLongPress}
                onPointerCancel={disarmLongPress}
                onClick={() => handleTap(z)}
                className={`h-16 w-14 flex-col items-center justify-center rounded-xl border text-base font-extrabold transition-all active:scale-95
                  ${count > 0 ? 'border-brand/40 bg-brand/10 text-ink' : 'border-line bg-panel text-muted'}
                  disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <span>{z}</span>
                <span className={`text-[11px] font-bold ${count > 0 ? 'text-brand' : 'text-muted/60'}`}>{count > 0 ? `${count}×` : '\u00A0'}</span>
              </button>
            );
          })}
          <span className="pb-1 text-[11px] font-medium text-muted">
            {total}/{cap} hits · tap to add, long-press to reset
          </span>
        </div>
      </div>
    );
  }
  if (isSteel(target)) {
    const hit = (entry.hits ?? 0) > 0;
    const missed = (entry.steelMisses ?? 0) > 0;
    const setSteel = (rec: 'HIT' | 'MISS' | 'UNSET') =>
      set({
        ...state,
        targets: {
          ...state.targets,
          [target.id]: { targetId: target.id, hits: rec === 'HIT' ? 1 : 0, steelMisses: rec === 'MISS' ? 1 : 0 },
        },
      });
    return (
      <div className="rounded-xl border border-line bg-panel px-3.5 py-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-bold text-ink">
            {target.number}. {target.name || target.targetType} <span className="font-medium text-muted">· hit or miss</span>
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted">{target.targetType}</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setSteel(hit && !missed ? 'UNSET' : 'HIT')}
            className={`flex h-12 w-24 items-center justify-center rounded-xl border text-sm font-bold transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50
              ${hit ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-300' : 'border-line bg-app text-muted'}`}
          >
            Hit
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setSteel(missed && !hit ? 'UNSET' : 'MISS')}
            className={`flex h-12 w-24 items-center justify-center rounded-xl border text-sm font-bold transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50
              ${missed ? 'border-rose-400/50 bg-rose-500/10 text-rose-300' : 'border-line bg-app text-muted'}`}
          >
            Miss
          </button>
          <span className="self-center text-[11px] font-medium text-muted">tap the correct one · tap again to clear</span>
        </div>
      </div>
    );
  }
  if (isNoShoot(target)) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-3.5 py-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-bold text-[#ff9b9b]">
            {target.number}. {target.name || 'No-shoot'} <span className="font-medium text-rose-500">· hits are a penalty</span>
          </span>
        </div>
        <Stepper
          label="No-shoot hits"
          value={entry.noShootHits ?? 0}
          disabled={disabled}
          onStep={(d) => set({ ...state, targets: { ...state.targets, [target.id]: { ...entry, targetId: target.id, noShootHits: Math.max(0, (entry.noShootHits ?? 0) + d) } } })}
        />
      </div>
    );
  }
  return null;
}

export default function ScoringPage() {
  const { orgId = '', matchId = '' } = useParams();
  const [stages, setStages] = useState<Stage[]>([]);
  const [stageId, setStageId] = useState('');
  const [targets, setTargets] = useState<Target[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [scores, setScores] = useState<ScoreWithCompetitor[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [pin, setPin] = useState('');
  const [forgotPinOpen, setForgotPinOpen] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [pinResetMsg, setPinResetMsg] = useState('');
  const [pinResetOk, setPinResetOk] = useState(false);
  const [previewHf, setPreviewHf] = useState<number | null>(null);
  const [previewFinalTime, setPreviewFinalTime] = useState<number | null>(null);
  const [previewAdjust, setPreviewAdjust] = useState<number | null>(null);

  const visibleRegs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return registrations;
    return registrations.filter((r) => `${r.lastName} ${r.firstName}`.toLowerCase().includes(q));
  }, [registrations, search]);

  const canEnter = useOrgPerm(orgId, 'score.enter');
  const canVerify = useOrgPerm(orgId, 'score.verify');
  const canLock = useOrgPerm(orgId, 'score.lock');
  const canCorrect = useOrgPerm(orgId, 'score.correct');
  const user = useAuth((s) => s.user);
  const roles = useAuth((s) => s.roles);
  const match = useMatch(orgId, matchId);

  const activeStage = useMemo(() => stages.find((s) => s.id === stageId) ?? stages[0] ?? null, [stages, stageId]);
  const activeStageId = activeStage?.id ?? '';
  /** PSMOC Time Scoring: results are ranked by final (penalty-adjusted) time. */
  const isTimeScoring = activeStage?.scoringMethod.endsWith('_TIME') ?? false;

  const loadScores = (sid: string) => {
    void api<ScoreWithCompetitor[]>(`/api/orgs/${orgId}/matches/${matchId}/scores?stageId=${encodeURIComponent(sid)}`)
      .then(setScores)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load scores'));
  };

  useEffect(() => {
    setError('');
    Promise.all([
      api<Stage[]>(`/api/orgs/${orgId}/matches/${matchId}/stages`),
      api<Registration[]>(`/api/orgs/${orgId}/matches/${matchId}/registrations`),
    ])
      .then(([stageRows, regRows]) => {
        setStages(stageRows);
        setRegistrations(regRows);
        const first = stageRows[0]?.id ?? '';
        setStageId(first);
        if (first) loadScores(first);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load scoring data'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, matchId]);

  useEffect(() => {
    if (!activeStageId) return;
    setError('');
    void api<Target[]>(`/api/orgs/${orgId}/matches/${matchId}/stages/${activeStageId}/targets`)
      .then(setTargets)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load stage targets'));
    loadScores(activeStageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStageId, orgId, matchId]);

  useEffect(() => {
    setPreviewHf(null);
    setPreviewFinalTime(null);
    setPreviewAdjust(null);
    if (!editor || !activeStageId) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void api<{ hitFactor: number | null; finalTimeSeconds: number | null; timeAdjustmentsSeconds: number | null; valid: boolean }>(`/api/orgs/${orgId}/matches/${matchId}/scores/preview`, {
        method: 'POST',
        json: buildPayload('SUBMITTED'),
      })
        .then((r) => {
          if (cancelled) return;
          if (r.valid) {
            if (r.finalTimeSeconds !== null && isTimeScoring) setPreviewFinalTime(r.finalTimeSeconds);
            if (r.timeAdjustmentsSeconds !== null && isTimeScoring) setPreviewAdjust(r.timeAdjustmentsSeconds);
            if (!isTimeScoring) setPreviewHf(r.hitFactor);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPreviewHf(null);
            setPreviewFinalTime(null);
            setPreviewAdjust(null);
          }
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, activeStageId, orgId, matchId, isTimeScoring]);

  const scoreFor = (regId: string) => scores.find((s) => s.registrationId === regId) ?? null;

  function requiredHitsFor(t: Target): number {
    const rh = t.requiredHits ?? activeStage?.requiredHits ?? (isPaper(t) ? 2 : 1);
    return Math.max(1, rh);
  }

  function derivedMisses(state: EditorState): number {
    let total = 0;
    for (const t of targets) {
      if (isNoShoot(t)) continue;
      const e = state.targets[t.id];
      if (isPaper(t)) {
        total += Math.max(0, requiredHitsFor(t) - (e?.zoneHits?.length ?? 0));
      } else if ((e?.hits ?? 0) === 0) {
        total += 1;
      }
    }
    return total;
  }

  function scoreSummary(state: EditorState): { A: number; C: number; D: number; M: number; NS: number; P: number } {
    const count = { A: 0, C: 0, D: 0 };
    let nsTargets = 0;
    for (const t of targets) {
      const e = state.targets[t.id];
      if (isPaper(t)) {
        for (const z of e?.zoneHits ?? []) {
          if (z === 'A' || z === 'C' || z === 'D') count[z] += 1;
        }
      } else if (isNoShoot(t)) {
        nsTargets += e?.noShootHits ?? 0;
      }
    }
    const NS = nsTargets + (Number.isFinite(Number(state.paperNoShoots)) ? Number(state.paperNoShoots) : 0);
    const P = Number.isFinite(Number(state.procedurals)) ? Number(state.procedurals) : 0;
    return { ...count, M: derivedMisses(state), NS, P };
  }

  function openScorecard(reg: Registration, mode: 'edit' | 'view' | 'override', confirmStep = false) {
    const score = scoreFor(reg.id);
    const hits = score ? parseScores(score.hitsJson) : {};
    setPin('');
    setForgotPinOpen(false);
    setNewPin('');
    setPinResetMsg('');
    setPinResetOk(false);
    setPreviewHf(null);
    setPreviewFinalTime(null);
    setEditor({
      registration: reg,
      existingId: score?.id ?? null,
      existingStatus: score?.status ?? null,
      mode,
      reason: '',
      targets: hits,
      timeSeconds: score?.timeSeconds != null ? String(score.timeSeconds) : '',
      misses: '0',
      paperNoShoots: String(score?.paperNoShoots ?? 0),
      procedurals: String(score?.procedurals ?? 0),
      penaltiesOther: String(score?.penaltiesOther ?? 0),
      shotsFired: score?.shotsFired != null ? String(score.shotsFired) : '',
      confirmStep,
      pinError: '',
    });
  }

  function openEditor(reg: Registration) {
    openScorecard(reg, 'edit');
  }

  function buildPayload(status: 'DRAFT' | 'SUBMITTED') {
    if (!editor) throw new Error('No editor state');
    const targetScores: TargetScoreInput[] = targets.map((t) => {
      const s = editor.targets[t.id] ?? {};
      if (isPaper(t)) return { targetId: t.id, zoneHits: s.zoneHits ?? [] };
      if (isSteel(t)) return { targetId: t.id, hits: s.hits ?? 0, steelMisses: s.steelMisses ?? 0 };
      if (isNoShoot(t)) return { targetId: t.id, noShootHits: s.noShootHits ?? 0 };
      return { targetId: t.id };
    });
    const num = (v: string) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const timeSeconds = editor.timeSeconds.trim() === '' ? null : num(editor.timeSeconds);
    return {
      matchId,
      stageId: activeStageId,
      registrationId: editor.registration.id,
      targets: targetScores,
      timeSeconds,
      misses: num(editor.misses),
      paperNoShoots: num(editor.paperNoShoots),
      procedurals: num(editor.procedurals),
      penaltiesOther: num(editor.penaltiesOther),
      shotsFired: editor.shotsFired.trim() === '' ? null : num(editor.shotsFired),
      status,
    };
  }

  async function saveDraft() {
    if (!editor) return;
    setSaving(true);
    setNotice('');
    setError('');
    try {
      await api(`/api/orgs/${orgId}/matches/${matchId}/scores`, { method: 'POST', json: buildPayload('DRAFT') });
      setNotice('Draft saved.');
      setEditor(null);
      loadScores(activeStageId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save score');
    } finally {
      setSaving(false);
    }
  }

  async function saveAndSubmit() {
    if (!editor) return;
    if (!editor.confirmStep) {
      setPin('');
      setEditor({ ...editor, confirmStep: true, pinError: '' });
      return;
    }
    if (pin.length !== 4) return;
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const res = await api<{ hitFactor: number | null; finalTimeSeconds: number | null; valid: boolean; warnings: string[] }>(
        `/api/orgs/${orgId}/matches/${matchId}/scores/submit`,
        { method: 'POST', json: { ...buildPayload('SUBMITTED'), confirmPin: pin } },
      );
      if (res.valid) {
        setNotice(
          res.finalTimeSeconds !== null
            ? `Submitted · final time ${res.finalTimeSeconds.toFixed(2)}s`
            : `Submitted · hit factor ${res.hitFactor?.toFixed(3) ?? '—'}`,
        );
      } else {
        setNotice('Submitted with configuration errors (see stage/results).');
      }
      setEditor(null);
      setPin('');
      setPinResetMsg('');
      setPinResetOk(false);
      loadScores(activeStageId);
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'SCORE_PIN_MISMATCH' || err.code === 'SCORE_PIN_NOT_SET')) {
        setEditor({ ...editor, pinError: err.message });
        setPin('');
      } else {
        setError(err instanceof Error ? err.message : 'Could not submit score');
      }
    } finally {
      setSaving(false);
    }
  }

  async function resetForgottenPin() {
    if (!editor || newPin.length !== 4) return;
    setSaving(true);
    setError('');
    setPinResetMsg('');
    try {
      await api<{ registrationId: string; hasScorePin: boolean }>(
        `/api/orgs/${orgId}/matches/${matchId}/scores/forgot-pin`,
        { method: 'POST', json: { registrationId: editor.registration.id, pin: newPin } },
      );
      setPinResetOk(true);
      setPinResetMsg(`New PIN set for ${editor.registration.lastName}, ${editor.registration.firstName} — have the shooter enter it below to confirm.`);
      setPin('');
      setNewPin('');
      setForgotPinOpen(false);
    } catch (err) {
      setPinResetOk(false);
      setPinResetMsg(err instanceof Error ? err.message : 'Could not reset PIN');
    } finally {
      setSaving(false);
    }
  }

  function authorizationToken(): string {
    if (user?.isSuperAdmin) return 'platform.superAdmin';
    if (roles.some((r) => r.organizationId === '*' && (r.role === 'PLATFORM_ADMIN' || r.role === 'PLATFORM_SUPER_ADMIN'))) return 'platform.admin';
    if (roles.some((r) => r.organizationId === orgId && r.role === 'ORGANIZATION_ADMIN')) return 'org.admin';
    return 'admin';
  }

  async function overrideScore() {
    if (!editor) return;
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const p = buildPayload('SUBMITTED');
      const newValue = JSON.stringify({
        targets: p.targets,
        timeSeconds: p.timeSeconds,
        misses: p.misses,
        paperNoShoots: p.paperNoShoots,
        procedurals: p.procedurals,
        penaltiesOther: p.penaltiesOther,
        shotsFired: p.shotsFired,
      });
      const res = await api<{ status: string }>(
        `/api/orgs/${orgId}/matches/${matchId}/scores/${editor.existingId}/correct`,
        { method: 'POST', json: { field: 'scorecard', previousValue: null, newValue, reason: editor.reason.trim() || 'Platform admin override', authorization: authorizationToken() } },
      );
      setNotice(`Score overridden — status ${res.status}.`);
      setEditor(null);
      loadScores(activeStageId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not override score');
    } finally {
      setSaving(false);
    }
  }

  async function workflow(score: ScoreWithCompetitor, action: 'VERIFY' | 'LOCK' | 'UNLOCK' | 'REJECT') {
    setError('');
    try {
      const res = await api<{ status: string }>(
        `/api/orgs/${orgId}/matches/${matchId}/scores/${score.id}/workflow`,
        { method: 'PATCH', json: { action } },
      );
      setNotice(`Score ${res.status}.`);
      loadScores(activeStageId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Workflow action failed');
    }
  }

  const editTime = editor?.timeSeconds.trim();
  const editTimeN = editTime ? Number(editTime) : NaN;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Score Entry"
        subtitle={activeStage ? `Match: ${match?.name ?? '…'} · Stage ${activeStage.number}: ${activeStage.name} · ${activeStage.scoringMethod}` : `Match: ${match?.name ?? '…'}`}
        actions={
          stages.length > 0 ? (
            <Select value={activeStageId} onChange={(e) => setStageId(e.target.value)} className="w-64">
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  Stage {s.number}: {s.name} ({s.scoringMethod})
                </option>
              ))}
            </Select>
          ) : undefined
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Notice>{notice}</Notice> : null}

      {activeStage ? (
        <div className="-mt-2 flex flex-wrap gap-2 text-xs text-muted">
          <span>{activeStage.scoringMethod}</span>
          <span>·</span>
          <span>{activeStage.maximumStagePoints} max points</span>
          {activeStage.minimumRounds != null && <><span>·</span><span>{activeStage.minimumRounds}–{activeStage.maximumRounds ?? '?'} rounds</span></>}
          {activeStage.fixedTimeSeconds != null && <><span>·</span><span>fixed {activeStage.fixedTimeSeconds}s</span></>}
        </div>
      ) : null}

      {stages.length === 0 ? (
        <Card className="p-6"><Empty>No stages yet — create stages before scoring.</Empty></Card>
      ) : (
        <>
          <div className="-mt-2 flex items-center justify-between gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search competitors by name…" className="pl-8" />
            </div>
            <span className="text-xs tabular-nums text-muted">
              {visibleRegs.length} of {registrations.length} competitors
            </span>
          </div>
          <Card className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Competitor</Th>
                <Th>Division</Th>
                <Th>PF</Th>
                <Th>Order</Th>
                <Th>Time</Th>
                <Th>{isTimeScoring ? 'Adjust' : 'Points'}</Th>
                <Th>{isTimeScoring ? 'Final' : 'HF'}</Th>
                <Th>Status</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {visibleRegs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-0">
                    {registrations.length === 0 ? <Empty>No competitors registered.</Empty> : <Empty>No competitors match your search.</Empty>}
                  </td>
                </tr>
              ) : (
                visibleRegs.map((reg) => {
                  const score = scoreFor(reg.id);
                  const unscorable = UNSCORABLE.has(reg.status);
                  return (
                    <tr key={reg.id}>
                      <Td>
                        {reg.lastName}, {reg.firstName}
                        <span className="ml-2 text-xs text-muted">#{reg.declaredPowerFactor}</span>
                      </Td>
                      <Td><Badge tone="sky">{reg.divisionName ?? '—'}</Badge></Td>
                      <Td><Badge tone="slate">{reg.declaredPowerFactor}</Badge></Td>
                      <Td>{reg.squadName ?? '—'}</Td>
                      <Td mono>{score?.timeSeconds != null ? score.timeSeconds.toFixed(2) : '—'}</Td>
                      <Td mono>
                        {isTimeScoring
                          ? score != null && score.timeAdjustmentsSeconds != null
                            ? `${score.timeAdjustmentsSeconds.toFixed(2)}s`
                            : '—'
                          : score?.netPoints != null ? score.netPoints.toFixed(1) : '—'}
                      </Td>
                      <Td mono>
                        {isTimeScoring
                          ? score?.finalTimeSeconds != null
                            ? <>${(score.finalTimeSeconds).toFixed(2)}<span className="ml-1 text-[10px] text-muted">s</span></>
                            : '—'
                          : score?.hitFactor != null ? score.hitFactor.toFixed(3) : '—'}
                      </Td>
                      <Td>
                        {unscorable ? (
                          <Badge tone="rose">{reg.status}</Badge>
                        ) : score ? (
                          <Badge tone={statusTone(score.status)}>{score.status}</Badge>
                        ) : (
                          <span className="text-xs text-muted">Not scored</span>
                        )}
                      </Td>
                      <Td right>
                        {unscorable ? (
                          <span className="text-xs text-muted">—</span>
                        ) : !score ? (
                          canEnter ? (
                            <Button kind="secondary" className="px-2.5 py-1 text-xs" onClick={() => openEditor(reg)}>
                              <Pencil className="h-3 w-3" /> Enter
                            </Button>
                          ) : null
                        ) : (
                          <span className="inline-flex flex-wrap justify-end gap-1.5">
                            <Button kind="ghost" className="px-2.5 py-1 text-xs" title="View scorecard" onClick={() => openScorecard(reg, 'view')}>
                              <Eye className="h-3 w-3" /> View
                            </Button>
                            {score.status === 'DRAFT' && canEnter && (
                              <>
                                <Button kind="secondary" className="px-2.5 py-1 text-xs" onClick={() => openEditor(reg)}>
                                  <Pencil className="h-3 w-3" /> Edit
                                </Button>
                                <Button kind="primary" className="px-2.5 py-1 text-xs" onClick={() => openScorecard(reg, 'edit', true)}>
                                  <Check className="h-3 w-3" /> Review & submit
                                </Button>
                              </>
                            )}
                            {score.status === 'SUBMITTED' && canVerify && (
                              <>
                                <Button kind="secondary" className="px-2.5 py-1 text-xs" onClick={() => void workflow(score, 'VERIFY')}>
                                  <Check className="h-3 w-3" /> Verify
                                </Button>
                                <Button kind="ghost" className="px-2.5 py-1 text-xs" onClick={() => void workflow(score, 'REJECT')}>
                                  <RotateCcw className="h-3 w-3" /> Reject
                                </Button>
                              </>
                            )}
                            {score.status === 'VERIFIED' && canLock && (
                              <Button kind="secondary" className="px-2.5 py-1 text-xs" onClick={() => void workflow(score, 'LOCK')}>
                                <Lock className="h-3 w-3" /> Lock
                              </Button>
                            )}
                            {score.status === 'LOCKED' && canLock && (
                              <Button kind="ghost" className="px-2.5 py-1 text-xs" onClick={() => void workflow(score, 'UNLOCK')}>
                                <RotateCcw className="h-3 w-3" /> Unlock
                              </Button>
                            )}
                            {score.status !== 'DRAFT' && score.status !== 'SUBMITTED' && canCorrect && (
                              <Button kind="danger" className="px-2.5 py-1 text-xs" title="Platform override — replace this score with an audited correction" onClick={() => openScorecard(reg, 'override')}>
                                <ShieldCheck className="h-3 w-3" /> Override
                              </Button>
                            )}
                          </span>
                        )}
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </Card>
        </>
      )}

      {editor ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy/60 p-4 backdrop-blur-sm">
          <div className="my-6 w-full max-w-3xl rounded-2xl border border-line bg-panel shadow-card">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-ink">
                  {editor.registration.lastName}, {editor.registration.firstName}
                </h3>
                <p className="text-xs text-muted">Stage {activeStage?.number}: {activeStage?.name}</p>
              </div>
              <div className="flex items-center gap-2">
                {editor.mode === 'override' ? <Badge tone="rose">Override</Badge> : editor.mode === 'view' ? <Badge tone="slate">Viewing</Badge> : null}
                <button onClick={() => setEditor(null)} className="rounded-md p-1.5 text-muted hover:bg-app hover:text-ink" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {editor.mode === 'override' ? (
              <div className="flex items-start gap-2.5 border-b border-line bg-[#3a2626]/60 px-5 py-3 text-[13px] text-[#ff9b9b]">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Authoritative override — this replaces the {editor.existingStatus} score with a full recalculation and records an audited correction.
                </span>
              </div>
            ) : null}

            {editor.mode === 'override' ? (
              <div className="border-b border-line px-5 pb-0 pt-3">
                <Field label="Reason for override (recorded in audit log)">
                  <textarea
                    value={editor.reason}
                    onChange={(e) => setEditor({ ...editor, reason: e.target.value })}
                    rows={2}
                    placeholder="e.g. Range master confirmed mis-entry on stage score"
                    className="w-full resize-none rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  />
                </Field>
              </div>
            ) : null}

            {editor.confirmStep && editor.mode === 'edit' ? (
              <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-5">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-ink">Shooter confirmation</h4>
                  <Badge tone="amber">Awaiting PIN</Badge>
                  <span className="ml-auto truncate text-xs text-muted">{editor.registration.lastName}, {editor.registration.firstName}</span>
                </div>

                {(() => {
                  const s = scoreSummary(editor);
                  const tile = (letter: string, word: string, value: number, accent: string) => (
                    <div className="rounded-lg border border-line bg-panel px-2 py-2.5 text-center">
                      <p className={`text-xs font-black leading-none ${accent}`}>{letter}</p>
                      <p className="mt-1 truncate text-[10px] uppercase leading-none tracking-wide text-muted">{word}</p>
                      <p className={`mt-1.5 text-xl font-black leading-none tabular-nums ${accent}`}>{value}</p>
                    </div>
                  );
                  return (
                    <div className="rounded-xl border border-line bg-app p-4">
                      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Score summary</p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                        {tile('A', 'alpha', s.A, 'text-ink')}
                        {tile('C', 'charlie', s.C, 'text-ink')}
                        {tile('D', 'delta', s.D, 'text-ink')}
                        {tile('M', 'misses', s.M, 'text-rose-300')}
                        {tile('NS', 'no-shoot', s.NS, 'text-amber-300')}
                        {tile('P', 'procedural', s.P, 'text-rose-300')}
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-2 border-t border-line pt-3 sm:grid-cols-3">
                        <div className="min-w-0 rounded-lg border border-line bg-panel px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wider text-muted">Stage</p>
                          <p className="mt-0.5 truncate text-[13px] font-semibold text-ink">
                            {activeStage?.number}. {activeStage?.name}
                          </p>
                        </div>
                        <div className="rounded-lg border border-line bg-panel px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wider text-muted">Time</p>
                          <p className="mt-0.5 font-semibold text-ink tabular-nums">
                            {editor.timeSeconds.trim() !== '' && Number.isFinite(Number(editor.timeSeconds)) ? `${Number(editor.timeSeconds).toFixed(2)}s` : '—'}
                          </p>
                        </div>
                        <div className={`rounded-lg border bg-panel px-3 py-2 ${isTimeScoring ? (previewFinalTime !== null ? 'border-brand/40 bg-brand/5' : 'border-line') : (previewHf !== null ? 'border-brand/40 bg-brand/5' : 'border-line')}`}>
                          <p className="text-[10px] uppercase tracking-wider text-muted">{isTimeScoring ? 'Final time' : 'Hit factor'}</p>
                          <p className={`mt-0.5 font-black tabular-nums ${(isTimeScoring ? previewFinalTime : previewHf) !== null ? 'text-ink' : 'text-muted'}`}>
                            {isTimeScoring
                              ? previewFinalTime !== null ? `${previewFinalTime.toFixed(2)}s` : '—'
                              : previewHf !== null ? previewHf.toFixed(3) : '—'}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="rounded-xl border border-line bg-app p-4 text-[13px] text-ink">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Score sheet</p>
                    <span className="truncate text-[11px] uppercase tracking-wide text-muted">{activeStage?.number}. {activeStage?.name}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {targets.filter((t) => !isNoShoot(t)).length === 0 && targets.filter((t) => isNoShoot(t)).length === 0 ? (
                      <p className="col-span-full text-xs text-muted">No targets configured for this stage.</p>
                    ) : null}
                    {targets.map((t) => {
                      const e = editor.targets[t.id] ?? {};
                      if (isNoShoot(t)) {
                        const hits = e.noShootHits ?? 0;
                        return (
                          <div key={t.id} className="flex items-center gap-2.5 rounded-lg border border-rose-400/30 bg-rose-500/5 px-3 py-2">
                            <span className="text-[12px] font-bold text-muted">T{t.number}</span>
                            <span className={`ml-auto shrink-0 text-[11px] font-black uppercase tracking-wide ${hits > 0 ? 'text-rose-300' : 'text-muted'}`}>
                              {hits > 0 ? `${hits} hit${hits > 1 ? 's' : ''}` : 'clean'}
                            </span>
                          </div>
                        );
                      }
                      if (isPaper(t)) {
                        const zones = e.zoneHits ?? [];
                        return (
                          <div key={t.id} className="flex items-center gap-2.5 rounded-lg border border-line bg-panel px-3 py-2">
                            <span className="text-[12px] font-bold text-ink">T{t.number}</span>
                            {zones.length === 0 ? (
                              <span className="ml-auto text-[11px] text-muted">—</span>
                            ) : (
                              <span className="ml-auto flex shrink-0 items-center gap-1">
                                {zones.map((z, i) => (
                                  <span key={i} className="inline-flex h-6 w-6 items-center justify-center rounded border border-brand/40 bg-brand/10 text-[11px] font-black text-ink">
                                    {z}
                                  </span>
                                ))}
                              </span>
                            )}
                          </div>
                        );
                      }
                      const hit = (e.hits ?? 0) > 0;
                      const missed = (e.steelMisses ?? 0) > 0;
                      return (
                        <div key={t.id} className="flex items-center gap-2.5 rounded-lg border border-line bg-panel px-3 py-2">
                          <span className="text-[12px] font-bold text-ink">T{t.number}</span>
                          <span className={`ml-auto shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${hit ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-300' : missed ? 'border-rose-400/50 bg-rose-500/10 text-rose-300' : 'border-line bg-app text-muted'}`}>
                            {hit ? 'hit' : missed ? 'miss' : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {(() => {
                    const s = scoreSummary(editor);
                    const other = Number.isFinite(Number(editor.penaltiesOther)) ? Number(editor.penaltiesOther) : 0;
                    return (
                      <div className="mt-3 flex items-center justify-between gap-4 border-t border-line pt-3">
                        <span className="text-muted">Other penalties (PE)</span>
                        <span className={`rounded-md px-2 py-1 text-sm font-black tabular-nums ${other > 0 ? 'bg-rose-500/10 text-rose-300' : 'text-muted'}`}>{other}</span>
                      </div>
                    );
                  })()}
                </div>

                <div className="rounded-xl border border-line bg-panel p-5">
                  <div className="mx-auto w-full max-w-[300px]">
                    <PinPad value={pin} onChange={setPin} disabled={saving} />
                    <div className="mt-4 text-center">
                      <p className="text-[13px] font-semibold text-ink">Shooter enters their 4-digit PIN</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted">
                        {editor.registration.firstName} confirms this scorecard by entering the PIN they got at registration. Long-press reset and edits happen in the entry view.
                      </p>
                    </div>
                  </div>
                </div>
                {pinResetMsg ? (
                  <p className={`rounded-lg px-3 py-2 text-center text-xs font-medium ${pinResetOk ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-400'}`}>
                    {pinResetMsg}
                  </p>
                ) : null}
                {forgotPinOpen ? (
                  <div className="rounded-lg border border-line bg-app p-3">
                    <p className="text-xs font-semibold text-ink">Reset a forgotten PIN</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                      Set a fresh 4-digit PIN for {editor.registration.firstName}. The reset is recorded in the audit trail — only use this when the shooter can't recall their PIN.
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <Input
                        value={newPin}
                        onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="New PIN"
                        autoFocus
                        className="w-36"
                      />
                      <Button kind="danger" onClick={() => void resetForgottenPin()} disabled={saving || newPin.length !== 4}>
                        {saving ? <Spinner className="h-4 w-4" /> : null} Set new PIN
                      </Button>
                      <Button kind="ghost" onClick={() => { setForgotPinOpen(false); setNewPin(''); setPinResetMsg(''); setPinResetOk(false); }} disabled={saving}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center">
                    <button type="button" onClick={() => { setForgotPinOpen(true); setPinResetMsg(''); setPinResetOk(false); }} className="text-xs font-medium text-rose-400 transition hover:text-rose-300">
                      Forgot PIN?
                    </button>
                  </div>
                )}
                {editor.pinError ? (
                  <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-[13px] font-medium text-rose-500">{editor.pinError}</p>
                ) : null}
              </div>
            ) : (
            <div className="grid max-h-[70vh] gap-5 overflow-y-auto px-5 py-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label="Time (s)">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editor.timeSeconds}
                      disabled={editor.mode === 'view'}
                      onChange={(e) => setEditor({ ...editor, timeSeconds: e.target.value })}
                      onBlur={() => setEditor({ ...editor, timeSeconds: normalizeTimeOnBlur(editor.timeSeconds) })}
                      placeholder="0.00"
                    />
                    <p className="mt-1 text-xs text-muted">Digits only, no decimal point — e.g. 1255 becomes 12.55 (an exact 13 seconds is 1300).</p>
                  </Field>
                  <Field label="Procedurals">
                    <Input type="number" min="0" value={editor.procedurals} disabled={editor.mode === 'view'} onChange={(e) => setEditor({ ...editor, procedurals: e.target.value })} />
                  </Field>
                  <Field label="No-shoots (NS hits)">
                    <Input type="number" min="0" value={editor.paperNoShoots} disabled={editor.mode === 'view'} onChange={(e) => setEditor({ ...editor, paperNoShoots: e.target.value })} />
                  </Field>
                  <Field label="Other penalties">
                    <Input type="number" min="0" value={editor.penaltiesOther} disabled={editor.mode === 'view'} onChange={(e) => setEditor({ ...editor, penaltiesOther: e.target.value })} />
                  </Field>
                  <Field label="Shots fired (optional)">
                    <Input type="number" min="0" value={editor.shotsFired} disabled={editor.mode === 'view'} onChange={(e) => setEditor({ ...editor, shotsFired: e.target.value })} />
                  </Field>
                </div>

                <div className="space-y-2">
                  {targets.length === 0 ? (
                    <p className="rounded-xl border border-line bg-app px-3 py-2.5 text-xs text-muted">
                      No targets configured for this stage.
                    </p>
                  ) : (
                    targets.map((t) => <TargetEditor key={t.id} target={t} required={requiredHitsFor(t)} state={editor} set={setEditor} disabled={editor.mode === 'view'} />)
                  )}
                </div>
              </div>

              <div className="rounded-2xl bg-panel p-5 text-ink">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Calculated stage score</p>
                <p className="mt-2 text-3xl font-extrabold tracking-tight">
                  {isTimeScoring
                    ? previewFinalTime !== null ? `${previewFinalTime.toFixed(2)}` : '—'
                    : previewHf !== null ? previewHf.toFixed(3) : '—'}
                  <span className="ml-1 text-lg font-bold text-muted">{isTimeScoring ? 's' : 'HF'}</span>
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2">
                  <div className="rounded-lg bg-white/10 px-3 py-2.5">
                    <small className="text-[11px] text-muted">{isTimeScoring ? 'Raw Time' : 'Raw Points'}</small>
                    <strong className="mt-0.5 block text-lg font-bold">{Number.isFinite(editTimeN) ? editTimeN.toFixed(2) : '—'}</strong>
                  </div>
                  <div className="rounded-lg bg-white/10 px-3 py-2.5">
                    <small className="text-[11px] text-muted">{isTimeScoring ? 'Adjust' : 'Penalties'}</small>
                    <strong className="mt-0.5 block text-lg font-bold">{previewAdjust !== null ? `+${previewAdjust.toFixed(2)}s` : '—'}</strong>
                  </div>
                  <div className="rounded-lg bg-white/10 px-3 py-2.5">
                    <small className="text-[11px] text-muted">{isTimeScoring ? 'Final Time' : 'Net Score'}</small>
                    <strong className="mt-0.5 block text-lg font-bold">
                      {isTimeScoring
                        ? previewFinalTime !== null ? `${previewFinalTime.toFixed(2)}s` : '—'
                        : '—'}
                    </strong>
                  </div>
                  <div className="rounded-lg bg-white/10 px-3 py-2.5">
                    <small className="text-[11px] text-muted">{isTimeScoring ? 'Penalties' : 'Time'}</small>
                    <strong className="mt-0.5 block text-lg font-bold">
                      {isTimeScoring ? '—' : Number.isFinite(editTimeN) ? editTimeN.toFixed(2) : '—'}
                    </strong>
                  </div>
                </div>
                <div className="mt-6">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Stage status</p>
                  <div className="mt-1.5">
                    {editor.existingStatus ? <Badge tone={statusTone(editor.existingStatus)}>{editor.existingStatus}</Badge> : <span className="text-sm font-semibold">New score</span>}
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted">
                    {editor.mode === 'override'
                      ? 'Override replaces verified/locked values with a full audited correction. The previous scorecard is preserved in the correction history.'
                      : editor.mode === 'view'
                        ? 'Read-only view of the recorded scorecard. Use Override (authorized administrators) to correct verified or locked scores.'
                        : 'Tap zones to build the scorecard; draft saves locally, and submit asks the shooter to confirm with their PIN.'}
                  </p>
                </div>
              </div>
            </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
              <div className="flex items-center gap-1.5 text-xs text-muted">
                {editor.existingStatus ? <Badge tone={statusTone(editor.existingStatus)}>{editor.existingStatus}</Badge> : <span>New</span>}
              </div>
              <div className="flex gap-2">
                {editor.mode === 'view' ? (
                  <Button kind="ghost" onClick={() => setEditor(null)}>Close</Button>
                ) : editor.mode === 'override' ? (
                  <>
                    <Button kind="ghost" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button>
                    <Button kind="danger" onClick={() => void overrideScore()} disabled={saving}>
                      {saving ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />} Save override
                    </Button>
                  </>
                ) : editor.confirmStep ? (
                  <>
                    <Button kind="ghost" onClick={() => { setEditor({ ...editor, confirmStep: false, pinError: '' }); setPin(''); }} disabled={saving}>
                      Back
                    </Button>
                    <Button kind="primary" onClick={() => void saveAndSubmit()} disabled={saving || pin.length !== 4}>
                      {saving ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />} Confirm & submit
                    </Button>
                  </>
                ) : (
                  <>
                    <Button kind="ghost" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button>
                    <Button kind="secondary" onClick={() => void saveDraft()} disabled={saving}>
                      {saving ? <Spinner className="h-4 w-4" /> : null} Save draft
                    </Button>
                    <Button kind="primary" onClick={() => void saveAndSubmit()} disabled={saving}>
                      {saving ? <Spinner className="h-4 w-4" /> : null} Save & submit
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}