import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { BdStatus, SolutionStatus } from '../../lib/breakdowns';

/* Small shared pieces for the breakdown screens */

export const rs = (n?: number) => `Rs ${Math.round(n ?? 0).toLocaleString('en-LK')}`;
const pad = (n: number) => String(n).padStart(2, '0');
/** ISO → value for <input type="datetime-local"> (local time) */
export const toLocalInput = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : undefined);
export const nowLocal = () => toLocalInput(new Date().toISOString());
export const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const num = (v: string) => (v === '' ? undefined : Number(v));

/** A labelled form control. */
export function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  // a <label> only around a native input / select / textarea; custom controls (option chips, the
  // dropdown Select…) get a labelled group, or clicking inside would re-trigger their first button
  const isGroup = typeof (children as { type?: unknown })?.type !== 'string';
  const body = <><span className="label">{label}</span>{children}{hint && <span className="block text-[11px] text-navy-400 mt-1">{hint}</span>}</>;
  return isGroup
    ? <div role="group" aria-label={label} className={`block ${className}`}>{body}</div>
    : <label className={`block ${className}`}>{body}</label>;
}

export function Section({ title, icon: Icon, children, action, tone }: { title: string; icon?: LucideIcon; children: ReactNode; action?: ReactNode; tone?: 'warn' }) {
  return (
    <section className={`rounded-2xl border p-4 space-y-3 ${tone === 'warn' ? 'border-amber-200 bg-amber-50/40' : 'border-navy-100 bg-white'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-navy-800 flex items-center gap-1.5">{Icon && <Icon size={15} className="text-navy-400" />}{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const c = cols === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
  return <div className={`grid grid-cols-1 ${c} gap-3`}>{children}</div>;
}

export function Chips<T extends string>({ value, options, onChange, size = 'sm' }: { value?: T | ''; options: [T, string][]; onChange: (v: T) => void; size?: 'sm' | 'xs' }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v}
                className={`${size === 'xs' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'} rounded-full font-semibold border transition-colors ${value === v ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-600 border-navy-100 hover:border-navy-300'}`}>{label}</button>
      ))}
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  open: 'bg-amber-50 text-amber-700', resolved: 'bg-sky-50 text-sky-700', closed: 'bg-emerald-50 text-emerald-700',
  disputed: 'bg-red-50 text-red-700', cancelled: 'bg-slate-100 text-slate-500',
  planned: 'bg-slate-100 text-slate-600', in_progress: 'bg-amber-50 text-amber-700', completed: 'bg-emerald-50 text-emerald-700', failed: 'bg-red-50 text-red-700',
  emergency: 'bg-red-600 text-white', high: 'bg-red-50 text-red-700', normal: 'bg-slate-100 text-slate-600', low: 'bg-slate-50 text-slate-500',
  settled: 'bg-emerald-50 text-emerald-700', outstanding: 'bg-amber-50 text-amber-800', no_cost: 'bg-slate-100 text-slate-500',
  pending: 'bg-amber-50 text-amber-800', partial: 'bg-sky-50 text-sky-700', in_progress_incident: 'bg-amber-50 text-amber-700',
  ready: 'bg-emerald-50 text-emerald-700', maintenance: 'bg-red-50 text-red-700',
};
export function Pill({ k, children }: { k: BdStatus | SolutionStatus | string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${STATUS_TONE[k] ?? 'bg-slate-100 text-slate-600'}`}>{children}</span>;
}

export function KV({ k, v, warn }: { k: string; v?: ReactNode; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm border-b border-navy-50 last:border-0">
      <span className="text-navy-400">{k}</span>
      <span className={`text-right font-medium ${warn ? 'text-red-600' : 'text-navy-800'}`}>{v ?? '—'}</span>
    </div>
  );
}

export const ErrorLine = ({ msg }: { msg?: string | null }) => (msg ? <p className="text-sm text-red-600">{msg}</p> : null);
