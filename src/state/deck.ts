import { create } from 'zustand';
import { cloud, ApiError } from '../data/cloud';
import type { DeckButton, DeckOverview } from '../domain/deck';

/** The stream deck as the app sees it. Server-side data, like the agent's: kept in memory only. */
interface DeckState {
  overview: DeckOverview | null;
  sync(): Promise<void>;
  /** Returns an error message, or null on success. */
  save(columns: number, buttons: DeckButton[]): Promise<string | null>;
  reset(): void;
}

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'Cannot reach the LifeOS server.');

export const useDeck = create<DeckState>((set, get) => ({
  overview: null,
  async sync() {
    try { set({ overview: await cloud.deck() }); } catch (e) {
      if (e instanceof ApiError && e.status === 401) get().reset();
    }
  },
  async save(columns, buttons) {
    try {
      const r = await cloud.saveDeck(columns, buttons);
      const o = get().overview;
      if (o) set({ overview: { ...o, columns: r.columns, buttons: r.buttons, revision: r.revision, updatedAt: r.updatedAt } });
      else await get().sync();
      return null;
    } catch (e) { return messageOf(e); }
  },
  reset() { set({ overview: null }); },
}));
