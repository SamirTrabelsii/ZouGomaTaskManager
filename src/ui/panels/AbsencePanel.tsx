import { useEffect, useMemo, useState } from 'react';
import { PanelShell, Section, Tabs } from './PanelShell';
import { useAbsences } from '../../state/absences';
import { useToday } from '../../state/hooks';
import {
  ABSENCE_STEPS, STEP_LABELS, EMPTY_SETTINGS, absenceMails, addRange, cycleDay, dayCount, defaultSteps, describeDays, isWeekend, monthGrid,
  type Absence, type AbsenceDay, type AbsenceSettings, type AbsenceStep, type AbsenceStepState,
} from '../../domain/absence';

type Tab = 'book' | 'history' | 'settings';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PART_TEXT = { full: 'whole day', am: 'morning', pm: 'afternoon' } as const;

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export function AbsencePanel() {
  const list = useAbsences((s) => s.list);
  const [tab, setTab] = useState<Tab>('book');
  useEffect(() => {
    const st = useAbsences.getState();
    void st.sync(); void st.loadSettings();
    const id = setInterval(() => void useAbsences.getState().sync(), 10_000); // faster while the panel is open
    return () => clearInterval(id);
  }, []);
  const failed = list?.absences.flatMap((a) => a.steps).filter((s) => s.status === 'failed').length ?? 0;
  const exec = list?.executor;
  const listening = list?.executors.filter((e) => e.online).map((e) => e.name) ?? [];
  return (
    <PanelShell
      title="Absences" icon="🌴"
      subtitle={!exec ? 'Loading…' : exec.online ? `${listening.join(' and ')} listening` : `No executor connected · last seen ${ago(exec.lastSeenAt)}`}
    >
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'book', label: 'Book' },
        { id: 'history', label: failed ? `History ⚠` : 'History', count: list?.absences.length },
        { id: 'settings', label: 'Settings' },
      ]} />
      {tab === 'book' && <BookTab onBooked={() => setTab('history')} />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'settings' && <SettingsTab />}
    </PanelShell>
  );
}

/* ── booking ── */

function DayCell({ date, part, disabled, today, onClick }: { date: string; part: AbsenceDay['part'] | null; disabled: boolean; today: boolean; onClick: () => void }) {
  const day = Number(date.slice(8));
  const fill = '#4f7a52';
  const bg = part === 'full' ? fill : part === 'am' ? `linear-gradient(to bottom, ${fill} 50%, transparent 50%)` : part === 'pm' ? `linear-gradient(to bottom, transparent 50%, ${fill} 50%)` : undefined;
  return (
    <button
      type="button" disabled={disabled} onClick={onClick}
      aria-label={`${date}${part ? `, ${PART_TEXT[part]}` : ''}`} aria-pressed={!!part}
      title={part ? PART_TEXT[part] : undefined}
      style={{ background: bg }}
      className={`relative h-9 rounded-md border text-sm transition ${disabled ? 'cursor-not-allowed border-transparent text-ink-300' : 'border-cream-300 hover:border-moss-500'} ${part === 'full' ? 'font-semibold text-white' : ''} ${today ? 'ring-1 ring-clay-400' : ''}`}
    >
      <span className={part === 'am' || part === 'pm' ? 'rounded bg-cream-50/90 px-1 text-ink-900' : ''}>{day}</span>
    </button>
  );
}

function MailPreview({ label, via, to, cc, subject, lines }: { label: string; via: string; to: string[]; cc: string[]; subject: string; lines: string[] }) {
  return (
    <details className="rounded-lg border border-cream-300 bg-cream-100 p-2 text-sm">
      <summary className="cursor-pointer font-medium">{label} <span className="text-xs text-ink-500">· {via}</span></summary>
      <div className="mt-2 space-y-0.5 text-xs text-ink-500">
        <div><b>To</b> {to.join(', ') || <i className="text-clay-600">nobody yet (Settings)</i>}</div>
        {cc.length > 0 && <div><b>Cc</b> {cc.join(', ')}</div>}
        <div><b>Subject</b> {subject}</div>
      </div>
      <div className="mt-2 whitespace-pre-wrap rounded-md bg-cream-50 p-2 leading-relaxed">{lines.join('\n')}</div>
      <p className="mt-1 text-[11px] text-ink-500">+ your signature</p>
    </details>
  );
}

function BookTab({ onBooked }: { onBooked: () => void }) {
  const today = useToday();
  const list = useAbsences((s) => s.list);
  const settings = useAbsences((s) => s.settings) ?? EMPTY_SETTINGS;
  const book = useAbsences((s) => s.book);
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [days, setDays] = useState<AbsenceDay[]>([]);
  const [mode, setMode] = useState<'day' | 'range'>('day');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [steps, setSteps] = useState<AbsenceStep[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = steps ?? defaultSteps(list?.executor ?? null);
  const booked = useMemo(() => new Set(list?.absences.filter((a) => !a.cancelled).flatMap((a) => a.days.map((d) => d.date)) ?? []), [list]);
  const weeks = monthGrid(cursor.y, cursor.m);
  const mails = days.length ? absenceMails(days, settings) : [];
  const handled = new Set(list?.executor.kinds ?? []);

  const move = (delta: number) => setCursor(({ y, m }) => { const t = y * 12 + m + delta; return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 }; });
  const pick = (date: string) => {
    setConfirm(false); setError(null);
    if (mode === 'day') return setDays((d) => cycleDay(d, date));
    if (!anchor) { setAnchor(date); setDays((d) => addRange(d, date, date)); return; }
    setDays((d) => addRange(d, anchor, date));
    setAnchor(null);
  };
  const toggleStep = (k: AbsenceStep) => { setConfirm(false); setSteps(chosen.includes(k) ? chosen.filter((s) => s !== k) : ABSENCE_STEPS.filter((s) => s === k || chosen.includes(s))); };

  const submit = async () => {
    if (!confirm) { setConfirm(true); return; }
    setBusy(true);
    const err = await book(days, chosen, 'CP');
    setBusy(false);
    if (err) { setError(err); setConfirm(false); return; }
    setDays([]); setConfirm(false); onBooked();
  };

  return (
    <div className="space-y-4">
      <Section title="Days" right={
        <div className="flex gap-1">
          {(['day', 'range'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); setAnchor(null); }}
              className={`chip ${mode === m ? '!border-moss-600 !bg-moss-600 !text-white' : ''}`}>{m === 'day' ? 'Day by day' : 'Range'}</button>
          ))}
        </div>
      }>
        <div className="mb-1 flex items-center justify-between">
          <button type="button" className="btn btn-ghost px-2" onClick={() => move(-1)} aria-label="Previous month">‹</button>
          <span className="font-serif font-semibold">{MONTHS[cursor.m]} {cursor.y}</span>
          <button type="button" className="btn btn-ghost px-2" onClick={() => move(1)} aria-label="Next month">›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-500">{WEEKDAYS.map((w) => <div key={w}>{w}</div>)}</div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {weeks.flat().map((date, i) => date === null ? <div key={`b${i}`} /> : (
            <DayCell key={date} date={date} today={date === today}
              part={days.find((d) => d.date === date)?.part ?? null}
              disabled={isWeekend(date) || date < today || booked.has(date)}
              onClick={() => pick(date)} />
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-500">
          {mode === 'day' ? 'Click a day: whole day → morning → afternoon → off.' : anchor ? `From ${anchor}: now click the last day.` : 'Click the first day, then the last one. Weekends are skipped.'}
        </p>
      </Section>

      {days.length > 0 && (
        <>
          <div className="card text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>Absent <b>{describeDays(days)}</b></div>
              <button type="button" className="btn btn-ghost shrink-0 text-xs" onClick={() => { setDays([]); setAnchor(null); setConfirm(false); }}>Clear</button>
            </div>
            <div className="mt-0.5 text-xs text-ink-500">{dayCount(days)} day{dayCount(days) === 1 ? '' : 's'} of paid leave (CP in Boond)</div>
          </div>

          <Section title="What to do">
            <div className="space-y-1">
              {ABSENCE_STEPS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={chosen.includes(k)} onChange={() => toggleStep(k)} />
                  <span>{STEP_LABELS[k]}</span>
                  {list && list.executor.kinds.length > 0 && !handled.has(k) && <span className="text-[11px] text-ink-400">· not automated yet</span>}
                </label>
              ))}
            </div>
          </Section>

          {mails.some((m) => chosen.includes(m.key === 'employer' ? 'mail_employer' : 'mail_client')) && (
            <Section title="Mails">
              <div className="space-y-2">
                {mails.filter((m) => chosen.includes(m.key === 'employer' ? 'mail_employer' : 'mail_client')).map((m) => (
                  <MailPreview key={m.key} to={m.to} cc={m.cc} subject={m.subject} lines={m.lines}
                    label={`To ${m.label}`} via={m.via === 'outlook' ? 'from Outlook' : 'from Gmail'} />
                ))}
              </div>
            </Section>
          )}

          {error && <p role="alert" className="text-sm text-clay-600">{error}</p>}
          {!list?.executor.online && <p className="text-xs text-ink-500">No executor is connected right now (is the PC on?): the actions will wait and run as soon as one polls.</p>}
          <button type="button" className={`btn w-full ${confirm ? 'btn-danger' : 'btn-primary'}`} disabled={busy || chosen.length === 0} onClick={submit}>
            {busy ? 'Booking…' : confirm ? `Confirm: ${chosen.length} action${chosen.length === 1 ? '' : 's'}, mails go out` : 'Book this absence'}
          </button>
        </>
      )}
    </div>
  );
}

/* ── history ── */

const STATUS_ICON: Record<AbsenceStepState['status'], string> = { pending: '⏳', running: '⚙️', done: '✅', failed: '⚠️', skipped: '—' };

function AbsenceCard({ a }: { a: Absence }) {
  const { cancel, remove, retry } = useAbsences.getState();
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<string | null>) => setError(await fn());
  const untouched = a.steps.every((s) => s.status === 'pending');
  const settled = a.steps.every((s) => s.status !== 'pending' && s.status !== 'running');
  return (
    <li className="space-y-2 rounded-lg border border-cream-300 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className={`text-sm font-medium ${a.cancelled ? 'text-ink-400 line-through' : ''}`}>{a.label}</div>
        <div className="flex shrink-0 gap-1">
          {!a.cancelled && untouched && <button type="button" className="btn btn-ghost text-xs" onClick={() => run(() => cancel(a.id))}>Cancel</button>}
          {settled && <button type="button" className="btn btn-ghost text-xs text-clay-600" onClick={() => run(() => remove(a.id))}>Delete</button>}
        </div>
      </div>
      <ul className="space-y-1">
        {a.steps.map((s) => (
          <li key={s.id} className="flex items-start gap-2 text-sm">
            <span aria-hidden className="w-5 shrink-0 text-center">{STATUS_ICON[s.status]}</span>
            <div className="min-w-0 flex-1">
              <div>{STEP_LABELS[s.kind] ?? s.kind} <span className="sr-only">({s.status})</span></div>
              {s.detail && <div className="text-xs text-ink-500">{s.detail}</div>}
            </div>
            {(s.status === 'failed' || (s.status === 'skipped' && !a.cancelled)) && (
              <button type="button" className="btn btn-ghost shrink-0 text-xs" onClick={() => run(() => retry(s.id))}>Retry</button>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-xs text-clay-600">{error}</p>}
    </li>
  );
}

function HistoryTab() {
  const list = useAbsences((s) => s.list);
  if (!list) return <p className="text-sm text-ink-500">Loading…</p>;
  if (!list.absences.length) return <p className="text-sm text-ink-500">No absence booked yet.</p>;
  return <ul className="space-y-2">{list.absences.map((a) => <AbsenceCard key={a.id} a={a} />)}</ul>;
}

/* ── settings ── */

const splitList = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

function SettingsTab() {
  const saved = useAbsences((s) => s.settings);
  const list = useAbsences((s) => s.list);
  const save = useAbsences((s) => s.saveSettings);
  const [form, setForm] = useState(() => toForm(saved ?? EMPTY_SETTINGS));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (saved) setForm(toForm(saved)); }, [saved]);

  const field = (key: keyof typeof form, label: string, placeholder: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" value={form[key]} placeholder={placeholder} onChange={(e) => { setForm({ ...form, [key]: e.target.value }); setMsg(null); }} />
    </label>
  );
  const submit = async () => {
    const s: AbsenceSettings = {
      employer: { to: splitList(form.employerTo), cc: splitList(form.employerCc) },
      client: { to: splitList(form.clientTo), cc: splitList(form.clientCc) },
      planningName: form.planningName.trim(),
    };
    const err = await save(s);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: 'Saved.' });
  };

  return (
    <div className="space-y-4">
      <Section title="Mail to Olivesoft (Outlook)">
        <div className="space-y-2">{field('employerTo', 'To', 'name@olivesoft.fr')}{field('employerCc', 'Cc', 'separate with commas')}</div>
      </Section>
      <Section title="Mail to Skill and You (Gmail)">
        <div className="space-y-2">{field('clientTo', 'To', 'name@skillandyou.com')}{field('clientCc', 'Cc', 'separate with commas')}</div>
      </Section>
      <Section title="Team planning">
        {field('planningName', 'Your name in the workbook', 'exactly as in the Name column')}
      </Section>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-moss-600' : 'text-clay-600'}`}>{msg.text}</p>}
      <button type="button" className="btn btn-primary w-full" onClick={submit}>Save settings</button>
      <Section title="Executor">
        <p className="mb-2 text-xs text-ink-500">
          The actions run on your PC: n8n and the local agent each ask LifeOS for the steps they know, about every minute,
          with their own agent token (Settings → Agent → new token).
        </p>
        {list?.executors.length ? (
          <ul className="space-y-1.5">
            {list.executors.map((e) => (
              <li key={e.name} className="rounded-lg bg-cream-100 p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <b>{e.name}</b>
                  <span className={`text-xs ${e.online ? 'text-moss-600' : 'text-ink-500'}`}>{e.online ? 'listening' : `seen ${ago(e.lastSeenAt)}`}</span>
                </div>
                <div className="text-xs text-ink-500">{e.kinds.map((k) => STEP_LABELS[k] ?? k).join(' · ')}</div>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-ink-500">No executor has connected yet.</p>}
      </Section>
    </div>
  );
}

function toForm(s: AbsenceSettings) {
  return {
    employerTo: s.employer.to.join(', '), employerCc: s.employer.cc.join(', '),
    clientTo: s.client.to.join(', '), clientCc: s.client.cc.join(', '),
    planningName: s.planningName,
  };
}
