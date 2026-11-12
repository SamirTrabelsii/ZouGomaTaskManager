// What a right-click capture saves. Pure, so it is unit-tested in capture.test.js.
const MAX_TITLE = 200;
const MAX_NOTES = 2000;

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** Cuts at a word boundary and marks the cut. */
function clip(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + '…';
}
function shortUrl(url) {
  try { const u = new URL(url); return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, ''); } catch { return url; }
}
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** What to save from the right-click: selected text, else the link, else the page. The page's address goes in the notes. */
export function taskFrom(info, tab) {
  const page = info.pageUrl || tab?.url || '';
  const selection = oneLine(info.selectionText);
  let title; let notes;
  if (selection) {
    title = clip(selection, MAX_TITLE);
    notes = [page, selection.length > MAX_TITLE ? selection : ''].filter(Boolean).join('\n\n');
  } else if (info.linkUrl) {
    title = clip(`Check ${shortUrl(info.linkUrl)}`, MAX_TITLE);
    notes = [info.linkUrl, page && page !== info.linkUrl ? `Found on ${page}` : ''].filter(Boolean).join('\n');
  } else {
    title = clip(oneLine(tab?.title) || shortUrl(page) || 'Page to look at', MAX_TITLE);
    notes = page;
  }
  return { title, notes: notes.slice(0, MAX_NOTES) };
}

