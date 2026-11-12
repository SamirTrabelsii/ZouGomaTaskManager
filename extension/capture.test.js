import { describe, expect, it } from 'vitest';
import { taskFrom } from './capture.js';

const tab = { title: 'Q4 pipeline – Jira', url: 'https://jira.example.com/browse/DATA-42' };

describe('right-click capture', () => {
  it('uses the selected text as the title and keeps the page address in the notes', () => {
    const t = taskFrom({ selectionText: '  Fix the   null  rows in\nstaging ', pageUrl: tab.url }, tab);
    expect(t).toEqual({ title: 'Fix the null rows in staging', notes: 'https://jira.example.com/browse/DATA-42' });
  });

  it('cuts a long selection at a word and keeps all of it in the notes', () => {
    const long = 'word '.repeat(80).trim();
    const t = taskFrom({ selectionText: long, pageUrl: tab.url }, tab);
    expect(t.title.length).toBeLessThanOrEqual(200);
    expect(t.title.endsWith('…')).toBe(true);
    expect(t.title).not.toMatch(/wor…$/);
    expect(t.notes).toBe(`${tab.url}\n\n${long}`);
  });

  it('saves a link with where it was found', () => {
    const t = taskFrom({ linkUrl: 'https://www.example.org/docs/guide/', pageUrl: tab.url }, tab);
    expect(t).toEqual({ title: 'Check example.org/docs/guide', notes: 'https://www.example.org/docs/guide/\nFound on https://jira.example.com/browse/DATA-42' });
  });

  it('saves the page by its title', () => {
    expect(taskFrom({ pageUrl: tab.url }, tab)).toEqual({ title: 'Q4 pipeline – Jira', notes: tab.url });
    expect(taskFrom({ pageUrl: 'https://a.example/x' }, { title: '' }).title).toBe('a.example/x');
  });
});
