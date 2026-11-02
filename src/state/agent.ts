import { create } from 'zustand';
import { cloud, ApiError } from '../data/cloud';
import type { AgentCommandKind, AgentOverview } from '../domain/types';

/**
 * The local AI agent as the app sees it: whether it is online and which access tokens exist. Deliberately NOT part of AppData
 * (it belongs to the server, like calendar feeds) and not cached in the browser. It is only refreshed while the Settings
 * section is open, so it never keeps a sleeping server or database awake.
 */
interface AgentState {
  overview: AgentOverview | null;
  /** Set when the last refresh failed (offline); the previous values stay visible. */
  stale: boolean;
  refresh(): Promise<void>;
  /** Returns the new token (shown once) or an error message. */
  createToken(name: string): Promise<{ token: string } | { error: string }>;
  /** Returns an error message, or null on success. */
  revokeToken(id: string): Promise<string | null>;
  /** Returns an error message, or null on success. */
  send(kind: AgentCommandKind): Promise<string | null>;
  reset(): void;
}

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'Cannot reach the LifeOS server.');

export const useAgent = create<AgentState>((set, get) => ({
  overview: null,
  stale: false,
  async refresh() {
    try { set({ overview: await cloud.agent(), stale: false }); } catch (e) {
      if (e instanceof ApiError && e.status === 401) return get().reset();
      set({ stale: true });
    }
  },
  async createToken(name) {
    try {
      const t = await cloud.createAgentToken(name);
      await get().refresh();
      return { token: t.token };
    } catch (e) { return { error: messageOf(e) }; }
  },
  async revokeToken(id) {
    try { await cloud.revokeAgentToken(id); await get().refresh(); return null; } catch (e) { return messageOf(e); }
  },
  async send(kind) {
    try { await cloud.sendAgentCommand(kind); return null; } catch (e) { return messageOf(e); }
  },
  reset() { set({ overview: null, stale: false }); },
}));
