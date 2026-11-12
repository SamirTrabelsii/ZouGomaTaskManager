// Only job: the keyboard shortcut that opens the task list in the browser's side panel.
// (The popup has its own "open in side panel" button.) No polling here, so the LifeOS server can sleep.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-side-panel' || !tab?.windowId) return;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => { /* older browser without sidePanel.open */ });
});
