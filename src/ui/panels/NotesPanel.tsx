import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { useToday } from '../../state/hooks';
import { formatDay, isoToDay, startOfWeek, addDays } from '../../domain/dates';
import { weeklySummary } from '../../domain/services';
import { resolveTemplates } from '../../domain/templates';
import type { Note, NoteKind } from '../../domain/types';
import { ConfirmButton, EmptyState, Field } from '../common/ui';
import { PanelShell } from './PanelShell';

export const KIND_META: Record<NoteKind, { label: string; icon: string }> = {
  note: { label: 'Note', icon: '📝' }, idea: { label: 'Idea', icon: '💡' }, journal: { label: 'Journal', icon: '📔' },
  reflection: { label: 'Reflection', icon: '🌙' }, review: { label: 'Weekly review', icon: '🗒️' }, lesson: { label: 'Lesson', icon: '🎓' },
};

export function NotesPanel() {
  const { notes, prefs } = useStore((s) => s.data);
  const focus = useStore((s) => s.focus);
  const st = useStore.getState();
  const today = useToday();
  const cfg = resolveTemplates(prefs.templates);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | NoteKind>('all');
  const [tag, setTag] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [quick, setQuick] = useState('');
  useEffect(() => { if (focus?.type === 'note') setOpenId(focus.id); }, [focus]);

  const kinds = useMemo(() => {
    const s = new Set<NoteKind>(cfg.noteKinds);
    notes.forEach((n) => s.add(n.kind)); // never hide kinds that already hold notes
    return [...s];
  }, [cfg.noteKinds, notes]);
  const tags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags))].sort(), [notes]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return notes
      .filter((n) => (kind === 'all' || n.kind === kind) && (!tag || n.tags.includes(tag)) &&
        (!needle || n.title.toLowerCase().includes(needle) || n.body.toLowerCase().includes(needle) || n.tags.some((t) => t.includes(needle))))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  }, [notes, q, kind, tag]);

  if (openId && notes.some((n) => n.id === openId)) return <Editor id={openId} onBack={() => setOpenId(null)} kinds={kinds} />;

  const reflection = () => {
    const title = `Reflection — ${formatDay(today, true)}`;
    const ex = notes.find((n) => n.kind === 'reflection' && n.title === title);
    if (ex) return setOpenId(ex.id);
    const n = st.addNote({ kind: 'reflection', title, body: 'What went well today?\n\nWhat did I learn?\n\nWhat will I do differently tomorrow?\n' });
    setOpenId(n.id);
  };
  const review = () => {
    const ws = startOfWeek(today);
    const title = `Weekly review — week of ${formatDay(ws)}`;
    const ex = notes.find((n) => n.kind === 'review' && n.title === title);
    if (ex) return setOpenId(ex.id);
    const s = weeklySummary(useStore.getState().data, ws);
    const body = [
      `${formatDay(ws)} – ${formatDay(addDays(ws, 6))}`, '',
      `• Tasks completed: ${s.tasksCompleted} (${s.tasksCreated} added, ${s.tasksOpen} still open)`,
      `• Habit check-ins: ${s.habitLogs}`, `• Milestones reached: ${s.milestonesDone}`, `• Events: ${s.eventsCount}`, '',
      'Highlights:\n', 'What I learned:\n', 'What to adjust next week:\n',
    ].join('\n');
    setOpenId(st.addNote({ kind: 'review', title, body }).id);
  };

  return (
    <PanelShell title="Notebook" icon="📓" subtitle={`${notes.length} entr${notes.length === 1 ? 'y' : 'ies'}`}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (quick.trim()) { st.addNote({ title: quick.trim().slice(0, 60), body: quick.trim().length > 60 ? quick.trim() : '' }); setQuick(''); st.toast('Note saved'); } }}>
        <input className="input" placeholder="Quick note — press Enter" aria-label="Quick note" value={quick} onChange={(e) => setQuick(e.target.value)} />
        <button className="btn btn-primary" disabled={!quick.trim()}>Save</button>
      </form>
      <div className="grid grid-cols-3 gap-2">
        <button className="btn" onClick={() => setOpenId(st.addNote({ title: '' }).id)}>＋ Note</button>
        <button className="btn" onClick={reflection}>🌙 Reflect</button>
        <button className="btn" onClick={review}>🗒️ Review</button>
      </div>
      <div className="space-y-2">
        <input className="input" type="search" placeholder="Search notes…" aria-label="Search notes" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by kind">
          {(['all', ...kinds] as const).map((k) => (
            <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}
              className={`chip transition ${kind === k ? '!border-moss-600 !bg-moss-600 text-white' : 'hover:bg-cream-200'}`}>
              {k === 'all' ? 'All' : `${KIND_META[k].icon} ${KIND_META[k].label}`}
            </button>
          ))}
        </div>
        {tags.length > 0 && (
          <select className="input" aria-label="Filter by tag" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">All tags</option>{tags.map((t) => <option key={t} value={t}>#{t}</option>)}
          </select>
        )}
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon="📓" title={notes.length ? 'No notes match' : 'Your notebook is empty'} hint={notes.length ? 'Try a different search or filter.' : 'Capture an idea, write a reflection, or start a weekly review.'} />
      ) : (
        <ul className="space-y-1.5">
          {filtered.map((n) => (
            <li key={n.id}>
              <button className="card w-full text-left transition hover:border-moss-500" onClick={() => setOpenId(n.id)}>
                <div className="flex items-center gap-2">
                  <span aria-hidden>{KIND_META[n.kind].icon}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{n.title || 'Untitled'}</span>
                  {n.pinned && <span title="Pinned" aria-label="Pinned">📌</span>}
                </div>
                {n.body && <p className="mt-1 line-clamp-2 text-xs text-ink-500">{n.body}</p>}
                <div className="mt-1 text-[11px] text-ink-400">{KIND_META[n.kind].label} · {formatDay(isoToDay(n.updatedAt))}{n.tags.length > 0 && ` · ${n.tags.map((t) => '#' + t).join(' ')}`}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}

function Editor({ id, onBack, kinds }: { id: string; onBack: () => void; kinds: NoteKind[] }) {
  const n = useStore((s) => s.data.notes.find((x) => x.id === id)) as Note;
  const st = useStore.getState();
  const [tagText, setTagText] = useState(n.tags.join(', '));
  const allKinds = kinds.includes(n.kind) ? kinds : [...kinds, n.kind];
  return (
    <PanelShell title={n.title || 'Untitled'} icon={KIND_META[n.kind].icon} subtitle="Saved automatically"
      actions={<button className="btn btn-ghost px-2" aria-label={n.pinned ? 'Unpin note' : 'Pin note'} aria-pressed={n.pinned} onClick={() => st.updateNote(id, { pinned: !n.pinned })}>{n.pinned ? '📌' : '📍'}</button>}>
      <button className="text-sm text-sky-500 underline" onClick={onBack}>← All notes</button>
      <Field label="Title"><input className="input" value={n.title} onChange={(e) => st.updateNote(id, { title: e.target.value })} placeholder="Untitled" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind"><select className="input" value={n.kind} onChange={(e) => st.updateNote(id, { kind: e.target.value as NoteKind })}>{allKinds.map((k) => <option key={k} value={k}>{KIND_META[k].icon} {KIND_META[k].label}</option>)}</select></Field>
        <Field label="Tags"><input className="input" placeholder="comma, separated" value={tagText} onChange={(e) => { setTagText(e.target.value); st.updateNote(id, { tags: e.target.value.split(',').map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean) }); }} /></Field>
      </div>
      <Field label="Body"><textarea className="input min-h-[240px] font-serif leading-relaxed" value={n.body} onChange={(e) => st.updateNote(id, { body: e.target.value })} /></Field>
      <div className="flex justify-between"><button className="btn" onClick={onBack}>Done</button><ConfirmButton confirmLabel="Delete note?" onConfirm={() => { st.deleteNote(id); onBack(); }}>Delete</ConfirmButton></div>
    </PanelShell>
  );
}
