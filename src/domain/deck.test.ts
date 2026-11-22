import { describe, expect, it } from 'vitest';
import { blankAction, buttonProblem, coverCrop, deckMood, deckSummary, describeAction, fileKindOf, layoutKey, moveItem, newButton, newPictureName, offeredFiles, pictureUrl, starterButtons, type DeckOverview } from './deck';

const overview = (o: Partial<DeckOverview> = {}, deck: Partial<DeckOverview['deck']> = {}): DeckOverview => ({
  columns: 4, buttons: [], revision: 0, updatedAt: null, tokens: [],
  deck: { syncedAt: null, syncedRevision: 0, version: '', scripts: [], sounds: [], ...deck }, ...o,
});

describe('deck mood', () => {
  it('is unplugged until a deck connects', () => {
    expect(deckMood(null)).toBe('unplugged');
    expect(deckMood(overview({ revision: 3 }))).toBe('unplugged');
  });
  it('is outdated when the buttons changed after the last sync', () => {
    expect(deckMood(overview({ revision: 3 }, { syncedAt: '2026-11-19T08:00:00Z', syncedRevision: 2 }))).toBe('outdated');
  });
  it('is ready when the deck has the current buttons', () => {
    expect(deckMood(overview({ revision: 3 }, { syncedAt: '2026-11-19T08:00:00Z', syncedRevision: 3 }))).toBe('ready');
  });
  it('summarises for the room', () => {
    expect(deckSummary(overview()).prompt).toBe('Set up your stream deck');
    expect(deckSummary(overview({ revision: 2, buttons: [newButton('a')] }, { syncedAt: 'x', syncedRevision: 1 })).summary).toBe('1 button · click ⟳ on the deck');
  });
});

describe('button checks', () => {
  it('accepts the starter buttons', () => {
    let i = 0;
    for (const b of starterButtons('https://lifeos.example', () => `b${i++}`)) expect(buttonProblem(b)).toBeNull();
  });
  it('flags what the server would refuse', () => {
    const b = newButton('x');
    expect(buttonProblem({ ...b, label: ' ' })).toMatch(/label/);
    expect(buttonProblem({ ...b, action: { type: 'website', url: 'example.com', browser: 'default', profile: '' } })).toMatch(/https/);
    expect(buttonProblem({ ...b, action: { type: 'app', target: 'notepad.exe' } })).toMatch(/full path/);
    expect(buttonProblem({ ...b, action: { type: 'app', target: 'C:\\Windows\\notepad.exe' } })).toBeNull();
    expect(buttonProblem({ ...b, action: { type: 'script', file: '..\\x.ps1' } })).toMatch(/scripts folder/);
    expect(buttonProblem({ ...b, action: { type: 'sound', file: 'applause.wav', volume: 50 } })).toBeNull();
  });
  it('describes actions in one line', () => {
    expect(describeAction({ type: 'website', url: 'https://a.example/x', browser: 'chrome', profile: 'Default' })).toBe('Opens a.example in Chrome (Default)');
    expect(describeAction({ type: 'app', target: 'C:\\Apps\\Spotify.exe' })).toBe('Opens Spotify.exe');
    expect(describeAction(blankAction('sound'))).toBe('Plays a sound');
  });
});

describe('moveItem', () => {
  it('moves within bounds', () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 1, -5)).toEqual([2, 1, 3]);
  });
});

describe('files sent to the deck', () => {
  it('sorts names into sounds, scripts and pictures', () => {
    expect(fileKindOf('Cheer (loud).mp3')).toBe('sound');
    expect(fileKindOf('morning.ps1')).toBe('script');
    expect(fileKindOf('My Photo 2024.JPG')).toBe('picture');
    expect(fileKindOf('logo.svg')).toBeNull();
    expect(fileKindOf('a&b.ps1')).toBeNull();
  });
  it('names pictures plainly and crops the centred square', () => {
    expect(newPictureName('webp', () => 'Ab-12/cd')).toBe('pic-Ab12cd.webp');
    expect(newPictureName('png', () => '')).toBe('pic-x.png');
    expect(coverCrop(400, 200)).toEqual({ sx: 100, sy: 0, side: 200 });
    expect(coverCrop(300, 500)).toEqual({ sx: 0, sy: 100, side: 300 });
    expect(pictureUrl('pic-a.webp')).toBe('/api/deck/pictures/pic-a.webp');
  });
  it('offers what the PC has and what was uploaded, once each', () => {
    const o = overview({ files: [
      { kind: 'sound', name: 'cheer.mp3', sha256: 'x', size: 1, updatedAt: '' },
      { kind: 'sound', name: 'applause.wav', sha256: 'y', size: 1, updatedAt: '' },
      { kind: 'script', name: 'morning.ps1', sha256: 'z', size: 1, updatedAt: '' },
    ] }, { sounds: ['applause.wav', 'boo.ogg'] });
    expect(offeredFiles(o, 'sound')).toEqual(['applause.wav', 'boo.ogg', 'cheer.mp3']);
    expect(offeredFiles(o, 'script')).toEqual(['morning.ps1']);
  });
});

describe('layoutKey', () => {
  it('ignores key order and pictures left undefined', () => {
    const b = newButton('a');
    const fromEditor = { ...b, picture: 'pic-a.webp' };
    const fromServer = { id: b.id, label: b.label, icon: b.icon, color: b.color, picture: 'pic-a.webp', action: b.action };
    expect(layoutKey(4, [fromEditor])).toBe(layoutKey(4, [fromServer]));
    expect(layoutKey(4, [{ ...b, picture: undefined }])).toBe(layoutKey(4, [b]));
    expect(layoutKey(4, [b])).not.toBe(layoutKey(5, [b]));
  });
});
