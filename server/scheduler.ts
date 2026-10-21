import type pg from 'pg';
import { nextFeedReminderAt, nextFeedSyncAt, runDueFeedReminders, runDueFeeds } from './feeds';
import type { FeedFetcher } from './feedFetch';
import { nextReminderAt, runDueReminders, type Sender } from './push';
import { nextCatalogSyncAt, runDueCatalogSync, type JsonFetcher } from './catalog';

export interface SchedulerOptions {
  /** Longest nap between database visits (a safety net if a change notification is missed). */
  maxSleepMs?: number;
  /** Shortest nap, so a failing job can never spin. */
  minSleepMs?: number;
  /** Downloads the card catalog from optcgapi.com once a day. Off when not given (tests never touch the network). */
  fetchCatalog?: JsonFetcher;
}

/**
 * Runs the push reminders, meeting reminders, calendar syncs and the daily card-catalog sync, then sleeps until the next one is actually due
 * instead of polling the database every few seconds. That lets a scale-to-zero database (Neon free tier) suspend
 * between jobs. Call `poke()` after data changes so a new reminder or calendar is picked up straight away.
 */
export function startScheduler(pool: pg.Pool, send: Sender, fetchText: FeedFetcher, opts: SchedulerOptions = {}) {
  const maxSleep = opts.maxSleepMs ?? 3 * 3600_000;
  const minSleep = opts.minSleepMs ?? 5_000;
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let again = false;
  let stopped = false;

  const cycle = async () => {
    if (stopped) return;
    if (running) { again = true; return; }
    running = true;
    clearTimeout(timer);
    let wakeAt = Date.now() + minSleep;
    try {
      do {
        again = false;
        const log = (what: string) => (e: unknown) => console.error(`${what}:`, (e as Error).message);
        await runDueReminders(pool, send).catch(log('push scheduler'));
        await runDueFeedReminders(pool, send).catch(log('feed reminders'));
        await runDueFeeds(pool, fetchText).catch(log('feed scheduler'));
        if (opts.fetchCatalog) await runDueCatalogSync(pool, opts.fetchCatalog).catch(log('catalog sync'));
        const now = Date.now();
        const due = await Promise.all([
          nextReminderAt(pool, now), nextFeedReminderAt(pool, now, maxSleep), nextFeedSyncAt(pool),
          opts.fetchCatalog ? nextCatalogSyncAt(pool) : null,
        ])
          .catch((e) => { console.error('scheduler plan:', (e as Error).message); return [] as (number | null)[]; });
        const soonest = Math.min(...due.filter((t): t is number => t !== null), now + maxSleep);
        wakeAt = Math.max(soonest, now + minSleep);
      } while (again && !stopped);
    } finally {
      running = false;
    }
    if (!stopped) timer = setTimeout(() => void cycle(), Math.max(0, wakeAt - Date.now()));
  };

  void cycle();
  return {
    poke: () => void cycle(),
    stop: () => { stopped = true; clearTimeout(timer); },
  };
}
