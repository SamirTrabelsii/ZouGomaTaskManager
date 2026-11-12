import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { cloud, ApiError } from '../data/cloud';
import type { AgentOverview } from '../domain/types';
import { ConfirmButton, Field } from './common/ui';
import { ago } from './FeedsSettings';

const MAX_TOKENS = 3;
type Token = AgentOverview['tokens'][number];
const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'Cannot reach the LifeOS server.');

/** Tokens for the LifeOS browser extension (the `extension/` folder of the repo). They open the task list and nothing else. */
export function ExtensionSettings() {
  const toast = useStore.getState().toast;
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    try { setTokens((await cloud.extensionTokens()).tokens); } catch { setTokens((t) => t ?? []); }
  };
  useEffect(() => { void load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr('Give the token a name, e.g. “Chrome at work”.');
    setBusy(true); setErr('');
    try {
      const t = await cloud.createExtensionToken(name.trim());
      setName(''); setFresh(t.token); await load();
    } catch (x) { setErr(messageOf(x)); } finally { setBusy(false); }
  };
  const copy = async (token: string) => {
    try { await navigator.clipboard.writeText(token); toast('Token copied'); } catch { toast('Couldn’t copy. Select the token and copy it by hand.', 'error'); }
  };
  const list = tokens ?? [];

  return (
    <section aria-labelledby="s-ext">
      <h3 id="s-ext" className="mb-1 font-semibold">Browser extension</h3>
      <p className="mb-2 text-sm text-ink-500">
        Your tasks one click away in Chrome or Edge: see what is due, tick tasks off, add one. The extension signs in with a token below,
        which opens your task list and nothing else (no notes, journal, alerts or absences).
      </p>
      <div className="card space-y-3 text-sm">
        {tokens === null ? <p className="text-ink-500">Loading…</p> : list.length === 0 ? (
          <p className="text-ink-500">No extension connected yet. Create a token, then paste it into the extension’s setup screen.</p>
        ) : (
          <ul className="space-y-2" aria-label="Extension tokens">
            {list.map((t) => (
              <li key={t.id} className="flex items-center gap-2 rounded-lg bg-cream-100 p-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.name} <span className="font-mono text-xs text-ink-400">…{t.hint}</span></div>
                  <div className="truncate text-xs text-ink-500">created {ago(t.createdAt)} · {t.lastUsedAt ? `last used ${ago(t.lastUsedAt)}` : 'never used'}</div>
                </div>
                <ConfirmButton className="btn btn-ghost text-xs text-clay-600" confirmLabel="Revoke?" onConfirm={async () => {
                  try { await cloud.revokeExtensionToken(t.id); await load(); toast(`Revoked “${t.name}”`); } catch (x) { toast(messageOf(x), 'error'); }
                }}>Revoke</ConfirmButton>
              </li>
            ))}
          </ul>
        )}

        {fresh && (
          <div role="alert" className="space-y-2 rounded-lg border border-moss-600/40 bg-moss-600/10 p-3">
            <p className="font-medium">Copy this token now: it won’t be shown again.</p>
            <div className="flex gap-2">
              <input className="input font-mono text-xs" readOnly value={fresh} aria-label="New extension token" onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="btn" onClick={() => void copy(fresh)}>Copy</button>
            </div>
            <p className="text-xs text-ink-500">
              In the extension, enter the server <code>{window.location.origin}</code> and this token. Lost the browser or the token? Revoke it here.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => setFresh(null)}>I’ve saved it</button>
          </div>
        )}

        {list.length < MAX_TOKENS ? (
          <form className="flex flex-wrap items-end gap-2" onSubmit={create}>
            <Field label="New token" className="min-w-[10rem] flex-1">
              <input className="input" value={name} maxLength={40} placeholder="Chrome at work" onChange={(e) => { setName(e.target.value); setErr(''); }} />
            </Field>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : '＋ Create token'}</button>
          </form>
        ) : <p className="text-xs text-ink-500">You have {MAX_TOKENS} tokens, the most allowed. Revoke one to make another.</p>}
        {err && <p role="alert" className="text-xs text-clay-600">{err}</p>}
      </div>
    </section>
  );
}
