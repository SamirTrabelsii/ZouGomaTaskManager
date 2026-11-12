import { describe, expect, it } from 'vitest';
import { fold, matchScopes, parseQuickAdd } from './parse.js';

// Thursday 12 November 2026, mid-morning
const now = new Date(2026, 10, 12, 10, 30);
const scopes = [
  { id: 'w', title: 'Work', icon: '💼' },
  { id: 'p', title: 'Perso', icon: '🏠' },
  { id: 'sp', title: 'Side projects', icon: '🚀' },
];
const p = (text) => parseQuickAdd(text, { scopes, now });

describe('quick-add parser', () => {
  it('leaves a plain title alone', () => {
    expect(p('Read chapter 4 of DDIA')).toEqual({ title: 'Read chapter 4 of DDIA', dueDate: null, priority: null, scopeId: null, scopeQuery: null });
  });

  it('reads today / tomorrow in French and English, with or without a little word before', () => {
    expect(p('Appeler la banque demain')).toMatchObject({ title: 'Appeler la banque', dueDate: '2026-11-13' });
    expect(p('Call the bank tomorrow')).toMatchObject({ title: 'Call the bank', dueDate: '2026-11-13' });
    expect(p("Envoyer le rapport aujourd'hui")).toMatchObject({ title: 'Envoyer le rapport', dueDate: '2026-11-12' });
    expect(p('Envoyer le rapport pour demain')).toMatchObject({ title: 'Envoyer le rapport', dueDate: '2026-11-13' });
    expect(p('Préparer la démo après-demain')).toMatchObject({ title: 'Préparer la démo', dueDate: '2026-11-14' });
    expect(p('Pay rent today')).toMatchObject({ title: 'Pay rent', dueDate: '2026-11-12' });
  });

  it('takes a weekday as the next one, never today', () => {
    expect(p('Réunion lundi')).toMatchObject({ title: 'Réunion', dueDate: '2026-11-16' });
    expect(p('Sport vendredi')).toMatchObject({ dueDate: '2026-11-13' });
    expect(p('Review on Thursday')).toMatchObject({ title: 'Review', dueDate: '2026-11-19' });
    expect(p('Point mardi prochain')).toMatchObject({ title: 'Point', dueDate: '2026-11-17' });
    expect(p('Call mom next sunday')).toMatchObject({ title: 'Call mom', dueDate: '2026-11-15' });
  });

  it('reads day numbers and day/month dates', () => {
    expect(p('Payer la facture le 20')).toMatchObject({ title: 'Payer la facture', dueDate: '2026-11-20' });
    expect(p('Payer la facture le 5')).toMatchObject({ dueDate: '2026-12-05' }); // the 5th has passed: next month
    expect(p('Renew passport on the 3rd')).toMatchObject({ title: 'Renew passport', dueDate: '2026-12-03' });
    expect(p('Dentiste 24/11')).toMatchObject({ title: 'Dentiste', dueDate: '2026-11-24' });
    expect(p('Impôts 15/05')).toMatchObject({ dueDate: '2027-05-15' }); // passed this year: next year
    expect(p('Visa 02/01/2027')).toMatchObject({ dueDate: '2027-01-02' });
    expect(p('Deploy 2026-12-01')).toMatchObject({ title: 'Deploy', dueDate: '2026-12-01' });
    expect(p('Something 31/02')).toMatchObject({ title: 'Something 31/02', dueDate: null }); // no such day
  });

  it('reads "in N days / weeks" and next week', () => {
    expect(p('Relancer le client dans 3 jours')).toMatchObject({ title: 'Relancer le client', dueDate: '2026-11-15' });
    expect(p('Follow up in 2 weeks')).toMatchObject({ title: 'Follow up', dueDate: '2026-11-26' });
    expect(p('Planifier semaine prochaine')).toMatchObject({ title: 'Planifier', dueDate: '2026-11-16' });
  });

  it('reads ! as high priority', () => {
    expect(p('Call the bank about the loan !')).toMatchObject({ title: 'Call the bank about the loan', priority: 'high' });
    expect(p('Call the bank!')).toMatchObject({ title: 'Call the bank', priority: 'high' });
    expect(p('! urgent fix')).toMatchObject({ title: 'urgent fix', priority: 'high' });
    expect(p('Is it done?')).toMatchObject({ priority: null });
  });

  it('reads #scope by name, prefix, accents and case', () => {
    expect(p('Book flights #perso')).toMatchObject({ title: 'Book flights', scopeId: 'p' });
    expect(p('Fix CI #WORK demain !')).toMatchObject({ title: 'Fix CI', scopeId: 'w', dueDate: '2026-11-13', priority: 'high' });
    expect(p('Ship it #side')).toMatchObject({ title: 'Ship it', scopeId: 'sp' });
    expect(p('Tag #unknown stays')).toMatchObject({ title: 'Tag #unknown stays', scopeId: null });
  });

  it('reports the #word being typed for suggestions', () => {
    expect(p('Book flights #pe').scopeQuery).toBe('pe');
    expect(p('Book flights #').scopeQuery).toBe('');
    expect(p('Book flights #perso now').scopeQuery).toBeNull();
    expect(matchScopes('s', scopes).map((s) => s.id)).toEqual(['sp']);
    expect(matchScopes('', scopes)).toHaveLength(3);
  });

  it('only takes the first date and keeps words that merely look alike', () => {
    expect(p('Monday.com migration demain')).toMatchObject({ dueDate: '2026-11-13' });
    expect(p('Lire Le Monde')).toMatchObject({ title: 'Lire Le Monde', dueDate: null });
  });

  it('folds accents without moving characters', () => {
    expect(fold('Après-Demain')).toBe('apres-demain');
    expect(fold('Été')).toHaveLength(3);
  });
});
