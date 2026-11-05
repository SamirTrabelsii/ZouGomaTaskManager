import type { AgentAlert, AgentOverview, AlertCategory, AlertSeverity, AlertStatus } from './types';

export const SEVERITY_LABEL: Record<AlertSeverity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
export const CATEGORY_LABEL: Record<AlertCategory, string> = {
  data_quality: 'Data quality', pipeline_failure: 'Pipeline failure', performance: 'Performance', schema: 'Schema', other: 'Other',
};
export const STATUS_LABEL: Record<AlertStatus, string> = {
  open: 'Open', investigating: 'Investigating', proposed: 'Fix proposed', resolved: 'Resolved', ignored: 'Ignored',
};

export const isOpen = (a: Pick<AgentAlert, 'status'>) => a.status !== 'resolved' && a.status !== 'ignored';

/** Has the agent ever checked in, or been given a token? Until then the room has no agent console. */
export const agentConfigured = (o: AgentOverview | null) => !!o && (o.tokens.length > 0 || !!o.lastSeenAt);

export function alertCounts(alerts: Pick<AgentAlert, 'status' | 'severity'>[]) {
  const open = alerts.filter(isOpen);
  return { open: open.length, critical: open.filter((a) => a.severity === 'critical').length };
}

/**
 * Ids of open critical alerts that were not there at the previous look, i.e. what deserves a nudge in the room.
 * The very first look (previous = null) never nudges, so signing in does not shout about old news.
 */
export function newlyCritical(previous: ReadonlySet<string> | null, alerts: Pick<AgentAlert, 'id' | 'status' | 'severity'>[]): string[] {
  if (!previous) return [];
  return alerts.filter((a) => isOpen(a) && a.severity === 'critical' && !previous.has(a.id)).map((a) => a.id);
}
export const criticalIds = (alerts: Pick<AgentAlert, 'id' | 'status' | 'severity'>[]) =>
  new Set(alerts.filter((a) => isOpen(a) && a.severity === 'critical').map((a) => a.id));

/**
 * What the owner has already looked at: alert id → how many occurrences it had at the last look.
 * Ids and counts only, so keeping it in the browser stores nothing from work.
 */
export type SeenMap = Record<string, number>;
export const seenFrom = (alerts: Pick<AgentAlert, 'id' | 'occurrences'>[]): SeenMap => Object.fromEntries(alerts.map((a) => [a.id, a.occurrences]));

/**
 * Open alerts that are new since the last look: never seen, or that happened again. This is what makes the beacon flash.
 * (Counting occurrences, not dates, so an alert the agent reports late is still new.) Before the first look there is nothing new.
 */
export function unseenAlerts<T extends Pick<AgentAlert, 'id' | 'status' | 'occurrences'>>(seen: SeenMap | null, alerts: T[]): T[] {
  if (!seen) return [];
  return alerts.filter((a) => isOpen(a) && !(a.id in seen && seen[a.id] >= a.occurrences));
}

/** The glanceable line on the console's hover card, from what the agent last reported. */
export function agentSummary(overview: AgentOverview | null, alerts: Pick<AgentAlert, 'status' | 'severity'>[], fresh = 0): { summary: string; prompt: string | null } {
  if (!overview) return { summary: 'Checking the agent…', prompt: null };
  if (!overview.lastSeenAt) return { summary: 'Waiting for the agent to connect', prompt: 'Connect your agent in Settings' };
  const { open, critical } = alertCounts(alerts);
  const state = overview.online ? (overview.state === 'paused' ? 'paused' : null) : 'offline';
  const work = open === 0 ? 'All quiet' : `${open} open alert${open === 1 ? '' : 's'}${critical ? ` · ${critical} critical` : ''}${fresh ? ` · ${fresh} new` : ''}`;
  return { summary: state ? `Agent ${state} · ${work}` : work, prompt: null };
}

export const relativeTime = (iso: string | null, now = Date.now()) => {
  if (!iso) return 'never';
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** The tag shown on each row of the alert list: has the agent looked at it, and did it find something? */
export type Analysis = { label: string; tone: 'found' | 'none' | 'failed' | 'working' | 'todo' };
export function analysisOf(a: Pick<AgentAlert, 'status' | 'causes' | 'notes' | 'failedNotes' | 'openPatches'>): Analysis {
  if (a.status === 'investigating') return { label: 'Investigating…', tone: 'working' };
  if (a.causes) return { label: a.causes === 1 ? 'Cause found' : `${a.causes} causes found`, tone: 'found' };
  if (a.notes) return { label: 'Analysed · no cause found', tone: 'none' };
  if (a.failedNotes) return { label: 'Analysis failed', tone: 'failed' };
  return { label: 'Not analysed yet', tone: 'todo' };
}

/** How the robot in the room behaves, from what the agent is doing and whether there are alerts you have not seen. */
export type RobotMode = 'asleep' | 'resting' | 'agitated' | 'active' | 'calm';
export function robotMode(overview: Pick<AgentOverview, 'online' | 'state'> | null, unseen: number): RobotMode {
  if (!overview?.online) return 'asleep'; // offline (the night, a PC that is off): it sleeps
  if (overview.state === 'paused') return 'resting';
  if (unseen > 0) return 'agitated';
  if (overview.state === 'working') return 'active';
  return 'calm';
}

/* ── the task that tracks an investigation ── */

/** The scope every investigation task goes under. */
export const TICKET_SCOPE = "Run 'S&Y'";
const TICKET_PREFIX = 'Investigation Alerte RollBar';
const same = (s: string) => s.replace(/[‘’´`]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

/** "Investigation Alerte RollBar - 05112026": the day the task is made, as DDMMYYYY. */
export function ticketTitle(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${TICKET_PREFIX} - ${p(now.getDate())}${p(now.getMonth() + 1)}${now.getFullYear()}`;
}

/** The scope called Run 'S&Y' (quotes and case do not matter), if the user already has it. */
export const findTicketScope = <S extends { title: string }>(scopes: S[]): S | undefined => scopes.find((s) => same(s.title) === same(TICKET_SCOPE));

const NOTES_LIMIT = 4000;
/** What goes in the task: the alert, and what the agent found. The first line is the key used to spot a task already made. */
export function ticketNotes(
  alert: Pick<AgentAlert, 'externalId' | 'title' | 'severity' | 'occurrences' | 'lastSeenAt' | 'summary'>,
  findings: { kind: 'cause' | 'note'; text: string }[],
): string {
  const lines = [
    `Rollbar alert: ${alert.title} [${alert.externalId}]`,
    `${SEVERITY_LABEL[alert.severity]} · seen ${alert.occurrences} time${alert.occurrences === 1 ? '' : 's'} · last ${alert.lastSeenAt.slice(0, 16).replace('T', ' ')} UTC`,
  ];
  if (alert.summary) lines.push('', alert.summary);
  if (findings.length) lines.push('', 'What the agent found:', ...findings.map((f) => `- ${f.kind === 'cause' ? 'Likely cause' : 'Note'}: ${f.text}`));
  const text = lines.join('\n');
  return text.length <= NOTES_LIMIT ? text : `${text.slice(0, NOTES_LIMIT - 1).trimEnd()}…`;
}

/** The task already made today for this alert, if any (same title, and the alert's id on its first line). */
export function findTicket<T extends { title: string; notes: string }>(tasks: T[], externalId: string, now: Date): T | undefined {
  const title = ticketTitle(now);
  return tasks.find((t) => t.title === title && t.notes.split('\n', 1)[0].includes(`[${externalId}]`));
}
