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
