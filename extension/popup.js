// LifeOS Tasks popup. Talks to /api/extension/tasks with a bearer token of scope 'tasks' (Settings → Browser extension).
// No build step and no libraries: load the folder as an unpacked extension.

const $ = (id) => document.getElementById(id);
const ext = typeof chrome !== 'undefined' && chrome.storage?.local ? chrome : null;

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
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date());
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
function dueLabel(due) {
  if (!due) return '';
  const t = today();
  if (due === t) return 'Today';
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

/* ── API ── */
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function api(path, { method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  // Render's free plan sleeps: the first call can take ~50 s while it wakes
  const slow = setTimeout(() => showStatus('Waking the LifeOS server… this can take up to a minute.'), 3000);
  const stop = setTimeout(() => ctrl.abort(), 70_000);
  let res;
  try {
    res = await fetch(`${cfg.server}/api/extension${path}`, {
      method,
      headers: { authorization: `Bearer ${cfg.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'omit',
      cache: 'no-store',
      signal: ctrl.signal,
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

/* ── status line ── */
function showStatus(text, error = false) { const s = $('status'); s.textContent = text; s.classList.toggle('error', error); s.hidden = false; }
function hideStatus() { $('status').hidden = true; }
function fail(e) {
  showStatus(e.message, true);
  if (e.status === 401) openSetup(e.message);
}

/* ── rendering ── */
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const byDueThenPriority = (a, b) =>
  (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

function groups() {
  const t = today();
  const soon = plusDays(7);
  const visible = state.tasks.filter((x) => !scopeFilter || x.scopeId === scopeFilter);
  const open = visible.filter((x) => x.status === 'todo' || x.status === 'doing');
  const overdue = open.filter((x) => x.dueDate && x.dueDate < t).sort(byDueThenPriority);
  const dueToday = open.filter((x) => x.dueDate === t).sort(byDueThenPriority);
  const doing = open.filter((x) => x.status === 'doing' && !overdue.includes(x) && !dueToday.includes(x)).sort(byDueThenPriority);
  const shown = new Set([...overdue, ...dueToday, ...doing]);
  const rest = open.filter((x) => !shown.has(x));
  const upcoming = rest.filter((x) => x.dueDate && x.dueDate <= soon).sort(byDueThenPriority);
  const later = rest.filter((x) => !upcoming.includes(x)).sort(byDueThenPriority);
  const done = visible.filter((x) => x.status === 'done').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  const waiting = visible.filter((x) => x.status === 'blocked' || x.status === 'onhold').length;
  return { overdue, dueToday, doing, upcoming, later, done, waiting };
}

function taskItem(t) {
  const li = document.createElement('li');
  li.className = `task${t.status === 'done' ? ' done' : ''}${t.status === 'doing' ? ' is-doing' : ''}${t.priority === 'high' ? ' high' : ''}`;

  const check = document.createElement('button');
  check.className = 'check';
  check.textContent = t.status === 'done' ? '✓' : '';
  check.title = t.status === 'done' ? 'Mark as not done' : 'Mark as done';
  check.setAttribute('aria-label', `${check.title}: ${t.title}`);
  check.addEventListener('click', () => void setStatus(t, t.status === 'done' ? 'todo' : 'done'));

  const body = document.createElement('div');
  body.className = 'body';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = t.title;
  body.append(title);

  const bits = [];
  if (t.status === 'doing') bits.push(['doing', 'In progress']);
  if (t.dueDate && t.status !== 'done') bits.push([t.dueDate < today() ? 'late' : '', dueLabel(t.dueDate)]);
  const scope = state.scopes.find((s) => s.id === t.scopeId);
  if (scope && !scopeFilter) bits.push(['', `${scope.icon} ${scope.title}`]);
  const project = state.projects.find((p) => p.id === t.projectId);
  if (project) bits.push(['', `▣ ${project.title}`]);
  if (t.priority === 'high' && t.status !== 'done') bits.push(['late', 'High']);
  if (bits.length) {
    const meta = document.createElement('div');
    meta.className = 'meta';
    for (const [cls, text] of bits) { const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = text; meta.append(s); }
    body.append(meta);
  }
  li.append(check, body);

  if (t.status !== 'done') {
    const play = document.createElement('button');
    play.className = 'play';
    play.textContent = t.status === 'doing' ? '⏸' : '▶';
    play.title = t.status === 'doing' ? 'Back to to-do' : 'Start (in progress)';
    play.setAttribute('aria-label', `${play.title}: ${t.title}`);
    play.addEventListener('click', () => void setStatus(t, t.status === 'doing' ? 'todo' : 'doing'));
    li.append(play);
  }
  return li;
}

function group(label, tasks, cls = '', collapsible = false) {
  if (!tasks.length) return null;
  const wrap = document.createElement(collapsible ? 'details' : 'section');
  wrap.className = `group ${cls}`;
  const h = document.createElement('h2');
  h.append(label + ' ');
  const n = document.createElement('span'); n.className = 'n'; n.textContent = String(tasks.length); h.append(n);
  if (collapsible) { const s = document.createElement('summary'); s.append(h); wrap.append(s); } else wrap.append(h);
  const ul = document.createElement('ul');
  for (const t of tasks) ul.append(taskItem(t));
  wrap.append(ul);
  return wrap;
}

function render() {
  const g = groups();
  const lists = $('lists');
  lists.replaceChildren();
  const parts = [
    group('Overdue', g.overdue, 'overdue'),
    group('Today', g.dueToday, 'today'),
    group('In progress', g.doing),
    group('Next 7 days', g.upcoming),
    group('Later', g.later, '', g.overdue.length + g.dueToday.length + g.doing.length + g.upcoming.length > 0 && g.later.length > 6),
    group('Done recently', g.done, '', true),
  ].filter(Boolean);
  if (!parts.length) {
    const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Nothing on your list. Enjoy it, or add a task above.'; lists.append(p);
  } else lists.append(...parts);
  if (g.waiting) {
    const p = document.createElement('p'); p.className = 'foot';
    p.append(`${g.waiting} waiting (blocked or on hold) — `);
    const a = document.createElement('a'); a.href = '#'; a.textContent = 'open in LifeOS';
    a.addEventListener('click', (e) => { e.preventDefault(); openApp(); });
    p.append(a); lists.append(p);
  }

  const focus = g.overdue.length + g.dueToday.length;
  $('summary').textContent = focus ? `${focus} for today` : '';
  if (ext?.action) {
    ext.action.setBadgeText({ text: focus ? String(focus) : '' });
    ext.action.setBadgeBackgroundColor({ color: g.overdue.length ? '#d9553f' : '#b8651a' });
  }

  const sel = $('scope');
  sel.hidden = state.scopes.length === 0;
  sel.replaceChildren(new Option('All scopes', ''), ...state.scopes.map((s) => new Option(`${s.icon} ${s.title}`, s.id)));
  if (scopeFilter && !state.scopes.some((s) => s.id === scopeFilter)) scopeFilter = '';
  sel.value = scopeFilter;
}

/* ── actions ── */
async function refresh() {
  try {
    const r = await api('/tasks');
    state = { tasks: r.tasks, scopes: r.scopes, projects: r.projects };
    await store.set({ cache: state });
    render();
  } catch (e) { fail(e); }
}

async function setStatus(task, status) {
  const before = { ...task };
  // optimistic: the popup answers at once, and goes back if the server says no
  Object.assign(task, { status, completedAt: status === 'done' ? new Date().toISOString() : null });
  render();
  try {
    const r = await api(`/tasks/${encodeURIComponent(task.id)}`, { method: 'PATCH', body: { status } });
    Object.assign(task, r.task);
    await store.set({ cache: state });
    render();
  } catch (e) {
    Object.assign(task, before);
    render();
    fail(e);
  }
}

async function addTask(e) {
  e.preventDefault();
  const input = $('title');
  let title = input.value.trim();
  if (!title) return;
  let priority;
  if (/!\s*$/.test(title)) { priority = 'high'; title = title.replace(/\s*!+\s*$/, ''); }
  if (!title) return;
  const when = $('due').value;
  const body = { title, dueDate: when === 'today' ? today() : when === 'tomorrow' ? plusDays(1) : null };
  if (priority) body.priority = priority;
  if (scopeFilter) body.scopeId = scopeFilter;
  input.disabled = true;
  try {
    const r = await api('/tasks', { method: 'POST', body });
    state.tasks.unshift(r.task);
    await store.set({ cache: state });
    input.value = '';
    render();
  } catch (x) { fail(x); } finally { input.disabled = false; input.focus(); }
}

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
    await store.set({ server, token, cache: { tasks: r.tasks, scopes: r.scopes, projects: r.projects } });
    state = { tasks: r.tasks, scopes: r.scopes, projects: r.projects };
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

/* ── start ── */
$('add').addEventListener('submit', addTask);
$('title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('add').requestSubmit(); } });
$('setupForm').addEventListener('submit', connect);
$('cancelSetup').addEventListener('click', closeSetup);
$('disconnect').addEventListener('click', () => void disconnect());
$('gear').addEventListener('click', () => openSetup());
$('open').addEventListener('click', openApp);
$('scope').addEventListener('change', (e) => { scopeFilter = e.target.value; void store.set({ scopeFilter }); render(); });

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
