import type { Certification, CertStatus } from './types';
import { addDays, diffDays, LOCALE, parseDay } from './dates';

/** An earned certification counts as "expiring soon" this many days before its expiry date. */
export const EXPIRING_SOON_DAYS = 60;
/** Renewal reminder choices, in days before expiry. */
export const REMIND_OPTIONS = [30, 60, 90] as const;
export const DEFAULT_REMIND_BEFORE = 60;
/** Renewal reminders go off at this local time. */
const REMIND_TIME = '09:00';

export const CERT_STATUS: Record<CertStatus, string> = { planned: '○ Planned', studying: '✎ Studying', earned: '✓ Earned' };

export type CertState = CertStatus | 'expiring' | 'expired';

/** The status to show today: an earned certification can also be expiring soon, or expired. */
export function certState(c: Pick<Certification, 'status' | 'expiresOn'>, today: string): CertState {
  if (c.status !== 'earned' || !c.expiresOn) return c.status;
  const left = diffDays(today, c.expiresOn);
  if (left < 0) return 'expired';
  return left <= EXPIRING_SOON_DAYS ? 'expiring' : 'earned';
}

/** Earned and still valid (or never expiring) first, then in progress, planned, and expired last; soonest date first within each. */
export function sortCerts(certs: Certification[], today: string): Certification[] {
  const rank: Record<CertState, number> = { expiring: 0, earned: 1, studying: 2, planned: 3, expired: 4 };
  const date = (c: Certification) => (c.status === 'earned' ? c.expiresOn : c.examDate) ?? '9999';
  return [...certs].sort((a, b) => rank[certState(a, today)] - rank[certState(b, today)] || date(a).localeCompare(date(b)));
}

/** When the renewal reminder fires (local 'YYYY-MM-DDTHH:mm'), or null when there should be none. */
export function certReminderAt(c: Pick<Certification, 'status' | 'expiresOn' | 'remindBefore'>, today: string): string | null {
  if (c.status !== 'earned' || !c.expiresOn || c.remindBefore == null || c.expiresOn < today) return null;
  return `${addDays(c.expiresOn, -c.remindBefore)}T${REMIND_TIME}`;
}

export function certReminderTitle(c: Pick<Certification, 'title' | 'expiresOn'>): string {
  return `Renew ${c.title}: it expires on ${formatCertDate(c.expiresOn!)}`;
}

/** Keeps only http(s) links, so a pasted `javascript:` URL can never end up in an href. */
export function safeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
}

/** Dates on credentials can be years away, so they always show the year ("12 Mar 2027"). */
export function formatCertDate(s: string): string {
  return parseDay(s).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}
