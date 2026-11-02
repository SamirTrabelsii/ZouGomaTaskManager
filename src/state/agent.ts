import { create } from 'zustand';
import { cloud, ApiError } from '../data/cloud';
import { criticalIds, newlyCritical } from '../domain/agent';
import type { AgentAlert, AgentAlertDetail, AgentCommand, AgentCommandKind, AgentOverview } from '../domain/types';
import { useStore } from './store';

/**
 * The local AI agent as the app sees it: whether it is online, its access tokens, and the alerts and orders it works on.
 * Deliberately NOT part of AppData (it belongs to the server, like calendar feeds) and not cached in the browser: alerts
 * and fixes may come from work, so they stay in memory and disappear when the tab closes.
 */
interface AgentState {
  overview: AgentOverview | null;
  alerts: AgentAlert[];
  commands: AgentCommand[];
  /** Ids of critical alerts already seen, to tell a new one from an old one. null until the first look. */
  seenCritical: ReadonlySet<string> | null;
  /** Set when the last refresh failed (offline); the previous values stay visible. */
  stale: boolean;
  /** Status and tokens only (Settings). */
  refresh(): Promise<void>;
  /** Status and alerts (the room). Nudges the room when a new critical alert has arrived. */
  sync(): Promise<void>;
  refreshCommands(): Promise<void>;
  loadAlert(id: string): Promise<AgentAlertDetail | null>;
  /** Returns the new token (shown once) or an error message. */
  createToken(name: string): Promise<{ token: string } | { error: string }>;
  /** Returns an error message, or null on success. */
  revokeToken(id: string): Promise<string | null>;
  /** Returns an error message, or null on success. */
  send(kind: AgentCommandKind, alertId?: string): Promise<string | null>;
  cancel(id: string): Promise<string | null>;
  resolvePatch(id: string, status: 'applied' | 'ignored'): Promise<string | null>;
  reset(): void;
}

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'Cannot reach the LifeOS server.');
let nudge = 1;

export const useAgent = create<AgentState>((set, get) => {
  const failed = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) return get().reset();
    set({ stale: true });
  };
  return {
    overview: null, alerts: [], commands: [], seenCritical: null, stale: false,
    async refresh() {
      try { set({ overview: await cloud.agent(), stale: false }); } catch (e) { failed(e); }
    },
    async sync() {
      try {
        const [overview, { alerts }] = await Promise.all([cloud.agent(), cloud.agentAlerts()]);
        const fresh = newlyCritical(get().seenCritical, alerts);
        set({ overview, alerts, stale: false, seenCritical: criticalIds(alerts) });
        if (fresh.length) useStore.setState((s) => ({ pulse: { ...s.pulse, agent: { key: -nudge++, celebrate: false } } }));
      } catch (e) { failed(e); }
    },
    async refreshCommands() {
      try { set({ commands: (await cloud.agentCommands()).commands }); } catch (e) { failed(e); }
    },
    async loadAlert(id) {
      try { return await cloud.agentAlert(id); } catch (e) { failed(e); return null; }
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
    async send(kind, alertId) {
      try { await cloud.sendAgentCommand(kind, alertId); await Promise.all([get().refreshCommands(), kind === 'ignore' ? get().sync() : null]); return null; } catch (e) { return messageOf(e); }
    },
    async cancel(id) {
      try { await cloud.cancelAgentCommand(id); await get().refreshCommands(); return null; } catch (e) { return messageOf(e); }
    },
    async resolvePatch(id, status) {
      try { await cloud.resolveAgentPatch(id, status); await get().sync(); return null; } catch (e) { return messageOf(e); }
    },
    reset() { set({ overview: null, alerts: [], commands: [], seenCritical: null, stale: false }); },
  };
});
