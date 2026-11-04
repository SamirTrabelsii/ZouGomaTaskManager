import { create } from 'zustand';
import { cloud, ApiError } from '../data/cloud';
import { criticalIds, newlyCritical, seenFrom, type SeenMap } from '../domain/agent';
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
  /** What the owner has looked at, so the beacon flashes for what is new. null until the first look. Remembered in this browser (ids and counts only). */
  seen: SeenMap | null;
  /** The alert list has been fetched at least once. */
  loaded: boolean;
  /** The owner has now looked at the list: nothing is new any more. */
  acknowledge(): void;
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
  /** Removes the demo alerts. Returns how many went, or an error message. */
  deleteSimulated(): Promise<{ deleted: number } | { error: string }>;
  cancel(id: string): Promise<string | null>;
  resolvePatch(id: string, status: 'applied' | 'ignored'): Promise<string | null>;
  reset(): void;
}

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'Cannot reach the LifeOS server.');
let nudge = 1;

const SEEN_KEY = 'lifeos.agent.seen';
function readSeen(): SeenMap | null {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as SeenMap) : null;
  } catch { return null; }
}
function writeSeen(seen: SeenMap) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* private window or storage blocked: the beacon just forgets on reload */ } }

export const useAgent = create<AgentState>((set, get) => {
  const failed = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) return get().reset();
    set({ stale: true });
  };
  return {
    overview: null, alerts: [], commands: [], seenCritical: null, seen: null, loaded: false, stale: false,
    acknowledge() {
      if (!get().loaded) return; // never "look at" a list that has not arrived
      const seen = seenFrom(get().alerts);
      set({ seen });
      writeSeen(seen);
    },
    async refresh() {
      try { set({ overview: await cloud.agent(), stale: false }); } catch (e) { failed(e); }
    },
    async sync() {
      try {
        const [overview, { alerts }] = await Promise.all([cloud.agent(), cloud.agentAlerts()]);
        const fresh = newlyCritical(get().seenCritical, alerts);
        // the very first look in this browser never flashes for old news: what is there then counts as seen
        let seen = get().seen ?? readSeen();
        if (!seen) { seen = seenFrom(alerts); writeSeen(seen); }
        set({ overview, alerts, stale: false, seenCritical: criticalIds(alerts), seen, loaded: true });
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
    async deleteSimulated() {
      try { const r = await cloud.deleteSimulatedAlerts(); await get().sync(); return r; } catch (e) { return { error: messageOf(e) }; }
    },
    async cancel(id) {
      try { await cloud.cancelAgentCommand(id); await get().refreshCommands(); return null; } catch (e) { return messageOf(e); }
    },
    async resolvePatch(id, status) {
      try { await cloud.resolveAgentPatch(id, status); await get().sync(); return null; } catch (e) { return messageOf(e); }
    },
    reset() { set({ overview: null, alerts: [], commands: [], seenCritical: null, seen: null, loaded: false, stale: false }); },
  };
});
