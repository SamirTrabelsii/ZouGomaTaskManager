import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import { useAgent } from '../../state/agent';
import { CATEGORY_LABEL, SEVERITY_LABEL, STATUS_LABEL, TICKET_SCOPE, VERDICT_LABEL, analysisOf, findTicket, findTicketScope, ticketNotes, ticketTitle, isOpen, readFindings, relativeTime, unseenAlerts, type Analysis } from '../../domain/agent';
import type { AgentAlert, AgentAlertDetail, AgentCommand, AgentCommandKind, AgentPatch, AlertSeverity } from '../../domain/types';
import { ConfirmButton, EmptyState } from '../common/ui';
import { PanelShell, Section } from './PanelShell';

const REFRESH_MS = 20_000;
const SEVERITY_CLASS: Record<AlertSeverity, string> = {
  critical: 'bg-clay-500 text-white', high: 'bg-clay-500/20 text-clay-600', medium: 'bg-ink-900/10 text-ink-700', low: 'bg-moss-600/15 text-moss-600',
};
const ORDER_LABEL: Record<AgentCommandKind, string> = { investigate: 'Investigate', ignore: 'Ignore', reanalyze: 'Re-analyze', pause: 'Pause', resume: 'Resume' };
const ORDER_STATUS: Record<AgentCommand['status'], string> = {
  pending: 'waiting for the agent', acked: 'in progress', done: 'done', failed: 'failed', expired: 'expired', cancelled: 'cancelled',
};

const toast = (text: string, kind: 'ok' | 'error' = 'ok') => useStore.getState().toast(text, kind);
async function copy(text: string, what: string) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toast('Couldn’t copy. Select the text and copy it by hand.', 'error'); }
}

function Severity({ value }: { value: AlertSeverity }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${SEVERITY_CLASS[value]}`}>{SEVERITY_LABEL[value]}</span>;
}

const meta = (a: Pick<AgentAlert, 'category' | 'occurrences' | 'lastSeenAt' | 'status'>) =>
  `${CATEGORY_LABEL[a.category]} · ×${a.occurrences} · seen ${relativeTime(a.lastSeenAt)} · ${STATUS_LABEL[a.status]}`;

function OrderRow({ c }: { c: AgentCommand }) {
  const cancel = useAgent((s) => s.cancel);
  return (
    <li className="flex items-start gap-2 rounded-lg bg-cream-100 px-2 py-1.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate">{ORDER_LABEL[c.kind]}{c.alertTitle ? ` · ${c.alertTitle}` : ''}</div>
        <div className="text-xs text-ink-500">{ORDER_STATUS[c.status]}{c.result ? ` — ${c.result}` : ''} · {relativeTime(c.createdAt)}</div>
      </div>
      {c.status === 'pending' && <button className="btn btn-ghost text-xs" onClick={() => void cancel(c.id).then((e) => e && toast(e, 'error'))}>Cancel</button>}
    </li>
  );
}

function PatchCard({ patch, onChanged }: { patch: AgentPatch; onChanged: () => void }) {
  const resolve = async (status: 'applied' | 'ignored') => {
    const e = await useAgent.getState().resolvePatch(patch.id, status);
    if (e) return toast(e, 'error');
    toast(status === 'applied' ? 'Marked as applied. The fix was wiped from the server.' : 'Fix discarded and wiped from the server.');
    onChanged();
  };
  const live = patch.status === 'proposed';
  return (
    <li className="space-y-2 rounded-lg border border-cream-300 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{patch.title}</div>
          <code className="block truncate text-xs text-ink-500">{patch.filePath}</code>
        </div>
        {!live && <span className="shrink-0 rounded bg-ink-900/10 px-1.5 py-0.5 text-[11px] font-semibold capitalize">{patch.status}</span>}
      </div>
      {live ? (
        <>
          <pre tabIndex={0} aria-label={`Fix for ${patch.filePath}`} className="scroll-thin max-h-60 overflow-auto rounded-md bg-ink-900 p-2 text-xs leading-relaxed text-cream-50">{patch.body}</pre>
          {patch.testCommand && (
            <div className="flex items-center gap-2 text-xs">
              <span className="shrink-0 text-ink-500">Then run</span><code className="min-w-0 flex-1 truncate rounded bg-cream-100 px-1.5 py-1">{patch.testCommand}</code>
              <button className="btn text-xs" onClick={() => void copy(patch.testCommand, 'Command')}>Copy</button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary text-xs" onClick={() => void copy(patch.body, 'Fix')}>Copy fix</button>
            <button className="btn text-xs" onClick={() => void resolve('applied')}>I applied it</button>
            <ConfirmButton className="btn btn-ghost text-xs text-clay-600" confirmLabel="Discard?" onConfirm={() => void resolve('ignored')}>Discard</ConfirmButton>
          </div>
          <p className="text-[11px] text-ink-500">Kept on the server until you mark it, or until {new Date(patch.expiresAt).toLocaleDateString()}. Then it is deleted.</p>
        </>
      ) : <p className="text-xs text-ink-500">The text of this fix was deleted from the server.</p>}
    </li>
  );
}

function AlertView({ id, onBack }: { id: string; onBack: () => void }) {
  const commands = useAgent((s) => s.commands);
  const [detail, setDetail] = useState<AgentAlertDetail | null | undefined>(undefined);
  const load = useCallback(async () => setDetail(await useAgent.getState().loadAlert(id)), [id]);
  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const mine = commands.filter((c) => c.alertId === id);
  const waiting = (k: AgentCommandKind) => mine.some((c) => c.kind === k && (c.status === 'pending' || c.status === 'acked'));
  const order = async (kind: AgentCommandKind) => {
    const e = await useAgent.getState().send(kind, id);
    toast(e ?? (kind === 'ignore' ? 'Alert ignored.' : 'Order sent. The agent takes it on its next check-in.'), e ? 'error' : 'ok');
    void load();
  };
  const tasks = useStore((s) => s.data.tasks);
  const back = <button className="btn btn-ghost text-xs" onClick={onBack}>← All alerts</button>;

  if (detail === undefined) return <PanelShell title="Alert" icon="⚡" actions={back}><p className="text-sm text-ink-500">Loading…</p></PanelShell>;
  if (detail === null) return <PanelShell title="Alert" icon="⚡" actions={back}><EmptyState icon="🍃" title="This alert is gone" hint="It may have expired." /></PanelShell>;
  const { alert, findings, patches } = detail;
  const { verdict, todo, more } = readFindings(findings);
  const existing = findTicket(tasks, alert.externalId, new Date());
  // One click makes the task that tracks this investigation: in progress, high priority, 1 story point, under the Run 'S&Y' scope.
  const createTicket = () => {
    const s = useStore.getState();
    const scope = findTicketScope(s.data.scopes) ?? s.addScope({ title: TICKET_SCOPE });
    const task = s.addTask({ title: ticketTitle(new Date()), status: 'doing', priority: 'high', size: 'XS', scopeId: scope.id, notes: ticketNotes(alert, findings) });
    toast(`Task created: ${task.title}`);
  };

  return (
    <PanelShell title={alert.title} icon="⚡" subtitle={meta(alert)} actions={back}>
      <div className="flex flex-wrap items-center gap-2"><Severity value={alert.severity} /><span className="text-xs text-ink-500">first seen {relativeTime(alert.firstSeenAt)}</span></div>
      {alert.summary && <p className="whitespace-pre-wrap text-sm">{alert.summary}</p>}

      <Section title="Task">
        {existing
          ? <p className="text-sm text-ink-700">✓ Task created today: “{existing.title}”. Find it in Tasks.</p>
          : <button className="btn text-xs" onClick={createTicket}>Create task</button>}
      </Section>

      {isOpen(alert) && (
        <Section title="Ask the agent">
          <div className="flex flex-wrap gap-2">
            {(['investigate', 'reanalyze'] as const).map((k) => (
              <button key={k} className="btn text-xs" disabled={waiting(k)} onClick={() => void order(k)}>{waiting(k) ? `${ORDER_LABEL[k]}… (waiting)` : ORDER_LABEL[k]}</button>
            ))}
            <ConfirmButton className="btn btn-ghost text-xs text-clay-600" confirmLabel="Ignore it?" onConfirm={() => void order('ignore')}>Ignore alert</ConfirmButton>
          </div>
          {mine.length > 0 && <ul className="mt-2 space-y-1.5" aria-label="Orders for this alert">{mine.slice(0, 3).map((c) => <OrderRow key={c.id} c={c} />)}</ul>}
        </Section>
      )}

      {verdict && (
        <section aria-label="Verdict" className={`rounded-xl border p-3 ${verdict.kind === 'lead' ? 'border-ink-900/20 bg-cream-100' : 'border-moss-600/40 bg-moss-600/10'}`}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{VERDICT_LABEL[verdict.kind]}</div>
          <p className="mt-0.5 whitespace-pre-wrap text-sm font-medium">{verdict.text}</p>
        </section>
      )}

      {todo.length > 0 && (
        <Section title="To do by you">
          <ul className="space-y-1.5">{todo.map((f) => <li key={f.id} className="flex gap-2 rounded-lg border border-clay-500/40 bg-clay-500/10 p-2 text-sm"><span aria-hidden>☐</span><span className="whitespace-pre-wrap">{f.text}</span></li>)}</ul>
        </Section>
      )}

      {more.length > 0 && (
        <Section title="Evidence and leads">
          <ul className="space-y-2">
            {more.map((f) => (
              <li key={f.id} className="rounded-lg bg-cream-100 p-2 text-sm">
                <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{VERDICT_LABEL[f.kind]}</span>
                <span className="whitespace-pre-wrap">{f.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Proposed fixes">
        {patches.length === 0 ? <p className="text-sm text-ink-500">No fix proposed yet. The agent only suggests: nothing is changed for you.</p>
          : <ul className="space-y-2">{patches.map((p) => <PatchCard key={p.id} patch={p} onChanged={() => void load()} />)}</ul>}
      </Section>
    </PanelShell>
  );
}

const TAG_TONE: Record<Analysis['tone'], string> = {
  found: 'bg-moss-600/15 text-moss-600', ok: 'bg-moss-600/15 text-moss-600', lead: 'bg-clay-500/15 text-clay-600', none: 'bg-ink-900/10 text-ink-700', failed: 'bg-clay-500/20 text-clay-600', working: 'bg-ink-900/10 text-ink-700', todo: 'bg-cream-200 text-ink-500',
};
function AnalysisTag({ a }: { a: AgentAlert }) {
  const t = analysisOf(a);
  return <div className="mt-1"><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${TAG_TONE[t.tone]}`}>{t.label}</span></div>;
}

export function AgentPanel() {
  const overview = useAgent((s) => s.overview);
  const alerts = useAgent((s) => s.alerts);
  const commands = useAgent((s) => s.commands);
  const stale = useAgent((s) => s.stale);
  const [openId, setOpenId] = useState<string | null>(null);
  // Looking at the list is what puts the beacon out. The alerts that were new stay tagged "New" while this panel is open.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const s = useAgent.getState();
    const ids = unseenAlerts(s.seen, s.alerts).map((a) => a.id);
    if (ids.length) setFresh((prev) => new Set([...prev, ...ids]));
    s.acknowledge();
  }, [alerts]);

  // Faster than the room's own two-minute check while the panel is open
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') { void useAgent.getState().sync(); void useAgent.getState().refreshCommands(); } };
    tick();
    const t = setInterval(tick, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  if (openId) return <AlertView id={openId} onBack={() => { setOpenId(null); void useAgent.getState().sync(); void useAgent.getState().refreshCommands(); }} />;

  const open = alerts.filter(isOpen);
  const closed = alerts.filter((a) => !isOpen(a));
  const simulated = alerts.filter((a) => a.externalId.startsWith('sim-')).length;
  const removeSimulated = async () => {
    const r = await useAgent.getState().deleteSimulated();
    toast('error' in r ? r.error : `${r.deleted} simulated alert${r.deleted === 1 ? '' : 's'} deleted.`, 'error' in r ? 'error' : 'ok');
  };
  const status = !overview ? 'Checking…' : overview.online ? (overview.state === 'paused' ? 'Online, paused' : overview.state === 'working' ? 'Online, working' : 'Online') : overview.lastSeenAt ? `Offline · seen ${relativeTime(overview.lastSeenAt)}` : 'Not connected yet';

  const row = (a: AgentAlert) => (
    <li key={a.id}>
      <button className="w-full rounded-lg bg-cream-100 p-2 text-left transition hover:bg-cream-200" onClick={() => setOpenId(a.id)}>
        <div className="flex items-center gap-2"><Severity value={a.severity} />{fresh.has(a.id) && <span className="rounded bg-ink-900 px-1.5 py-0.5 text-[11px] font-semibold text-cream-50">New</span>}<span className="min-w-0 flex-1 truncate font-medium">{a.title}</span>
          {!!a.openPatches && <span className="shrink-0 text-xs" title="Fixes waiting for you">🩹 {a.openPatches}</span>}</div>
        <div className="mt-0.5 truncate text-xs text-ink-500">{meta(a)}</div>
        {isOpen(a) && <AnalysisTag a={a} />}
      </button>
    </li>
  );

  return (
    <PanelShell title="AI agent" icon="⚡" subtitle={status}>
      {stale && <p role="status" className="text-xs text-ink-500">Can’t reach the server right now — showing the last list we have.</p>}
      {open.length === 0 ? (
        <EmptyState icon={overview?.lastSeenAt ? '🌿' : '📡'} title={overview?.lastSeenAt ? 'All quiet' : 'Waiting for the agent'}
          hint={overview?.lastSeenAt ? 'No open alerts right now.' : 'Create an access token in Settings and start the agent on your computer.'} />
      ) : (
        <Section title={`Open · ${open.length}`}><ul className="space-y-1.5" aria-label="Open alerts">{open.map(row)}</ul></Section>
      )}
      {closed.length > 0 && (
        <Section title={`Closed · ${closed.length}`}>
          <ul className="space-y-1.5" aria-label="Closed alerts">{closed.slice(0, 20).map(row)}</ul>
          {simulated > 0 && (
            <ConfirmButton className="btn btn-ghost mt-2 text-xs text-clay-600" confirmLabel="Delete them for good?" onConfirm={() => void removeSimulated()}>
              Delete the {simulated} simulated alert{simulated === 1 ? '' : 's'}
            </ConfirmButton>
          )}
        </Section>
      )}
      {commands.length > 0 && (
        <Section title="Recent orders"><ul className="space-y-1.5">{commands.slice(0, 5).map((c) => <OrderRow key={c.id} c={c} />)}</ul></Section>
      )}
    </PanelShell>
  );
}
