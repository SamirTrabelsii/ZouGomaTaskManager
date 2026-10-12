import { useStore } from '../state/store';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none absolute bottom-16 left-1/2 z-[60] flex w-[92vw] max-w-sm -translate-x-1/2 flex-col gap-2 md:bottom-20" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto flex items-center gap-3 rounded-xl px-3 py-2 text-sm shadow-soft ${t.kind === 'error' ? 'bg-clay-600 text-white' : 'border border-cream-300 bg-cream-50 text-ink-900'}`}>
          <span aria-hidden>{t.kind === 'error' ? '⚠' : t.kind === 'ok' ? '✓' : 'ℹ'}</span>
          <span className="flex-1">{t.text}</span>
          {t.action && <button className="font-semibold underline" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
          <button aria-label="Dismiss" className="opacity-70 hover:opacity-100" onClick={() => dismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
