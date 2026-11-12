# LifeOS Tasks: browser extension

A light popup (or side panel) for the task list: see what is overdue, due today, in progress and coming up; add a task in
one line or from any page with a right-click; tick off, start, edit or delete. Everything else (notes, projects, the room…)
stays in the app. Works in Chrome and Edge (Manifest V3); no build step.

## Install (once per browser)

1. In LifeOS, open **Settings → Browser extension** and create a token (e.g. "Chrome at work"). Copy it: it is shown once.
2. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, click **Load unpacked** and pick this
   `extension/` folder.
3. Pin the extension and open it (or press **Alt+Shift+L**). Enter your LifeOS address, e.g. `https://lifeos-xxxx.onrender.com`,
   and paste the token. The browser asks once to let the extension reach that address.

After a `git pull` that changes this folder, click the reload icon on the extension's card in `chrome://extensions`.

## Side panel

The same list can stay open beside your pages (Chrome 116+, recent Edge):

- from the popup, click **◨** (top right), or
- press **Alt+Shift+K**, or
- in Chrome, open the side panel (the panel icon next to the address bar) and pick **LifeOS Tasks** in its menu.

The panel stays open as you switch tabs and refreshes when you come back to it (at most every 15 s, never on a timer).
Shortcuts can be changed at `chrome://extensions/shortcuts`.

## Adding a task

Type it in one go and press Enter; what was understood shows under the field before you send it.

| You type | It means |
|---|---|
| `aujourd'hui`, `today`, `demain`, `tomorrow`, `après-demain` | due that day |
| `lundi` … `dimanche`, `monday` … `sunday` (also `vendredi prochain`, `next friday`) | the next one, never today |
| `le 20`, `on the 3rd` | that day this month, or next month if it has passed |
| `24/11`, `24/11/2027`, `2027-01-02` | that date (a past day/month means next year) |
| `dans 3 jours`, `in 2 weeks`, `semaine prochaine`, `next week` | counted from today; next week = next Monday |
| `#perso` | the scope named Perso (case and accents ignored; the start of the name is enough) |
| `!` (alone or at the end) | high priority |

Example: `Appeler la banque demain #perso !`. While you type `#…`, matching scopes are suggested: **Tab** takes the first.
If a scope is selected in the header and you don't type one, the task goes into it.

## Adding from a page (right-click)

Select text, or right-click a link or anywhere on a page, then **Add to LifeOS** (or **Add to LifeOS, due today**):

- selected text → the title (cut at 200 characters; the whole selection goes in the notes);
- a link → "Check example.com/…", with the link and the page it was on in the notes;
- the page → its title.

The page address goes in the task's notes and shows as 🔗 in the list, so you can get back to the mail, ticket or alert.
The icon flashes ✓ when it is saved (or ! with the reason in its tooltip).

## Editing

- Click a task's title to edit it in place: title, due date, priority, scope, status. **Blocked** asks what it waits on,
  **On hold** asks when it comes back. Enter or **Save** keeps it, Esc cancels.
- **Delete** hides it at once with an **Undo** for 5 seconds; only then (or when the popup closes) is it deleted.
- The circle marks a task done (and back); ▶ / ⏸ moves it to and from *In progress*.
- Blocked and on-hold tasks sit in the collapsed **Waiting** group.

## Good to know

- The icon's badge shows how many tasks are overdue or due today (updated when you open the popup).
- On Render's free plan the first call after a quiet spell can take up to a minute while the server wakes.

## How it connects

- It calls `/api/extension/tasks` with `Authorization: Bearer <token>`. That token's scope is `tasks`: it opens the task
  list and nothing else (no notes or journal, alerts, absences, or the full data). A task's own notes are not sent to
  the extension, only their first web link. Agent tokens do not work here, and
  extension tokens do not work for the agent.
- The token is kept in the extension's local storage on this computer. Lost the laptop? Revoke the token in Settings.
- Changes bump the data revision. An open LifeOS tab reloads the newer copy when you come back to it, as long as it
  has no unsaved edits of its own (otherwise you get the usual "which copy to keep" choice, with a backup).

Icons are rendered from `public/icon.svg` by `node scripts/extension-icons.mjs` (uses the Edge installed on Windows).
