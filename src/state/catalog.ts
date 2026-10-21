import { useEffect } from 'react';
import { create } from 'zustand';
import { registerCatalog, type Card, type CardSet, type Rarity, type SetKind, type Variant } from '../domain/cards';

/**
 * Keeps the card catalog current: the server's daily-synced copy of every set (GET /api/cards/catalog), cached in
 * this browser so it is there at once on the next start. Until it arrives the bundled OP-01 snapshot is used.
 */

type WireCard = [string, string, string, string, Rarity, Variant, string, string, number | null];
interface WireCatalog {
  syncedAt: string | null;
  sets: { id: string; name: string; kind: SetKind; position: number; cards: WireCard[] }[];
}

const KEY = 'lifeos.v1.catalog';

export const fromWire = (w: WireCatalog): CardSet[] =>
  w.sets.map((s) => ({
    id: s.id, name: s.name, kind: s.kind, position: s.position,
    cards: s.cards.map(([id, img, number, name, rarity, variant, color, type, price]): Card => ({ id, img, number, name, rarity, variant, color, type, price })),
  }));

interface CatalogState {
  /** Bumped whenever the catalog changes, so screens showing cards re-render. */
  version: number;
  source: 'bundled' | 'cache' | 'server';
  syncedAt: string | null;
}

export const useCatalog = create<CatalogState>(() => ({ version: 0, source: 'bundled', syncedAt: null }));

function apply(w: WireCatalog, source: CatalogState['source']) {
  const sets = fromWire(w);
  if (!sets.length) return false;
  registerCatalog(sets);
  useCatalog.setState((s) => ({ version: s.version + 1, source, syncedAt: w.syncedAt }));
  return true;
}

let cachedEtag: string | null = null;

/** The copy saved by an earlier visit, if any. Runs once at startup. */
export function loadCachedCatalog() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const { etag, catalog } = JSON.parse(raw) as { etag: string; catalog: WireCatalog };
    if (apply(catalog, 'cache')) cachedEtag = etag;
  } catch { /* no or unreadable cache: keep the bundled snapshot */ }
}

/** Asks the server for a newer catalog. A 304 (unchanged) costs almost nothing. Failures keep what we have. */
export async function refreshCatalog() {
  try {
    const res = await fetch('/api/cards/catalog', {
      credentials: 'same-origin',
      headers: cachedEtag ? { 'if-none-match': cachedEtag } : undefined,
    });
    if (res.status === 304 || !res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return;
    const catalog = (await res.json()) as WireCatalog;
    const etag = res.headers.get('etag');
    if (!apply(catalog, 'server') || !etag) return;
    cachedEtag = etag;
    try { localStorage.setItem(KEY, JSON.stringify({ etag, catalog })); } catch { /* storage full: still in memory */ }
  } catch { /* offline: keep the cached or bundled catalog */ }
}

/** Loads the cached catalog at once, then checks the server while signed in (and again when the tab comes back). */
export function useCatalogSync(signedIn: boolean) {
  useEffect(() => { loadCachedCatalog(); }, []);
  useEffect(() => {
    if (!signedIn) return;
    void refreshCatalog();
    const onVis = () => document.visibilityState === 'visible' && void refreshCatalog();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [signedIn]);
}
