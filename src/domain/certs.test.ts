import { describe, expect, it } from 'vitest';
import { certReminderAt, certState, safeUrl, sortCerts } from './certs';
import { normalize } from '../data/storage';
import type { Certification } from './types';

const TODAY = '2026-10-22';
const cert = (over: Partial<Certification>): Certification => ({
  id: 'c', title: 'Cert', issuer: '', status: 'earned', examDate: null, earnedOn: null, expiresOn: null, credentialId: '',
  credentialUrl: '', notes: '', remindBefore: 60, createdAt: '2026-01-01T00:00:00Z', ...over,
});

describe('certState', () => {
  it('follows the stored status until earned', () => {
    expect(certState(cert({ status: 'planned', expiresOn: '2020-01-01' }), TODAY)).toBe('planned');
    expect(certState(cert({ status: 'studying' }), TODAY)).toBe('studying');
  });
  it('an earned certification is expiring within 60 days, expired after its date, and fine without one', () => {
    expect(certState(cert({}), TODAY)).toBe('earned');
    expect(certState(cert({ expiresOn: '2027-06-01' }), TODAY)).toBe('earned');
    expect(certState(cert({ expiresOn: '2026-12-21' }), TODAY)).toBe('expiring');
    expect(certState(cert({ expiresOn: TODAY }), TODAY)).toBe('expiring');
    expect(certState(cert({ expiresOn: '2026-10-21' }), TODAY)).toBe('expired');
  });
});

describe('sortCerts', () => {
  it('puts what needs attention first and expired last', () => {
    const list = [
      cert({ id: 'expired', expiresOn: '2025-01-01' }),
      cert({ id: 'planned', status: 'planned' }),
      cert({ id: 'valid', expiresOn: '2028-01-01' }),
      cert({ id: 'study-late', status: 'studying', examDate: '2027-03-01' }),
      cert({ id: 'study-soon', status: 'studying', examDate: '2026-11-15' }),
      cert({ id: 'expiring', expiresOn: '2026-11-01' }),
    ];
    expect(sortCerts(list, TODAY).map((c) => c.id)).toEqual(['expiring', 'valid', 'study-soon', 'study-late', 'planned', 'expired']);
  });
});

describe('certReminderAt', () => {
  it('reminds the chosen number of days before expiry, at 09:00', () => {
    expect(certReminderAt(cert({ expiresOn: '2027-03-01', remindBefore: 60 }), TODAY)).toBe('2026-12-31T09:00');
    expect(certReminderAt(cert({ expiresOn: '2027-03-01', remindBefore: 30 }), TODAY)).toBe('2027-01-30T09:00');
  });
  it('has nothing to remind about when not earned, never expiring, turned off or already expired', () => {
    expect(certReminderAt(cert({ status: 'studying', expiresOn: '2027-03-01' }), TODAY)).toBeNull();
    expect(certReminderAt(cert({ expiresOn: null }), TODAY)).toBeNull();
    expect(certReminderAt(cert({ expiresOn: '2027-03-01', remindBefore: null }), TODAY)).toBeNull();
    expect(certReminderAt(cert({ expiresOn: '2026-10-01' }), TODAY)).toBeNull();
  });
});

describe('safeUrl', () => {
  it('keeps web links and adds https to bare ones', () => {
    expect(safeUrl(' https://www.credly.com/badges/abc ')).toBe('https://www.credly.com/badges/abc');
    expect(safeUrl('credly.com/badges/abc')).toBe('https://credly.com/badges/abc');
  });
  it('drops anything that is not http(s)', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('data:text/html,hi')).toBe('');
    expect(safeUrl('')).toBe('');
  });
});

describe('normalize certifications', () => {
  it('older data gets an empty list', () => {
    expect(normalize({ version: 3, tasks: [] }).certifications).toEqual([]);
  });
  it('repairs bad fields and strips unsafe links', () => {
    const [c] = normalize({
      version: 4,
      certifications: [
        { id: 'a', title: 'AWS', status: 'passed', examDate: 'soon', expiresOn: '2027-01-01', credentialUrl: 'javascript:alert(1)', remindBefore: -5 },
        { id: 'b' },
      ],
    }).certifications;
    expect(c).toMatchObject({ id: 'a', status: 'planned', examDate: null, expiresOn: '2027-01-01', credentialUrl: '', remindBefore: null, issuer: '' });
  });
});
