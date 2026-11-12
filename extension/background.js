// Background worker: the right-click "Add to LifeOS" menu and the side-panel shortcut.
// It never polls, so the LifeOS server can sleep.
import { taskFrom, ymd } from './capture.js';

const MENU = [
  { id: 'add', title: 'Add to LifeOS' },
  { id: 'add-today', title: 'Add to LifeOS, due today' },
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const m of MENU) chrome.contextMenus.create({ id: m.id, title: m.title, contexts: ['selection', 'link', 'page'] });
  });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-side-panel' || !tab?.windowId) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => { /* older browser without sidePanel.open */ });
});

chrome.contextMenus.onClicked.addListener((info, tab) => { void capture(info, tab); });

/** Shows a short sign on the icon, then puts back what was there (the count of tasks for today). */
async function flash(text, color, title, before) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  if (title) await chrome.action.setTitle({ title });
  setTimeout(() => { void chrome.action.setBadgeText({ text: before }); void chrome.action.setTitle({ title: 'LifeOS tasks' }); }, 4000);
}

async function capture(info, tab) {
  const { server, token } = await chrome.storage.local.get(['server', 'token']);
  const before = await chrome.action.getBadgeText({}).catch(() => '');
  if (!server || !token) {
    await flash('?', '#d9553f', 'Connect LifeOS first: open the extension and paste your token.', before);
    chrome.action.openPopup?.().catch(() => {});
    return;
  }
  const body = taskFrom(info, tab);
  if (info.menuItemId === 'add-today') body.dueDate = ymd(new Date());
  await chrome.action.setBadgeText({ text: '…' });
  try {
    const res = await fetch(`${server}/api/extension/tasks`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw new Error(res.status === 401 ? 'The token was revoked or is wrong. Connect again.' : j?.error ?? `LifeOS answered ${res.status}.`);
    }
    await chrome.storage.local.set({ captured: Date.now() }); // an open side panel refreshes on this
    await flash('✓', '#4f8a3c', `Added to LifeOS: ${body.title}`, before);
  } catch (e) {
    await flash('!', '#d9553f', `Not added: ${e instanceof TypeError ? 'can’t reach LifeOS.' : e.message}`, before);
  }
}
