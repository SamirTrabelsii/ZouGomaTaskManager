import { useRef } from 'react';
import { useStore } from '../state/store';

/** Shown when stored data can't be read. Nothing is overwritten until the user chooses. */
export function Recovery() {
  const err = useStore((s) => s.loadError);
  const raw = useStore((s) => s.corruptRaw);
  const st = useStore.getState();
  const backups = st.listBackups();
  const fileRef = useRef<HTMLInputElement>(null);
  const saveRaw = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([raw ?? ''], { type: 'text/plain' }));
    a.download = 'lifeos-unreadable-data.txt';
    a.click();
  };
  return (
    <div className="flex h-full items-center justify-center p-4">
      <div role="alert" className="w-full max-w-lg space-y-4 rounded-2xl border border-cream-300 bg-cream-50 p-6 shadow-soft">
        <h1 className="font-serif text-2xl font-semibold">We couldn't read your saved data</h1>
        <p className="text-sm text-ink-700">Nothing has been deleted. {err && <>Reason: <em>{err}</em></>}</p>
        {backups.length > 0 && (
          <div>
            <h2 className="label">Restore a backup</h2>
            <ul className="space-y-1">{backups.map((b) => (
              <li key={b.id} className="flex items-center justify-between rounded-lg bg-cream-100 px-2 py-1 text-sm">
                <span>{new Date(b.savedAt).toLocaleString()} · {b.reason}</span>
                <button className="btn" onClick={() => st.restoreFromCorruptBackup(b.id)}>Restore</button>
              </li>))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {raw && <button className="btn" onClick={saveRaw}>Download the unreadable data</button>}
          <button className="btn" onClick={() => fileRef.current?.click()}>Import a JSON export</button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" aria-label="Import data file" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            const text = await f.text();
            st.startFreshAfterCorrupt();
            st.importData(text);
          }} />
          <button className="btn btn-danger" onClick={() => { if (window.confirm('Start with an empty studio? The unreadable data is kept aside in this browser.')) st.startFreshAfterCorrupt(); }}>Start fresh</button>
        </div>
      </div>
    </div>
  );
}
