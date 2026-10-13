import { useEffect, useRef, type ReactNode } from 'react';

export function ProgressBar({ value, label, className = '' }: { value: number; label?: string; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={className}>
      <div
        role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label ?? 'Progress'}
        className="h-2 w-full overflow-hidden rounded-full bg-cream-200"
      >
        <div className="h-full rounded-full bg-moss-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Ring({ value, size = 56, children }: { value: number; size?: number; children?: ReactNode }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#34427a" strokeWidth={5} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eba14a" strokeWidth={5} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, value))} style={{ transition: 'stroke-dashoffset .6s' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold">{children}</div>
    </div>
  );
}

export function EmptyState({ icon = '🌱', title, hint, action }: { icon?: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-cream-300 px-4 py-8 text-center">
      <div className="text-2xl" aria-hidden>{icon}</div>
      <div className="font-medium">{title}</div>
      {hint && <p className="max-w-xs text-sm text-ink-500">{hint}</p>}
      {action}
    </div>
  );
}

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Segmented<T extends string>({
  value, onChange, options, label,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-cream-200 p-0.5">
      {options.map((o) => (
        <button
          key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${value === o.value ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Accessible modal: focus trap-lite, Esc to close, restores focus. */
export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input,textarea,select,button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('input,textarea,select,button,[href]')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        const a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={`scroll-thin max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-cream-50 p-5 shadow-soft sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold">{title}</h2>
          <button className="btn btn-ghost px-2" onClick={onClose} aria-label="Close dialog">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmButton({
  onConfirm, children, confirmLabel = 'Confirm?', className = 'btn btn-ghost text-clay-600',
}: { onConfirm: () => void; children: ReactNode; confirmLabel?: string; className?: string }) {
  const [armed, setArmed] = useArmed();
  return (
    <button
      type="button" className={armed ? 'btn btn-danger' : className}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
      onBlur={() => setArmed(false)}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
import { useState } from 'react';
function useArmed() {
  const [a, setA] = useState(false);
  useEffect(() => {
    if (!a) return;
    const id = setTimeout(() => setA(false), 4000);
    return () => clearTimeout(id);
  }, [a]);
  return [a, setA] as const;
}

