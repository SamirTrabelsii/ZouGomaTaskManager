import { useEffect, useState } from 'react';
import { isNightLook, todayStr } from '../domain/dates';
import { useStore } from './store';
import { useFeeds } from './feeds';

/** Current local date; rolls over at midnight without a reload. */
export function useToday(): string {
  const [t, setT] = useState(todayStr);
  useEffect(() => {
    const id = setInterval(() => setT((p) => { const n = todayStr(); return n === p ? p : n; }), 30_000);
    return () => clearInterval(id);
  }, []);
  return t;
}

/**
 * Reminder delivery while the app is open. Ordinary page timers cannot fire when the tab/browser
 * is closed — see Settings → Reminders. Delivered state is persisted, so nothing repeats.
 */
export function useReminderEngine(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const tick = () => useStore.getState().deliverDueReminders();
    tick();
    const id = setInterval(tick, 15_000);
    const onVis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled]);
}

/** Keeps imported calendar feeds fresh while the app is open (the server itself re-reads each feed about every 15 minutes). */
export function useFeedSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) { useFeeds.getState().reset(); return; }
    const tick = () => void useFeeds.getState().refresh();
    tick();
    const id = setInterval(tick, 5 * 60_000);
    const onVis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled]);
}

/** Whether the room is in its night look: explicit 'evening', or 'auto' following the local clock. */
export function useNight(): boolean {
  const theme = useStore((s) => s.data.prefs.scene.theme);
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const id = setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => clearInterval(id);
  }, []);
  return isNightLook(theme, hour);
}

export function useMedia(query: string): boolean {
  const [m, setM] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn);
    fn();
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return m;
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
