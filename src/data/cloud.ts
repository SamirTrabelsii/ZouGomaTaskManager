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
  getBackup: (id: string) => api<{ data: unknown }>(`/data/backups/${encodeURIComponent(id)}`),
};
