export function fmtDate(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtTime(v?: number | null): string {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(2)}s`;
}

export function fmtNum(v?: number | null, digits = 2): string {
  if (v === null || v === undefined) return '—';
  return v.toFixed(digits);
}

export function fmtPct(v?: number | null): string {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(2)}%`;
}

export function stageLabel(number: number): string {
  return `Stage ${number}`;
}