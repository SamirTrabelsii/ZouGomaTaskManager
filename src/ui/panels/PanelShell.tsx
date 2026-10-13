import { useEffect, type ReactNode } from 'react';
import { useStore } from '../../state/store';

/** Side panel on desktop, bottom sheet on small screens. Esc closes. */
export function PanelShell({ title, icon, subtitle, children, actions }: { title: string; icon: string; subtitle?: string; children: ReactNode; actions?: ReactNode }) {
  const select = useStore((s) => s.select);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role=dialog]')) select(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [select]);
  return (
    <aside
      aria-label={title}
      className="pointer-events-auto absolute inset-x-0 bottom-14 z-30 flex max-h-[72vh] flex-col rounded-t-2xl border border-cream-300 bg-cream-50/95 shadow-soft backdrop-blur-md
                 md:inset-y-16 md:bottom-4 md:left-auto md:right-4 md:max-h-none md:w-[26rem] md:rounded-2xl lg:w-[28rem]"
    >
      <header className="flex items-start gap-3 border-b border-cream-300 px-4 py-3">
        <div className="text-2xl" aria-hidden>{icon}</div>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-lg font-semibold leading-tight">{title}</h2>
          {subtitle && <p className="truncate text-xs text-ink-500">{subtitle}</p>}
        </div>
        {actions}
        <button className="btn btn-ghost px-2" onClick={() => select(null)} aria-label={`Close ${title} panel`}>✕</button>
      </header>
      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto px-4 py-3">{children}</div>
    </aside>
  );
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode; count?: number }[] }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-x-0.5 border-b border-cream-300">
      {tabs.map((t) => (
        <button
          key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`-mb-px whitespace-nowrap border-b-2 px-2.5 py-1.5 text-[13px] font-medium transition ${value === t.id ? 'border-moss-600 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900'}`}
        >
          {t.label}{t.count != null && <span className="ml-1 text-xs text-ink-400">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
