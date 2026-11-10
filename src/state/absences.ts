import { create } from 'zustand';
import { cloud, ApiError } from '../data/cloud';
import type { AbsenceDay, AbsenceList, AbsenceSettings, AbsenceStep } from '../domain/absence';

/**
 * Absences as the app sees them: the booked ones with the state of each step, whether an executor (n8n) is listening,
 * and the owner's absence settings. Server-side data, like the agent's: kept in memory only.
 */
interface AbsenceState {
  list: AbsenceList | null;
  settings: AbsenceSettings | null;
  stale: boolean;
  sync(): Promise<void>;
  loadSettings(): Promise<void>;
  /** Each returns an error message, or null on success. */
  saveSettings(s: AbsenceSettings): Promise<string | null>;
  book(days: AbsenceDay[], steps: AbsenceStep[]): Promise<string | null>;
  cancel(id: string): Promise<string | null>;
  remove(id: string): Promise<string | null>;
  retry(stepId: string): Promise<string | null>;
  reset(): void;
}

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'Cannot reach the LifeOS server.');

export const useAbsences = create<AbsenceState>((set, get) => {
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await get().sync(); return null; } catch (e) { return messageOf(e); }
  };
  return {
    list: null, settings: null, stale: false,
    async sync() {
      try { set({ list: await cloud.absences(), stale: false }); } catch (e) {
        if (e instanceof ApiError && e.status === 401) return get().reset();
        set({ stale: true });
      }
    },
    async loadSettings() {
      try { set({ settings: await cloud.absenceSettings() }); } catch { /* the form shows what it has */ }
    },
    async saveSettings(s) {
      try { set({ settings: await cloud.saveAbsenceSettings(s) }); return null; } catch (e) { return messageOf(e); }
    },
    book: (days, steps) => act(() => cloud.bookAbsence(days, steps)),
    cancel: (id) => act(() => cloud.cancelAbsence(id)),
    remove: (id) => act(() => cloud.deleteAbsence(id)),
    retry: (stepId) => act(() => cloud.retryAbsenceStep(stepId)),
    reset() { set({ list: null, settings: null, stale: false }); },
  };
});

/** True while some step waits or runs, so the room checks more often until it settles. */
export const absenceInFlight = (list: AbsenceList | null) =>
  !!list?.absences.some((a) => !a.cancelled && a.steps.some((s) => s.status === 'pending' || s.status === 'running'));
