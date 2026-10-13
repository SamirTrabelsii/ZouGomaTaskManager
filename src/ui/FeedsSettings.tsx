import { useState } from 'react';
import { useStore } from '../state/store';
import { useFeeds } from '../state/feeds';
import type { CalendarFeed } from '../domain/types';
import { ConfirmButton, Field } from './common/ui';

export const FEED_COLORS = ['#4f7f9c', '#c06c46', '#628a52', '#8b6bb1', '#d4a84b', '#c0506a', '#3f8f8a'];

function Swatches({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {FEED_COLORS.map((c) => (
        <button
          key={c} type="button" role="radio" aria-checked={value === c} aria-label={c}
          onClick={() => onChange(c)}
          className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-cream-50 ${value === c ? 'ring-2 ring-ink-700' : 'ring-1 ring-black/10'}`}
          style={{ background: c }}
        />
      ))}
      <input type="color" aria-label="Custom colour" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
    </div>
  );
}

/** The first preset colour no connected calendar uses yet (so a new calendar looks different from the others). */
export const nextColor = (feeds: Pick<CalendarFeed, 'color'>[]) =>
  FEED_COLORS.find((c) => !feeds.some((f) => f.color.toLowerCase() === c)) ?? FEED_COLORS[feeds.length % FEED_COLORS.length];

const ago = (iso: string | null) => {
  if (!iso) return 'not yet';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function FeedRow({ feed }: { feed: CalendarFeed }) {
  const { update, remove, refreshOne } = useFeeds.getState();
  const toast = useStore.getState().toast;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(feed.name);
  const [color, setColor] = useState(feed.color);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const run = async (fn: () => Promise<string | null>, ok?: string) => {
    setBusy(true); setErr('');
    const e = await fn();
    setBusy(false);
    if (e) setErr(e); else if (ok) toast(ok);
    return !e;
  };

  return (
    <li className="rounded-lg bg-cream-100 p-2">
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: feed.color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{feed.name}</div>
          <div className="truncate text-xs text-ink-500">
            {feed.host} · {feed.eventCount} meeting{feed.eventCount === 1 ? '' : 's'} · updated {ago(feed.lastSyncAt)}
          </div>
        </div>
        <button className="btn text-xs" disabled={busy} onClick={() => void run(() => refreshOne(feed.id), 'Calendar updated')}>{busy ? '…' : 'Update now'}</button>
        <button className="btn btn-ghost text-xs" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>Edit</button>
        <ConfirmButton className="btn btn-ghost text-xs text-clay-600" confirmLabel="Remove?" onConfirm={() => void run(() => remove(feed.id), `Removed “${feed.name}”`)}>Remove</ConfirmButton>
      </div>
      {(feed.lastError || err) && <p role="alert" className="mt-1 text-xs text-clay-600">{err || `Couldn’t update: ${feed.lastError} The meetings below are the last ones we could read.`}</p>}
      {feed.warnings.length > 0 && <p className="mt-1 text-xs text-ink-500">Note: {feed.warnings[0]}</p>}
      {editing && (
        <form className="mt-2 space-y-2 border-t border-cream-300 pt-2" onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => update(feed.id, { name: name.trim(), color }), 'Calendar saved')) setEditing(false);
        }}>
          <Field label="Name"><input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></Field>
          <div><span className="label">Colour</span><Swatches label={`Colour for ${feed.name}`} value={color} onChange={setColor} /></div>
          <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => { setEditing(false); setName(feed.name); setColor(feed.color); }}>Cancel</button><button className="btn btn-primary" disabled={busy || !name.trim()}>Save</button></div>
        </form>
      )}
    </li>
  );
}

function AddFeed() {
  const add = useFeeds((s) => s.add);
  const toast = useStore.getState().toast;
  const [f, setF] = useState(() => ({ name: '', url: '', color: nextColor(useFeeds.getState().feeds) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <form className="space-y-2 rounded-lg border border-cream-300 p-3" onSubmit={async (e) => {
      e.preventDefault();
      if (!f.name.trim()) return setErr('Give the calendar a name, e.g. “Work”.');
      if (!f.url.trim()) return setErr('Paste the calendar’s iCal link.');
      setBusy(true); setErr('');
      const error = await add({ name: f.name.trim(), url: f.url.trim(), color: f.color });
      setBusy(false);
      if (error) return setErr(error);
      toast(`Connected “${f.name.trim()}”`);
      setF({ name: '', url: '', color: nextColor(useFeeds.getState().feeds) }); // the store already includes the calendar just added
    }}>
      <h4 className="font-medium">Add a calendar</h4>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Field label="Name"><input className="input" value={f.name} maxLength={60} onChange={(e) => { setF({ ...f, name: e.target.value }); setErr(''); }} placeholder="Work" /></Field>
        <div><span className="label">Colour</span><Swatches label="Colour for the new calendar" value={f.color} onChange={(color) => setF({ ...f, color })} /></div>
      </div>
      <Field label="iCal link">
        <input className="input" value={f.url} autoComplete="off" spellCheck={false} onChange={(e) => { setF({ ...f, url: e.target.value }); setErr(''); }} placeholder="https://calendar.google.com/…/basic.ics  or  webcal://…" />
      </Field>
      {err && <p role="alert" className="text-xs text-clay-600">{err}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Checking the link…' : '＋ Connect calendar'}</button>
      <details className="text-xs text-ink-500">
        <summary className="cursor-pointer">Where do I find the link?</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li><strong>Google Calendar:</strong> Settings → pick the calendar → <em>Integrate calendar</em> → copy <em>Secret address in iCal format</em>.</li>
          <li><strong>Outlook / Microsoft 365:</strong> Settings → Calendar → <em>Shared calendars</em> → <em>Publish a calendar</em> → choose the calendar and “Can view all details” → copy the <em>ICS</em> link.</li>
        </ul>
        <p className="mt-1">Anyone who has this link can read that calendar, so treat it like a password. LifeOS keeps it on your server only and never shows it again.</p>
      </details>
    </form>
  );
}

export function FeedsSettings() {
  const feeds = useFeeds((s) => s.feeds);
  const stale = useFeeds((s) => s.stale);
  return (
    <section aria-labelledby="s-feeds">
      <h3 id="s-feeds" className="mb-1 font-semibold">Calendar feeds</h3>
      <p className="mb-2 text-sm text-ink-500">Show meetings from Google Calendar, Outlook and other iCal calendars alongside your own events. They are read-only, kept apart from your events, and refreshed about every 15 minutes.</p>
      <div className="card space-y-3 text-sm">
        {stale && <p role="status" className="text-xs text-ink-500">Can’t reach the server right now — showing the last list we have.</p>}
        {feeds.length === 0 ? <p className="text-ink-500">No calendars connected yet.</p> : <ul className="space-y-2">{feeds.map((f) => <FeedRow key={f.id} feed={f} />)}</ul>}
        {feeds.length < 10 ? <AddFeed /> : <p className="text-xs text-ink-500">You’ve reached the limit of 10 calendars.</p>}
      </div>
    </section>
  );
}
