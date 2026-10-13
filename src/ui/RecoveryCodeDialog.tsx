import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';

/**
 * Shows a freshly issued recovery code exactly once. It can't be dismissed by accident (no Escape / backdrop click):
 * the code is the only way back in if the password is forgotten, and the server keeps just a hash of it.
 */
export function RecoveryCodeDialog() {
  const code = useStore((s) => s.recoveryCode);
  const email = useStore((s) => s.cloud.email);
  const dismiss = useStore((s) => s.dismissRecoveryCode);
  const toast = useStore((s) => s.toast);
  const [saved, setSaved] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setSaved(false); if (code) ref.current?.querySelector<HTMLElement>('button')?.focus(); }, [code]);
  if (!code) return null;

  const copy = async () => {
    try { await navigator.clipboard.writeText(code); toast('Recovery code copied.', 'ok'); }
    catch { toast('Could not copy. Select the code and copy it by hand.', 'error'); }
  };
  const download = () => {
    const text = `LifeOS recovery code for ${email ?? 'your account'}\n\n${code}\n\nKeep this somewhere safe and private. It can reset your password if you forget it, and works once.\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'lifeos-recovery-code.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="rc-title" className="w-full max-w-md space-y-4 rounded-2xl bg-cream-50 p-6 shadow-soft">
        <h2 id="rc-title" className="font-serif text-xl font-semibold">Save your recovery code</h2>
        <p className="text-sm text-ink-700">
          If you ever forget your password, this code is the only way to reset it. It is shown <strong>once</strong>, works once, and LifeOS keeps only a scrambled copy, so nobody can show it to you again.
        </p>
        <p data-testid="recovery-code" className="select-all rounded-lg border border-cream-300 bg-cream-100 px-3 py-3 text-center font-mono text-lg tracking-wider">{code}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={copy}>Copy</button>
          <button type="button" className="btn" onClick={download}>Download .txt</button>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-moss-600" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I’ve saved this code somewhere safe.
        </label>
        <button type="button" className="btn btn-primary w-full justify-center" disabled={!saved} onClick={dismiss}>Continue</button>
      </div>
    </div>
  );
}
