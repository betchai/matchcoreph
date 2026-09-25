import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

const btnKinds = {
  primary: 'bg-accent text-[#17181a] hover:bg-gold',
  gold: 'bg-accent text-[#17181a] hover:bg-gold',
  secondary: 'border border-line bg-navy-2 text-ink hover:bg-panel',
  danger: 'border border-[#5a3030] bg-panel text-[#ff7b7b] hover:bg-[#3a2626]',
  ghost: 'bg-transparent text-muted hover:bg-[#2c2e30] hover:text-ink',
} as const;

export function Button({
  kind = 'primary',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: keyof typeof btnKinds | 'gold' }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-55 ${btnKinds[kind]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return <div className={`animate-spin rounded-full border-2 border-[#48494c] border-t-brand ${className}`} />;
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-card border border-line bg-panel shadow-card ${className}`}>{children}</div>;
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 ${className}`}
      {...rest}
    />
  );
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}

export function ComboBox({
  value,
  onChange,
  options,
  onSearch,
  placeholder = 'Search…',
  disabled,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
  onSearch?: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open) setText(selected ? selected.label : '');
  }, [value, selected, open]);

  const q = text.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  return (
    <div className={`relative ${className}`}>
      <Input
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (value) onChange('');
          onSearch?.(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />
      {open && !disabled ? (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-panel shadow-card">
          {shown.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted">No shooters match “{text.trim()}”.</p>
          ) : (
            shown.slice(0, 50).map((o) => (
              <button
                key={o.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(o.id);
                  setText(o.label);
                  setOpen(false);
                }}
                className={`block w-full truncate px-3 py-2 text-left text-sm ${o.id === value ? 'bg-[#43464a] font-semibold text-brand' : 'text-ink hover:bg-[#43464a]'}`}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-bold text-muted">
        {label}
        {required ? <span className="ml-1 text-pink" title="Required">*</span> : null}
      </span>
      {children}
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const badgeTones = {
  slate: 'bg-[#343639] text-[#c3cad2]',
  sky: 'bg-[#1e3a58] text-[#9cc8ec]',
  violet: 'bg-[#33255b] text-[#c9b8f0]',
  emerald: 'bg-[#1f4a35] text-[#7adead]',
  amber: 'bg-[#59451a] text-[#f2d27c]',
  rose: 'bg-[#5a2a33] text-[#ff9b9b]',
} as const;

export function Badge({ tone = 'slate', children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badgeTones[tone]}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-10 py-12 text-center text-sm text-muted">{children}</div>;
}

export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return <div className="rounded-xl border border-[#5a3030] bg-[#3a2626] px-4 py-3 text-sm text-[#ff9b9b]">{message}</div>;
}

// ── Tables ────────────────────────────────────────────────────────────────

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse px-0">{children}</table>
    </div>
  );
}

export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return (
    <th className={`border-b border-line bg-[#2e3032] px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted ${right ? 'text-right' : ''}`}>
      {children}
    </th>
  );
}

export function Td({ children, right, mono, className }: { children?: ReactNode; right?: boolean; mono?: boolean; className?: string }) {
  return (
    <td className={`border-b border-line px-3 py-2.5 text-sm text-ink last:border-b-0 ${right ? 'text-right' : ''} ${mono ? 'font-mono text-xs' : ''} ${className ?? ''}`}>
      {children}
    </td>
  );
}

// ── Metrics & progress ────────────────────────────────────────────────────

export function Progress({ value, tone = 'brand' }: { value: number; tone?: 'brand' | 'green' | 'accent' }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = tone === 'green' ? 'bg-green' : tone === 'accent' ? 'bg-accent' : 'bg-brand';
  return (
    <div className="h-2 w-full rounded-full bg-[#343639]">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function StatCard({ label, value, delta, deltaTone = 'green' }: { label: string; value: ReactNode; delta?: ReactNode; deltaTone?: 'green' | 'amber' | 'red' | 'muted' }) {
  const tone = deltaTone === 'amber' ? 'text-amber' : deltaTone === 'red' ? 'text-red' : deltaTone === 'muted' ? 'text-muted' : 'text-green';
  return (
    <Card className="p-5">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className="mt-1.5 text-3xl font-extrabold tracking-tight text-ink">{value}</p>
      {delta ? <p className={`mt-1.5 text-xs font-bold ${tone}`}>{delta}</p> : null}
    </Card>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border-l-4 border-accent bg-[#3a3424] px-4 py-3 text-[13px] text-[#f4cf6f]">{children}</div>;
}