import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { useAgent } from '../state/agent';
import { ConfirmButton, Field } from './common/ui';
import { ago } from './FeedsSettings';

const MAX_TOKENS = 3;
const REFRESH_MS = 60_000;

/** The access token, shown once. It is never stored in the browser. */
function NewToken({ token, onDone }: { token: string; onDone: () => void }) {
  const toast = useStore.getState().toast;
  const copy = async () => {
    try { await navigator.clipboard.writeText(token); toast('Token copied'); } catch { toast('Couldn’t copy. Select the token and copy it by hand.', 'error'); }
  };
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-moss-600/40 bg-moss-600/10 p-3">
      <p className="font-medium">Copy this token now: it won’t be shown again.</p>
      <div className="flex gap-2">
        <input className="input font-mono text-xs" readOnly value={token} aria-label="New agent token" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn" onClick={() => void copy()}>Copy</button>
      </div>
      <p className="text-xs text-ink-500">
        The agent sends it as <code>Authorization: Bearer …</code> to <code>{window.location.origin}/api/agent</code>. Keep it on your computer only;
        anyone who has it can write alerts into your studio (it opens nothing else). Lost it? Revoke it and make a new one.
      </p>
      <button type="button" className="btn btn-primary" onClick={onDone}>I’ve saved it</button>
    </div>
  );
}

export function AgentSettings() {
  const overview = useAgent((s) => s.overview);
  const stale = useAgent((s) => s.stale);
  const toast = useStore.getState().toast;
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Only while this section is on screen, so a closed Settings never wakes the server for nothing.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void useAgent.getState().refresh(); };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, []);

  const tokens = overview?.tokens ?? [];
  const seen = !!overview?.lastSeenAt;
  const paused = overview?.state === 'paused';

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr('Give the token a name, e.g. “Work laptop”.');
    setBusy(true); setErr('');
    const r = await useAgent.getState().createToken(name.trim());
    setBusy(false);
    if ('error' in r) return setErr(r.error);
    setName('');
    setFresh(r.token);
  };
  const order = async (kind: 'pause' | 'resume') => {
    const e = await useAgent.getState().send(kind);
    toast(e ?? 'Order sent. The agent takes it on its next check-in.', e ? 'error' : 'ok');
  };

  return (
    <section aria-labelledby="s-agent">
      <h3 id="s-agent" className="mb-1 font-semibold">AI agent</h3>
      <p className="mb-2 text-sm text-ink-500">
        A helper that runs on your own computer and watches your alerts. It only ever calls LifeOS, never the other way round, and it sends short
        summaries and fixes for you to copy. It signs in with a token below instead of your password.
      </p>
      <div className="card space-y-3 text-sm">
        {stale && <p role="status" className="text-xs text-ink-500">Can’t reach the server right now — showing the last status we have.</p>}

        <div className="flex flex-wrap items-center gap-2" role="status" aria-label="Agent status">
          <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${overview?.online ? 'bg-moss-600' : 'bg-ink-400'}`} />
          <span className="font-medium">{!overview ? 'Checking…' : overview.online ? (paused ? 'Online, paused' : overview.state === 'working' ? 'Online, working' : 'Online') : seen ? 'Offline' : 'Not connected yet'}</span>
          {seen && <span className="text-xs text-ink-500">seen {ago(overview!.lastSeenAt)}{overview!.version ? ` · v${overview!.version}` : ''}</span>}
          {overview?.online && (
            <button className="btn ml-auto text-xs" onClick={() => void order(paused ? 'resume' : 'pause')}>{paused ? 'Resume agent' : 'Pause agent'}</button>
          )}
        </div>

        {tokens.length === 0 ? <p className="text-ink-500">No access tokens yet. Create one to connect your agent.</p> : (
          <ul className="space-y-2" aria-label="Access tokens">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-2 rounded-lg bg-cream-100 p-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.name} <span className="font-mono text-xs text-ink-400">…{t.hint}</span></div>
                  <div className="truncate text-xs text-ink-500">created {ago(t.createdAt)} · {t.lastUsedAt ? `last used ${ago(t.lastUsedAt)}` : 'never used'}</div>
                </div>
                <ConfirmButton className="btn btn-ghost text-xs text-clay-600" confirmLabel="Revoke?" onConfirm={async () => {
                  const e = await useAgent.getState().revokeToken(t.id);
                  toast(e ?? `Revoked “${t.name}”`, e ? 'error' : 'ok');
                }}>Revoke</ConfirmButton>
              </li>
            ))}
          </ul>
        )}

        {fresh && <NewToken token={fresh} onDone={() => setFresh(null)} />}

        {tokens.length < MAX_TOKENS ? (
          <form className="flex flex-wrap items-end gap-2" onSubmit={create}>
            <Field label="New token" className="min-w-[10rem] flex-1">
              <input className="input" value={name} maxLength={40} placeholder="Work laptop" onChange={(e) => { setName(e.target.value); setErr(''); }} />
            </Field>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : '＋ Create token'}</button>
          </form>
        ) : <p className="text-xs text-ink-500">You have {MAX_TOKENS} tokens, the most allowed. Revoke one to make another.</p>}
        {err && <p role="alert" className="text-xs text-clay-600">{err}</p>}
      </div>
    </section>
  );
}
