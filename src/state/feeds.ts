import { useMemo } from 'react';
import { create } from 'zustand';
import { cloud, ApiError } from '../data/cloud';
import { externalAgendaItems } from '../domain/external';
import { agendaItems } from '../domain/services';
import type { CalendarFeed, ExternalEvent } from '../domain/types';
import { useStore } from './store';

/**
 * Imported calendar feeds. Deliberately NOT part of AppData: imported meetings are the server's copy of someone else's calendar,
 * so they are never saved into (or conflict with) the user's own synced document and cannot be edited.
 */
interface FeedsState {
  feeds: CalendarFeed[];
  events: ExternalEvent[];
  loaded: boolean;
  /** Set when the last refresh failed (offline); the previous list stays visible. */
  stale: boolean;
  refresh(): Promise<void>;
  /** Returns an error message, or null on success. */
  add(input: { name: string; color: string; url: string }): Promise<string | null>;
  update(id: string, patch: { name?: string; color?: string }): Promise<string | null>;
  remove(id: string): Promise<string | null>;
  refreshOne(id: string): Promise<string | null>;
  reset(): void;
}

const CACHE_KEY = 'lifeos.feeds.v1';
type Cache = { feeds: CalendarFeed[]; events: ExternalEvent[] };

function readCache(): Cache | null {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Cache | null;
    return v && Array.isArray(v.feeds) && Array.isArray(v.events) ? v : null;
  } catch { return null; }
}
function writeCache(c: Cache | null) {
  try { if (c) localStorage.setItem(CACHE_KEY, JSON.stringify(c)); else localStorage.removeItem(CACHE_KEY); } catch { /* storage unavailable */ }
}

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'Cannot reach the LifeOS server.');

export const useFeeds = create<FeedsState>((set, get) => {
  const load = async () => {
    const [f, e] = await Promise.all([cloud.listFeeds(), cloud.feedEvents()]);
    set({ feeds: f.feeds, events: e.events, loaded: true, stale: false });
    writeCache({ feeds: f.feeds, events: e.events });
  };
  const cached = readCache();
  return {
    feeds: cached?.feeds ?? [], events: cached?.events ?? [], loaded: false, stale: false,
    async refresh() {
      try { await load(); } catch (e) {
        if (e instanceof ApiError && e.status === 401) return get().reset();
        set({ stale: true });
      }
    },
    async add(input) {
      try { await cloud.addFeed(input); await load(); return null; } catch (e) { return messageOf(e); }
    },
    async update(id, patch) {
      try { await cloud.updateFeed(id, patch); await load(); return null; } catch (e) { return messageOf(e); }
    },
    async remove(id) {
      try { await cloud.removeFeed(id); await load(); return null; } catch (e) { return messageOf(e); }
    },
    async refreshOne(id) {
      try { await cloud.refreshFeed(id); await load(); return null; } catch (e) {
        await load().catch(() => {}); // show the recorded error on the card
        return messageOf(e);
      }
    },
    reset() { set({ feeds: [], events: [], loaded: false, stale: false }); writeCache(null); },
  };
});

/** Everything on the calendar: the user's own items plus imported meetings (already in local time). */
export function useAgenda() {
  const data = useStore((s) => s.data);
  const events = useFeeds((s) => s.events);
  const feeds = useFeeds((s) => s.feeds);
  return useMemo(() => agendaItems(data, externalAgendaItems(events, feeds)), [data, events, feeds]);
}
