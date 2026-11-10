/** Thin client for the LifeOS API (server/app.ts). Cookies carry the session; nothing secret lives in JS. */

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown = null) { super(message); }
}
/** The server could not be reached at all (offline, server down). */
export class NetworkError extends Error {}

async function api<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = init.timeoutMs ? setTimeout(() => ctrl.abort(), init.timeoutMs) : undefined;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
      signal: ctrl.signal,
    });
  } catch {
    throw new NetworkError('Cannot reach the LifeOS server.');
  } finally { clearTimeout(timer); }
  const type = res.headers.get('content-type') ?? '';
  // A dev server without the API answers /api/* with the SPA html: treat that as "no server".
  if (!type.includes('application/json')) throw new NetworkError('No LifeOS server here.');
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`, body);
  return body as T;
}

import type { AgentAlert, AgentAlertDetail, AgentCommand, AgentCommandKind, AgentOverview, CalendarFeed, ExternalEvent } from '../domain/types';
import type { AbsenceDay, AbsenceList, AbsenceSettings, AbsenceStep } from '../domain/absence';

export interface Health { ok: true; hasUser: boolean; registrationOpen: boolean }
export interface CloudBackup { id: string; reason: string; revision: number; savedAt: string }

export const cloud = {
  /** null when there is no reachable server (the app then runs in local-only mode). */
  async health(): Promise<Health | null> {
    try { return await api<Health>('/health', { timeoutMs: 2500 }); } catch { return null; }
  },
  me: () => api<{ email: string; hasRecoveryCode: boolean }>('/auth/me'),
  login: (email: string, password: string) => api<{ email: string }>('/auth/login', { method: 'POST', body: { email, password } }),
  register: (email: string, password: string) => api<{ email: string; recoveryCode: string }>('/auth/register', { method: 'POST', body: { email, password } }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ ok: true; otherSessionsEnded: number }>('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
  newRecoveryCode: (password: string) => api<{ recoveryCode: string }>('/auth/recovery-code', { method: 'POST', body: { password } }),
  resetPassword: (email: string, recoveryCode: string, newPassword: string) =>
    api<{ email: string; recoveryCode: string }>('/auth/reset-password', { method: 'POST', body: { email, recoveryCode, newPassword } }),
  /** Everything the server holds for the account, as a JSON file. */
  async exportAccount(): Promise<{ blob: Blob; filename: string }> {
    let res: Response;
    try { res = await fetch('/api/account/export', { credentials: 'same-origin' }); } catch { throw new NetworkError('Cannot reach the LifeOS server.'); }
    if (!res.ok) throw new ApiError(res.status, res.status === 401 ? 'Your session ended. Sign in again.' : `Export failed (${res.status})`);
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1];
    return { blob: await res.blob(), filename: name ?? `lifeos-account-${new Date().toISOString().slice(0, 10)}.json` };
  },
  logout: () => api<{ ok: true }>('/auth/logout', { method: 'POST', body: {} }),
  getData: () => api<{ data: unknown | null; revision: number }>('/data'),
  putData: (data: unknown, baseRevision: number, force = false) =>
    api<{ revision: number }>('/data', { method: 'PUT', body: { data, baseRevision, force } }),
  listBackups: () => api<{ backups: CloudBackup[] }>('/data/backups'),
  pushKey: () => api<{ publicKey: string }>('/push/key'),
  pushSubscribe: (subscription: unknown, tz: string) => api<{ ok: true }>('/push/subscribe', { method: 'POST', body: { subscription, tz } }),
  pushUnsubscribe: (endpoint: string) => api<{ ok: true }>('/push/unsubscribe', { method: 'POST', body: { endpoint } }),
  pushTest: () => api<{ delivered: number; devices: number }>('/push/test', { method: 'POST', body: {} }),
  listFeeds: () => api<{ feeds: CalendarFeed[] }>('/feeds'),
  feedEvents: () => api<{ events: ExternalEvent[] }>('/feeds/events'),
  /** Fetches the link once right away, so a wrong link is reported immediately (allow for a slow calendar server). */
  addFeed: (input: { name: string; color: string; url: string }) => api<{ feed: CalendarFeed }>('/feeds', { method: 'POST', body: input, timeoutMs: 40_000 }),
  updateFeed: (id: string, patch: { name?: string; color?: string; remindBefore?: number | null }) => api<{ feed: CalendarFeed }>(`/feeds/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  removeFeed: (id: string) => api<{ ok: true }>(`/feeds/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} }),
  refreshFeed: (id: string) => api<{ feed: CalendarFeed }>(`/feeds/${encodeURIComponent(id)}/refresh`, { method: 'POST', body: {}, timeoutMs: 40_000 }),
  agent: () => api<AgentOverview>('/agent'),
  /** The token comes back once, here, and is never readable again. */
  createAgentToken: (name: string) => api<{ id: string; name: string; hint: string; createdAt: string; token: string }>('/agent/tokens', { method: 'POST', body: { name } }),
  revokeAgentToken: (id: string) => api<{ ok: true }>(`/agent/tokens/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} }),
  sendAgentCommand: (kind: AgentCommandKind, alertId?: string) =>
    api<{ id: string; alreadyQueued?: boolean }>('/agent/commands', { method: 'POST', body: alertId ? { kind, alertId } : { kind } }),
  agentAlerts: () => api<{ alerts: AgentAlert[] }>('/agent/alerts'),
  absences: () => api<AbsenceList>('/absences'),
  absenceSettings: () => api<AbsenceSettings>('/absences/settings'),
  saveAbsenceSettings: (s: AbsenceSettings) => api<AbsenceSettings>('/absences/settings', { method: 'PUT', body: s }),
  bookAbsence: (days: AbsenceDay[], steps: AbsenceStep[]) => api<{ id: string; label: string }>('/absences', { method: 'POST', body: { days, steps } }),
  cancelAbsence: (id: string) => api<{ ok: true }>(`/absences/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} }),
  deleteAbsence: (id: string) => api<{ ok: true }>(`/absences/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} }),
  retryAbsenceStep: (id: string) => api<{ ok: true }>(`/absences/steps/${encodeURIComponent(id)}/retry`, { method: 'POST', body: {} }),
  deleteSimulatedAlerts: () => api<{ deleted: number }>('/agent/alerts/simulated', { method: 'DELETE', body: {} }),
  agentAlert: (id: string) => api<AgentAlertDetail>(`/agent/alerts/${encodeURIComponent(id)}`),
  agentCommands: () => api<{ commands: AgentCommand[] }>('/agent/commands'),
  cancelAgentCommand: (id: string) => api<{ ok: true }>(`/agent/commands/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} }),
  /** Marking a fix applied or ignored wipes its text from the server straight away. */
  resolveAgentPatch: (id: string, status: 'applied' | 'ignored') =>
    api<{ ok: true }>(`/agent/patches/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } }),
  getBackup: (id: string) => api<{ data: unknown }>(`/data/backups/${encodeURIComponent(id)}`),
};
