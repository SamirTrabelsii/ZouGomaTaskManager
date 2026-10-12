import { useStore } from '../state/store';
import { Dialog } from './common/ui';

const LABEL = {
  idle: { icon: '☁️', text: 'Saved to your account' },
  saving: { icon: '⟳', text: 'Saving…' },
  offline: { icon: '⚠️', text: 'Offline — changes are safe on this device and will sync when the server is back' },
  conflict: { icon: '⚠️', text: 'Needs your decision — two versions exist' },
  signedout: { icon: '🔒', text: 'Signed out — sign in again to keep syncing' },
} as const;

/** Small header chip; only exists when a server is in use. */
export function SyncChip() {
  const cloud = useStore((s) => s.cloud);
  if (!cloud.enabled) return null;
  const l = LABEL[cloud.status];
  const attention = cloud.status === 'offline' || cloud.status === 'conflict' || cloud.status === 'signedout';
  return (
    <button
      className={`btn btn-ghost px-2 text-xs ${attention ? 'text-clay-500' : ''}`}
      title={l.text} aria-label={`Sync: ${l.text}`}
      onClick={() => {
        const st = useStore.getState();
        if (cloud.status === 'signedout') useStore.setState({ status: 'signin' });
        else st.toggleSettings(true);
      }}
    >
      <span aria-hidden className={cloud.status === 'saving' ? 'inline-block animate-spin' : ''}>{l.icon}</span>
    </button>
  );
}

/** Blocks until the user chooses which copy to keep. Nothing is overwritten without a backup. */
export function ConflictDialog() {
  const conflict = useStore((s) => s.cloud.conflict);
  const mine = useStore((s) => s.data);
  const resolve = useStore((s) => s.resolveConflict);
  if (!conflict) return null;
  const sum = (d: typeof mine) => `${d.tasks.length} tasks, ${d.projects.length} projects, ${d.habits.length} habits, ${d.notes.length} notes`;
  return (
    <Dialog title="Two versions of your studio" onClose={() => { /* must choose */ }}>
      <div className="space-y-3 text-sm">
        <p>This device and your account both changed since they last matched. Choose which one to keep. The other is saved as a backup first, so nothing is lost.</p>
        <div className="card"><strong>This device</strong><br /><span className="text-ink-500">{sum(mine)}</span></div>
        <div className="card"><strong>Your account (cloud)</strong><br /><span className="text-ink-500">{sum(conflict.data)}</span></div>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn" onClick={() => void resolve('server')}>Use the cloud version</button>
          <button className="btn btn-primary" onClick={() => void resolve('mine')}>Keep this device’s version</button>
        </div>
      </div>
    </Dialog>
  );
}
