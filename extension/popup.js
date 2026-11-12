// LifeOS Tasks: the popup and the side panel (same page; the panel adds ?panel=1).
// Talks to /api/extension/tasks with a bearer token of scope 'tasks' (Settings → Browser extension). No build step.
import { parseQuickAdd, matchScopes, ymd } from './parse.js';

const $ = (id) => document.getElementById(id);
const ext = typeof chrome !== 'undefined' && chrome.storage?.local ? chrome : null;
const isPanel = new URLSearchParams(location.search).has('panel');
document.documentElement.classList.toggle('panel', isPanel);

/* ── storage (chrome.storage in the extension, localStorage when the page is opened directly for a preview) ── */
const store = {
  async get(keys) {
    if (ext) return ext.storage.local.get(keys);
    const out = {};
    for (const k of keys) { try { const v = localStorage.getItem('lifeos-ext.' + k); if (v !== null) out[k] = JSON.parse(v); } catch { /* blocked */ } }
    return out;
  },
  async set(obj) {
    if (ext) return ext.storage.local.set(obj);
    for (const [k, v] of Object.entries(obj)) { try { localStorage.setItem('lifeos-ext.' + k, JSON.stringify(v)); } catch { /* blocked */ } }
  },
  async remove(keys) {
    if (ext) return ext.storage.local.remove(keys);
    for (const k of keys) { try { localStorage.removeItem('lifeos-ext.' + k); } catch { /* blocked */ } }
  },
};

/* ── dates, in the computer's own time zone ── */
const today = () => ymd(new Date());
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
function dueLabel(due) {
  if (!due) return '';
  if (due === today()) return 'Today';
  if (due === plusDays(1)) return 'Tomorrow';
  if (due === plusDays(-1)) return 'Yesterday';
  const d = new Date(`${due}T12:00:00`);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

/* ── state ── */
let cfg = { server: '', token: '' };
let state = { tasks: [], scopes: [], projects: [] };
let scopeFilter = '';
let editingId = null;
/** Deletes waiting for their undo window to pass: id → { task, index, timer }. */
const pendingDeletes = new Map();
const UNDO_MS = 5000;

/* ── API ── */
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function api(path, { method = 'GET', body, keepalive = false } = {}) {
  const ctrl = new AbortController();
  // Render's free plan sleeps: the first call can take ~50 s while it wakes
  const slow = keepalive ? null : setTimeout(() => showStatus('Waking the LifeOS server… this can take up to a minute.'), 3000);
  const stop = setTimeout(() => ctrl.abort(), 70_000);
  let res;
  try {
    res = await fetch(`${cfg.server}/api/extension${path}`, {
      method,
      headers: { authorization: `Bearer ${cfg.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'omit', cache: 'no-store', keepalive, signal: keepalive ? undefined : ctrl.signal,
    });
  } catch {
    throw new ApiError(0, 'Can’t reach LifeOS. Check your connection or the server address.');
  } finally { clearTimeout(slow); clearTimeout(stop); }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) throw new ApiError(401, 'This token was revoked or is wrong. Connect again.');
    throw new ApiError(res.status, json?.error ?? `LifeOS answered ${res.status}.`);
  }
  hideStatus();
  return json;
}
const saveCache = () => store.set({ cache: state });

/* ── status line ── */
function showStatus(text, error = false) { const s = $('status'); s.textContent = text; s.classList.toggle('error', error); s.hidden = false; }
function hideStatus() { $('status').hidden = true; }
function fail(e) {
  showStatus(e.message, true);
  if (e.status === 401) openSetup(e.message);
}

/* ── small DOM helpers ── */
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k in n && typeof v !== 'string') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids.filter((k) => k !== null && k !== undefined && k !== false));
  return n;
}
const scopeById = (id) => state.scopes.find((s) => s.id === id);
const scopeLabel = (s) => `${s.icon} ${s.title}`;

/* ── grouping ── */
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const byDueThenPriority = (a, b) =>
  (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

function groups() {
  const t = today();
  const soon = plusDays(7);
  const visible = state.tasks.filter((x) => !pendingDeletes.has(x.id) && (!scopeFilter || x.scopeId === scopeFilter));
  const open = visible.filter((x) => x.status === 'todo' || x.status === 'doing');
  const overdue = open.filter((x) => x.dueDate && x.dueDate < t).sort(byDueThenPriority);
  const dueToday = open.filter((x) => x.dueDate === t).sort(byDueThenPriority);
  const doing = open.filter((x) => x.status === 'doing' && !overdue.includes(x) && !dueToday.includes(x)).sort(byDueThenPriority);
  const shown = new Set([...overdue, ...dueToday, ...doing]);
  const rest = open.filter((x) => !shown.has(x));
  const upcoming = rest.filter((x) => x.dueDate && x.dueDate <= soon).sort(byDueThenPriority);
  const later = rest.filter((x) => !upcoming.includes(x)).sort(byDueThenPriority);
  const waiting = visible.filter((x) => x.status === 'blocked' || x.status === 'onhold')
    .sort((a, b) => (a.resumeOn ?? '9999').localeCompare(b.resumeOn ?? '9999'));
  const done = visible.filter((x) => x.status === 'done').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  return { overdue, dueToday, doing, upcoming, later, waiting, done };
}

/* ── one task ── */
function taskItem(t) {
  const li = el('li', {
    class: `task${t.status === 'done' ? ' done' : ''}${t.status === 'doing' ? ' is-doing' : ''}${t.priority === 'high' ? ' high' : ''}`,
  });
  const doneLabel = t.status === 'done' ? 'Mark as not done' : 'Mark as done';
  const check = el('button', {
    class: 'check', text: t.status === 'done' ? '✓' : '', title: doneLabel, 'aria-label': `${doneLabel}: ${t.title}`,
    onclick: () => void save(t, { status: t.status === 'done' ? 'todo' : 'done' }),
  });

  if (editingId === t.id) { li.append(check, el('div', { class: 'body' }, editor(t))); return li; }

  const bits = [];
  if (t.status === 'doing') bits.push(el('span', { class: 'doing', text: 'In progress' }));
  if (t.status === 'blocked') bits.push(el('span', { class: 'wait', text: t.blockedBy ? `Blocked: ${t.blockedBy}` : 'Blocked' }));
  if (t.status === 'onhold') bits.push(el('span', { class: 'wait', text: t.resumeOn ? `On hold until ${dueLabel(t.resumeOn)}` : 'On hold' }));
  if (t.dueDate && t.status !== 'done') bits.push(el('span', { class: t.dueDate < today() ? 'late' : '', text: dueLabel(t.dueDate) }));
  const scope = scopeById(t.scopeId);
  if (scope && !scopeFilter) bits.push(el('span', { text: scopeLabel(scope) }));
  const project = state.projects.find((p) => p.id === t.projectId);
  if (project) bits.push(el('span', { text: `▣ ${project.title}` }));
  if (t.priority === 'high' && t.status !== 'done') bits.push(el('span', { class: 'late', text: 'High' }));
  if (t.link) bits.push(el('a', { class: 'link', href: t.link, target: '_blank', rel: 'noopener noreferrer', title: t.link, text: `🔗 ${hostOf(t.link)}` }));

  const body = el('div', { class: 'body' },
    el('button', { class: 'title-btn', text: t.title, title: 'Edit', 'aria-label': `Edit: ${t.title}`, onclick: () => startEdit(t.id) }),
    bits.length ? el('div', { class: 'meta' }, ...bits) : null);
  li.append(check, body);

  if (t.status === 'todo' || t.status === 'doing') {
    const label = t.status === 'doing' ? 'Back to to-do' : 'Start (in progress)';
    li.append(el('button', {
      class: 'play', text: t.status === 'doing' ? '⏸' : '▶', title: label, 'aria-label': `${label}: ${t.title}`,
      onclick: () => void save(t, { status: t.status === 'doing' ? 'todo' : 'doing' }),
    }));
  }
  return li;
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'link'; } }

/* ── inline editor ── */
const STATUS_LABELS = { todo: 'To do', doing: 'In progress', blocked: 'Blocked', onhold: 'On hold', done: 'Done' };
function editor(t) {
  const title = el('input', { value: t.title, maxlength: '200', 'aria-label': 'Title', required: true });
  const due = el('input', { type: 'date', value: t.dueDate ?? '', 'aria-label': 'Due date' });
  const priority = el('select', { 'aria-label': 'Priority' },
    ...['low', 'medium', 'high'].map((p) => new Option(p[0].toUpperCase() + p.slice(1), p, false, p === t.priority)));
  const scope = el('select', { 'aria-label': 'Scope' },
    new Option('No scope', ''), ...state.scopes.map((s) => new Option(scopeLabel(s), s.id, false, s.id === t.scopeId)));
  const status = el('select', { 'aria-label': 'Status' },
    ...Object.entries(STATUS_LABELS).map(([v, l]) => new Option(l, v, false, v === t.status)));
  const blockedBy = el('input', { value: t.blockedBy ?? '', maxlength: '200', placeholder: 'Waiting on…', 'aria-label': 'Waiting on' });
  const resumeOn = el('input', { type: 'date', value: t.resumeOn ?? '', 'aria-label': 'Back on' });
  const blockedRow = el('label', {}, 'Waiting on', blockedBy);
  const resumeRow = el('label', {}, 'Back on', resumeOn);
  const syncStatus = () => { blockedRow.hidden = status.value !== 'blocked'; resumeRow.hidden = status.value !== 'onhold'; };
  status.addEventListener('change', syncStatus);
  syncStatus();

  const form = el('form', { class: 'editor', onsubmit: (e) => {
    e.preventDefault();
    const patch = {};
    const nt = title.value.trim().replace(/\s+/g, ' ');
    if (!nt) { title.focus(); return; }
    if (nt !== t.title) patch.title = nt;
    if ((due.value || null) !== t.dueDate) patch.dueDate = due.value || null;
    if (priority.value !== t.priority) patch.priority = priority.value;
    if ((scope.value || null) !== t.scopeId) patch.scopeId = scope.value || null;
    if (status.value !== t.status) patch.status = status.value;
    if (status.value === 'blocked' && blockedBy.value.trim() !== (t.blockedBy ?? '')) patch.blockedBy = blockedBy.value.trim();
    if (status.value === 'onhold' && (resumeOn.value || null) !== (t.resumeOn ?? null)) patch.resumeOn = resumeOn.value || null;
    editingId = null;
    if (Object.keys(patch).length) void save(t, patch); else render();
  } },
    title,
    el('div', { class: 'three' }, el('label', {}, 'Due', due), el('label', {}, 'Priority', priority), el('label', {}, 'Scope', scope)),
    el('div', { class: 'two' }, el('label', {}, 'Status', status), blockedRow, resumeRow),
    el('div', { class: 'actions' },
      el('button', { type: 'button', class: 'btn ghost danger', text: 'Delete', onclick: () => remove(t) }),
      el('span', { class: 'grow' }),
      el('button', { type: 'button', class: 'btn ghost', text: 'Cancel', onclick: () => { editingId = null; render(); } }),
      el('button', { class: 'btn primary', text: 'Save' })));
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editingId = null; render(); } });
  queueMicrotask(() => { title.focus(); title.select(); });
  return form;
}
function startEdit(id) { editingId = id; render(); }

/* ── lists ── */
function group(label, tasks, cls = '', collapsible = false) {
  if (!tasks.length) return null;
  const h = el('h2', {}, label + ' ', el('span', { class: 'n', text: String(tasks.length) }));
  const ul = el('ul', {}, ...tasks.map(taskItem));
  // keep a collapsed group open while one of its tasks is being edited
  const open = collapsible && tasks.some((t) => t.id === editingId);
  return collapsible
    ? el('details', { class: `group ${cls}`, open }, el('summary', {}, h), ul)
    : el('section', { class: `group ${cls}` }, h, ul);
}

function render() {
  const g = groups();
  const parts = [
    group('Overdue', g.overdue, 'overdue'),
    group('Today', g.dueToday, 'today'),
    group('In progress', g.doing),
    group('Next 7 days', g.upcoming),
    group('Later', g.later, '', g.overdue.length + g.dueToday.length + g.doing.length + g.upcoming.length > 0 && g.later.length > 6),
    group('Waiting', g.waiting, '', true),
    group('Done recently', g.done, '', true),
  ].filter(Boolean);
  $('lists').replaceChildren(...(parts.length ? parts : [el('p', { class: 'empty', text: 'Nothing on your list. Enjoy it, or add a task above.' })]));

  const focus = g.overdue.length + g.dueToday.length;
  $('summary').textContent = focus ? `${focus} for today` : '';
  if (ext?.action) {
    ext.action.setBadgeText({ text: focus ? String(focus) : '' });
    ext.action.setBadgeBackgroundColor({ color: g.overdue.length ? '#d9553f' : '#b8651a' });
  }

  const sel = $('scope');
  sel.hidden = state.scopes.length === 0;
  if (scopeFilter && !state.scopes.some((s) => s.id === scopeFilter)) scopeFilter = '';
  sel.replaceChildren(new Option('All scopes', ''), ...state.scopes.map((s) => new Option(scopeLabel(s), s.id, false, s.id === scopeFilter)));
  renderHint();
}

/* ── quick add: live preview of what was understood ── */
function parsed() { return parseQuickAdd($('title').value, { scopes: state.scopes }); }
function renderHint() {
  const hint = $('hint');
  const text = $('title').value;
  if (!text.trim()) { hint.replaceChildren(); return; }
  const p = parsed();
  if (p.scopeQuery !== null) {
    const hits = matchScopes(p.scopeQuery, state.scopes).slice(0, 6);
    hint.replaceChildren(...(hits.length
      ? hits.map((s, i) => el('button', { type: 'button', class: 'chip', text: scopeLabel(s), title: i === 0 ? 'Tab to pick' : undefined, onclick: () => pickScope(s) }))
      : [el('span', { class: 'chip', text: state.scopes.length ? 'No scope with that name' : 'No scopes yet: create them in LifeOS' })]));
    return;
  }
  const chips = [];
  if (p.dueDate) chips.push(el('span', { class: 'chip date', text: `📅 ${dueLabel(p.dueDate)}` }));
  const s = scopeById(p.scopeId ?? scopeFilter);
  if (s) chips.push(el('span', { class: 'chip', text: scopeLabel(s) }));
  if (p.priority === 'high') chips.push(el('span', { class: 'chip high', text: '! High' }));
  hint.replaceChildren(...chips);
}
function pickScope(scope) {
  const input = $('title');
  const word = scope.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  input.value = input.value.replace(/#[^\s#]*$/u, `#${word} `);
  input.focus();
  renderHint();
}

async function addTask(e) {
  e.preventDefault();
  const input = $('title');
  const p = parsed();
  if (!p.title) return;
  const body = { title: p.title.slice(0, 200), dueDate: p.dueDate };
  if (p.priority) body.priority = p.priority;
  const scopeId = p.scopeId ?? (scopeFilter || null);
  if (scopeId) body.scopeId = scopeId;
  input.disabled = true;
  try {
    const r = await api('/tasks', { method: 'POST', body });
    state.tasks.unshift(r.task);
    void saveCache();
    input.value = '';
    render();
  } catch (x) { fail(x); } finally { input.disabled = false; input.focus(); }
}

/* ── edits ── */
async function refresh() {
  try {
    const r = await api('/tasks');
    state = { tasks: r.tasks, scopes: r.scopes, projects: r.projects };
    void saveCache();
    if (!editingId) render(); // never wipe a half-typed edit
  } catch (e) { fail(e); }
}

async function save(task, patch) {
  const before = { ...task };
  // optimistic: the list answers at once, and goes back if the server says no
  Object.assign(task, patch);
  if (patch.status && patch.status !== before.status) task.completedAt = patch.status === 'done' ? new Date().toISOString() : null;
  render();
  try {
    const r = await api(`/tasks/${encodeURIComponent(task.id)}`, { method: 'PATCH', body: patch });
    Object.assign(task, r.task);
    void saveCache();
    render();
  } catch (e) {
    Object.assign(task, before);
    render();
    fail(e);
  }
}

/** Hides the task at once and offers an undo; the server only hears about it when the undo window closes (or the popup does). */
function remove(task) {
  editingId = null;
  const timer = setTimeout(() => void sendDelete(task.id), UNDO_MS);
  pendingDeletes.set(task.id, { task, timer });
  $('undoText').textContent = `Deleted “${task.title}”`;
  $('undo').hidden = false;
  $('undoBtn').onclick = () => {
    clearTimeout(timer);
    pendingDeletes.delete(task.id);
    $('undo').hidden = true;
    render();
  };
  render();
}
async function sendDelete(id, keepalive = false) {
  if (!pendingDeletes.has(id)) return;
  pendingDeletes.delete(id);
  if (!pendingDeletes.size) $('undo').hidden = true;
  try {
    await api(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE', body: {}, keepalive });
    state.tasks = state.tasks.filter((t) => t.id !== id);
    void saveCache();
  } catch (e) {
    if (e.status === 404) { state.tasks = state.tasks.filter((t) => t.id !== id); return; } // already gone
    fail(e);
    render(); // it comes back
  }
}
// The popup closes as soon as it loses focus: send what is still waiting.
window.addEventListener('pagehide', () => {
  for (const [id, { timer }] of pendingDeletes) { clearTimeout(timer); void sendDelete(id, true); }
});

function openApp() {
  if (!cfg.server) return;
  if (ext?.tabs) ext.tabs.create({ url: cfg.server + '/' });
  else window.open(cfg.server + '/', '_blank', 'noopener');
}

/* ── setup ── */
function openSetup(error = '') {
  $('main').hidden = true;
  $('setup').hidden = false;
  $('server').value = cfg.server;
  $('token').value = '';
  $('cancelSetup').hidden = !cfg.token;
  $('disconnect').hidden = !cfg.token;
  $('setupError').textContent = error;
  $('setupError').hidden = !error;
  (cfg.server ? $('token') : $('server')).focus();
}
function closeSetup() { $('setup').hidden = true; $('main').hidden = false; $('title').focus(); }

function normalizeServer(raw) {
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null; // the token must not travel in clear
  return u.origin;
}

async function connect(e) {
  e.preventDefault();
  const err = $('setupError');
  const server = normalizeServer($('server').value);
  const token = $('token').value.trim();
  if (!server) { err.textContent = 'Use the https:// address of your LifeOS (http only for localhost).'; err.hidden = false; return; }
  if (!token) { err.textContent = 'Paste the token from Settings → Browser extension.'; err.hidden = false; return; }
  // the extension may only talk to the server you name here
  if (ext?.permissions) {
    const ok = await ext.permissions.request({ origins: [`${server}/*`] }).catch(() => false);
    if (!ok) { err.textContent = 'Chrome needs your OK to let the extension reach that server.'; err.hidden = false; return; }
  }
  const btn = $('connect');
  btn.disabled = true; btn.textContent = 'Connecting…';
  const prev = cfg;
  cfg = { server, token };
  try {
    const r = await api('/tasks');
    state = { tasks: r.tasks, scopes: r.scopes, projects: r.projects };
    await store.set({ server, token, cache: state });
    closeSetup();
    render();
  } catch (x) {
    cfg = prev;
    err.textContent = x.message; err.hidden = false;
  } finally { btn.disabled = false; btn.textContent = 'Connect'; }
}

async function disconnect() {
  await store.remove(['token', 'cache']);
  if (ext?.action) ext.action.setBadgeText({ text: '' });
  cfg = { server: cfg.server, token: '' };
  state = { tasks: [], scopes: [], projects: [] };
  openSetup();
}

/* ── wiring ── */
$('add').addEventListener('submit', addTask);
$('title').addEventListener('input', renderHint);
$('title').addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.shiftKey && parsed().scopeQuery !== null) {
    const first = matchScopes(parsed().scopeQuery, state.scopes)[0];
    if (first) { e.preventDefault(); pickScope(first); }
  }
});
$('setupForm').addEventListener('submit', connect);
$('cancelSetup').addEventListener('click', closeSetup);
$('disconnect').addEventListener('click', () => void disconnect());
$('gear').addEventListener('click', () => openSetup());
$('open').addEventListener('click', openApp);
$('scope').addEventListener('change', (e) => { scopeFilter = e.target.value; void store.set({ scopeFilter }); render(); });

// Popup → side panel. sidePanel.open must run inside the click itself, so the window id is looked up beforehand.
let windowId = null;
if (!isPanel && ext?.sidePanel?.open && ext.windows) {
  ext.windows.getCurrent().then((w) => { windowId = w.id; $('panel').hidden = false; }).catch(() => {});
  $('panel').addEventListener('click', () => {
    if (windowId === null) return;
    ext.sidePanel.open({ windowId }).then(() => window.close()).catch((e) => showStatus(`Couldn’t open the side panel: ${e.message}`, true));
  });
}
// The side panel stays open while you browse: refresh when you come back to it (never on a timer, so the server can sleep).
if (isPanel) {
  let last = Date.now();
  const again = () => {
    if (document.visibilityState !== 'visible' || !cfg.token || !$('setup').hidden || Date.now() - last < 15_000) return;
    last = Date.now();
    void refresh();
  };
  document.addEventListener('visibilitychange', again);
  window.addEventListener('focus', again);
}
// A task captured from a page (right-click menu) lands while the panel is open: show it.
ext?.storage?.onChanged?.addListener((changes, area) => {
  if (area === 'local' && changes.captured && cfg.token && !$('main').hidden) void refresh();
});

/* ── start ── */
const saved = await store.get(['server', 'token', 'cache', 'scopeFilter']);
cfg = { server: saved.server ?? '', token: saved.token ?? '' };
scopeFilter = saved.scopeFilter ?? '';
if (!cfg.server || !cfg.token) openSetup();
else {
  $('main').hidden = false;
  if (saved.cache) { state = saved.cache; render(); } // last known list at once, then the fresh one
  $('title').focus();
  void refresh();
}
