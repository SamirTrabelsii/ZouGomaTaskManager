import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { TEMPLATES } from '../domain/templates';
import type { Quality } from '../domain/types';
import { showSystemNotification } from '../state/notify';
import { currentSubscription, disablePush, enablePush, pushSupported, sendTestPush } from '../state/push';
import { ConfirmButton, Dialog, Segmented } from './common/ui';
import { FeedsSettings } from './FeedsSettings';

type Perm = NotificationPermission | 'unsupported';
const perm = (): Perm => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

export function Settings() {
  const data = useStore((s) => s.data);
  const st = useStore.getState();
  const [p, setP] = useState<Perm>(perm());
  const fileRef = useRef<HTMLInputElement>(null);
  const [backups, setBackups] = useState(() => st.listBackups());
  const { prefs } = data;
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const cloud = useStore((s) => s.cloud);
  const [cloudBackups, setCloudBackups] = useState<Awaited<ReturnType<typeof st.listCloudBackups>>>([]);
  useEffect(() => { void currentSubscription().then((s) => setPushOn(!!s)); }, []);
  useEffect(() => { if (cloud.enabled && cloud.status !== 'signedout') void st.listCloudBackups().then(setCloudBackups); }, [cloud.enabled, cloud.status, cloud.lastSyncedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return st.toast('This browser does not support notifications. In-app reminders still work.', 'error');
    const res = await Notification.requestPermission();
    setP(res);
    st.updatePrefs((x) => ({ ...x, notifications: { enabled: res === 'granted' } }));
    st.toast(res === 'granted' ? 'Browser notifications enabled' : 'Permission not granted — reminders will show inside the app.', res === 'granted' ? 'ok' : 'info');
  };
  const download = () => {
    const blob = new Blob([st.exportData()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lifeos-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const scene = (patch: Partial<typeof prefs.scene>) => st.updatePrefs((x) => ({ ...x, scene: { ...x.scene, ...patch } }));

  return (
    <Dialog title="Settings" onClose={() => st.toggleSettings(false)} wide>
      <div className="space-y-6">
        {cloud.enabled && (
          <section aria-labelledby="s-acct">
            <h3 id="s-acct" className="mb-1 font-semibold">Account &amp; sync</h3>
            <div className="card space-y-2 text-sm">
              <p>Signed in as <strong>{cloud.email ?? '—'}</strong>.{' '}
                {cloud.status === 'idle' && <>Everything is saved to your account{cloud.lastSyncedAt ? ` (last sync ${new Date(cloud.lastSyncedAt).toLocaleTimeString()})` : ''}.</>}
                {cloud.status === 'saving' && 'Saving…'}
                {cloud.status === 'offline' && 'The server can’t be reached. Your changes are kept on this device and will sync automatically.'}
                {cloud.status === 'signedout' && 'Your session ended. Sign in again to keep syncing.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <ConfirmButton className="btn" confirmLabel="Sign out of this device?" onConfirm={() => void st.signOut()}>Sign out</ConfirmButton>
              </div>
              <h4 className="label mt-2">Cloud backups</h4>
              {cloudBackups.length === 0 ? <p className="text-ink-500">The server keeps an hourly backup of your studio and before any overwrite.</p> : (
                <ul className="space-y-1">
                  {cloudBackups.map((b) => (
                    <li key={b.id} className="flex items-center justify-between rounded-lg bg-cream-100 px-2 py-1">
                      <span>{new Date(b.savedAt).toLocaleString()} <span className="text-xs text-ink-400">· {b.reason}</span></span>
                      <ConfirmButton className="btn text-xs" confirmLabel="Restore?" onConfirm={() => void st.restoreCloudBackup(b.id)}>Restore</ConfirmButton>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {cloud.enabled && cloud.status !== 'signedout' && <FeedsSettings />}

        <section aria-labelledby="s-tpl">
          <h3 id="s-tpl" className="mb-1 font-semibold">Templates</h3>
          <p className="mb-2 text-sm text-ink-500">Templates tune the same room and the same data. Turning one off never deletes anything.</p>
          <ul className="space-y-2">
            {TEMPLATES.map((t) => {
              const on = !!prefs.templates[t.id]?.enabled;
              return (
                <li key={t.id} className="card flex items-start gap-3">
                  <input id={`tpl-${t.id}`} type="checkbox" className="mt-1 h-4 w-4 accent-moss-600" checked={on} onChange={(e) => st.setTemplateEnabled(t.id, e.target.checked)} />
                  <label htmlFor={`tpl-${t.id}`} className="flex-1 text-sm">
                    <span className="font-medium">{t.name}</span> <span className="text-xs text-ink-400">v{t.version}</span>
                    <span className="block text-ink-500">{t.description}</span>
                  </label>
                  {on && t.starterHabits.length > 0 && (
                    <button className="btn text-xs" onClick={() => { const n = st.addTemplateStarters(t.id); st.toast(n ? `Added ${n} suggested habit${n > 1 ? 's' : ''}` : 'Suggestions already added', 'info'); }}>Add suggested habits</button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="s-rem">
          <h3 id="s-rem" className="mb-1 font-semibold">Reminders</h3>
          <div className="card space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span>Browser notifications: <strong>{p === 'unsupported' ? 'not supported' : p === 'granted' ? (prefs.notifications.enabled ? 'on' : 'allowed, but off') : p === 'denied' ? 'blocked' : 'not enabled'}</strong></span>
              {p === 'granted' ? (
                <button className="btn" onClick={() => st.updatePrefs((x) => ({ ...x, notifications: { enabled: !x.notifications.enabled } }))}>{prefs.notifications.enabled ? 'Turn off' : 'Turn on'}</button>
              ) : p === 'default' ? (
                <button className="btn btn-primary" onClick={enableNotifications}>Enable notifications</button>
              ) : null}
            </div>
            {p === 'denied' && <p className="text-ink-500">Notifications are blocked for this site. Allow them in your browser's site settings, then reload. Reminders still appear inside LifeOS.</p>}
            {p === 'unsupported' && <p className="text-ink-500">This browser can't show system notifications; reminders appear inside LifeOS instead.</p>}
            <div className="rounded-lg border border-cream-300 p-3" role="group" aria-label="Background reminders">
              <div className="flex items-center justify-between gap-2">
                <span><strong>Background reminders</strong> (push): <span className={pushOn ? 'text-moss-600' : ''}>{!cloud.enabled ? 'needs the LifeOS server' : !pushSupported() ? 'not supported here' : pushOn ? 'on for this device' : 'off'}</span></span>
                {cloud.enabled && pushSupported() && (
                  <button className={pushOn ? 'btn' : 'btn btn-primary'} disabled={pushBusy || pushOn === null} onClick={async () => {
                    setPushBusy(true);
                    const r = pushOn ? await disablePush() : await enablePush();
                    if (r.ok) { setPushOn(!pushOn); setP(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission); st.toast(pushOn ? 'Background reminders turned off for this device.' : 'Background reminders are on for this device.', 'ok'); }
                    else st.toast(r.error, 'error');
                    setPushBusy(false);
                  }}>{pushOn ? 'Turn off' : 'Turn on'}</button>
                )}
              </div>
              <p className="mt-1 text-xs text-ink-500">
                {cloud.enabled
                  ? 'Your LifeOS server sends each reminder to this device at its time, even if no LifeOS tab is open. Your browser still has to be running (on phones the system delivers it). Reminders missed by over 6 hours are not pushed.'
                  : 'Sign in to a LifeOS server (see the README) to get reminders while the app is closed.'}
              </p>
              {cloud.enabled && pushOn && (
                <button className="btn mt-2 text-xs" onClick={async () => {
                  const r = await sendTestPush();
                  st.toast(r.ok ? 'Test push sent. It should appear in a few seconds.' : `Test push failed: ${r.error}`, r.ok ? 'info' : 'error');
                }}>Send test push</button>
              )}
            </div>
            <p className="text-xs text-ink-500">
              Honest note: reminders are checked while LifeOS is open in a tab. If the browser is closed, nothing can fire until you return — you'll then see what was missed in the bell menu.
              Without the LifeOS server and background reminders turned on, nothing can fire while the browser is closed.
            </p>
            {p === 'granted' && prefs.notifications.enabled && (
              <button className="btn text-xs" onClick={async () => {
                const r = await showSystemNotification('LifeOS', 'Notifications are working.', 'lifeos-test');
                st.toast(r.ok ? 'Test notification sent. If you see no popup, check your operating system’s notification / Focus settings for this browser.' : `Could not send: ${r.error}`, r.ok ? 'info' : 'error');
              }}>Send test notification</button>
            )}
          </div>
        </section>

        <section aria-labelledby="s-scene">
          <h3 id="s-scene" className="mb-2 font-semibold">Room &amp; display</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><span className="label">Lighting</span><Segmented label="Lighting" value={prefs.scene.theme} onChange={(v) => scene({ theme: v })} options={[{ value: 'auto', label: '🕒 Auto' }, { value: 'day', label: '☀ Day' }, { value: 'evening', label: '🌙 Night' }]} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-moss-600" checked={prefs.scene.weather === 'rain'} onChange={(e) => scene({ weather: e.target.checked ? 'rain' : 'clear' })} /> Rain on the window</label>
            <div><span className="label">3D mode</span><Segmented label="3D mode" value={prefs.scene.mode} onChange={(v) => scene({ mode: v })} options={[{ value: 'auto', label: 'Auto' }, { value: '3d', label: '3D' }, { value: '2d', label: 'Simple 2D' }]} /></div>
            <div>
              <span className="label">Graphics quality</span>
              <select className="input" value={prefs.scene.quality} onChange={(e) => scene({ quality: e.target.value as Quality })} aria-label="Graphics quality">
                <option value="auto">Auto</option><option value="high">High</option><option value="balanced">Balanced</option><option value="low">Low (fastest)</option>
              </select>
            </div>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" className="h-4 w-4 accent-moss-600" checked={prefs.scene.reduceMotion} onChange={(e) => scene({ reduceMotion: e.target.checked })} /> Reduce motion (no sway, pulses or sparkles)</label>
          </div>
        </section>

        <section aria-labelledby="s-data">
          <h3 id="s-data" className="mb-1 font-semibold">Your data</h3>
          <p className="mb-2 text-sm text-ink-500">{cloud.enabled ? 'Your studio is saved to your account and cached in this browser. Export a copy any time.' : 'Everything is stored privately in this browser. Export a copy any time.'}</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={download}>⬇ Export JSON</button>
            <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Import JSON</button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-label="Import data file" onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = '';
              if (!f) return;
              if (!window.confirm('Importing replaces your current data (a backup is kept). Continue?')) return;
              if (st.importData(await f.text())) setBackups(st.listBackups());
            }} />
          </div>
          <h4 className="label mt-4">Automatic backups</h4>
          {backups.length === 0 ? <p className="text-sm text-ink-500">Backups are created automatically as you work and before imports or resets.</p> : (
            <ul className="space-y-1 text-sm">
              {backups.map((b) => (
                <li key={b.id} className="flex items-center justify-between rounded-lg bg-cream-100 px-2 py-1">
                  <span>{new Date(b.savedAt).toLocaleString()} <span className="text-xs text-ink-400">· {b.reason}</span></span>
                  <ConfirmButton className="btn text-xs" confirmLabel="Restore?" onConfirm={() => { st.restoreBackup(b.id); setBackups(st.listBackups()); }}>Restore</ConfirmButton>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex justify-end"><ConfirmButton confirmLabel="Erase everything?" onConfirm={() => { st.resetAll(); setBackups(st.listBackups()); }}>Erase all data…</ConfirmButton></div>
        </section>
      </div>
    </Dialog>
  );
}

