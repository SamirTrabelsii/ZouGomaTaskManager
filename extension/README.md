# LifeOS Tasks: browser extension

A light popup for the task list: see what is overdue, due today, in progress and coming up; tick tasks off; start one; add one.
Everything else (notes, projects, the room…) stays in the app. Works in Chrome and Edge (Manifest V3); no build step.

## Install (once per browser)

1. In LifeOS, open **Settings → Browser extension** and create a token (e.g. "Chrome at work"). Copy it: it is shown once.
2. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, click **Load unpacked** and pick this
   `extension/` folder.
3. Pin the extension and open it (or press **Alt+Shift+L**). Enter your LifeOS address, e.g. `https://lifeos-xxxx.onrender.com`,
   and paste the token. The browser asks once to let the extension reach that address.

After a `git pull` that changes this folder, click the reload icon on the extension's card in `chrome://extensions`.

## Using it

- Type a task and press Enter. Pick **Today** / **Tomorrow** for a due date; end the title with `!` for high priority.
  If a scope is selected in the header, the new task goes into it.
- The circle marks a task done (and back); ▶ / ⏸ moves it to and from *In progress*.
- Blocked and on-hold tasks are only counted: they need a note or a date, so change them in the app.
- The icon's badge shows how many tasks are overdue or due today (updated when you open the popup).
- On Render's free plan the first call after a quiet spell can take up to a minute while the server wakes.

## How it connects

- It calls `/api/extension/tasks` with `Authorization: Bearer <token>`. That token's scope is `tasks`: it opens the task
  list and nothing else (no notes, journal, alerts, absences, or the full data). Agent tokens do not work here, and
  extension tokens do not work for the agent.
- The token is kept in the extension's local storage on this computer. Lost the laptop? Revoke the token in Settings.
- Changes bump the data revision. An open LifeOS tab reloads the newer copy when you come back to it, as long as it
  has no unsaved edits of its own (otherwise you get the usual "which copy to keep" choice, with a backup).

Icons are rendered from `public/icon.svg` by `node scripts/extension-icons.mjs` (uses the Edge installed on Windows).
