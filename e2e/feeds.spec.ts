import { expect, test, type Page } from '@playwright/test';

// Runs after app.spec.ts (alphabetical order, one shared database): the account created there is reused.
test.describe.configure({ mode: 'serial' });

const EMAIL = 'e2e@example.com';
const PASSWORD = 'e2e-correct-horse-battery';
const GOOGLE = 'https://feeds.test/google.ics';
const OUTLOOK = 'webcal://feeds.test/outlook.ics';

const errors: string[] = [];
test.beforeEach(({ page }) => { page.on('pageerror', (e) => errors.push(e.message)); });
test.afterEach(() => { expect(errors, 'uncaught page errors').toEqual([]); });

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}
const openSettings = (page: Page) => page.getByRole('button', { name: 'Settings' }).click();
const closeSettings = (page: Page) => page.getByRole('button', { name: 'Close' }).first().click();
const openMonth = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Calendar' }).click();
const docData = async (page: Page) => (await (await page.request.get('/api/data')).json()) as { data: { events: { title: string }[] } | null };

/** The time label the app should show for a UTC time today, in THIS browser's zone. */
const localLabel = (page: Page, hhmmUtc: string) => page.evaluate((t) => {
  const n = new Date();
  const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), Number(t.slice(0, 2)), Number(t.slice(3))));
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}, hhmmUtc);

test('connect a Google and an Outlook calendar from Settings', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  const feeds = page.getByRole('region', { name: 'Calendar feeds' });
  await expect(feeds.getByText('No calendars connected yet.')).toBeVisible();

  // a link that does not work is explained and nothing is kept
  await feeds.getByLabel('Name', { exact: true }).fill('Broken');
  await feeds.getByLabel('iCal link').fill('https://feeds.test/missing.ics');
  await feeds.getByRole('button', { name: /Connect calendar/ }).click();
  await expect(feeds.getByRole('alert')).toContainText('does not exist');
  await expect(feeds.getByText('No calendars connected yet.')).toBeVisible();

  await feeds.getByLabel('Name', { exact: true }).fill('Work (Google)');
  await feeds.getByRole('group', { name: 'Colour for the new calendar' }).or(feeds.getByRole('radiogroup', { name: 'Colour for the new calendar' })).getByRole('radio').nth(1).click();
  await feeds.getByLabel('iCal link').fill(GOOGLE);
  await feeds.getByRole('button', { name: /Connect calendar/ }).click();
  await expect(feeds.getByRole('listitem').filter({ hasText: 'Work (Google)' })).toContainText('2 meetings');

  await feeds.getByLabel('Name', { exact: true }).fill('Office (Outlook)');
  await feeds.getByLabel('iCal link').fill(OUTLOOK); // webcal:// is accepted
  await feeds.getByRole('button', { name: /Connect calendar/ }).click();
  const outlook = feeds.getByRole('listitem').filter({ hasText: 'Office (Outlook)' });
  await expect(outlook).toBeVisible();
  await expect(outlook).toContainText('feeds.test');

  // the secret link is never shown back
  await expect(page.getByText('google.ics')).toHaveCount(0);
  await expect(page.getByText('outlook.ics')).toHaveCount(0);
});

test('imported meetings appear in the month view, coloured, de-duplicated and in local time', async ({ page }) => {
  await signIn(page);
  await openMonth(page);
  const today = page.getByRole('gridcell', { selected: true });
  await expect(today).toContainText('Team sync');
  await expect(today).toContainText('Budget review');
  await expect(today).toContainText('Company day');

  const agenda = page.getByRole('complementary', { name: 'Selected day' });
  await expect(agenda.getByRole('button', { name: /Team sync/ })).toContainText(await localLabel(page, '12:00'));
  await expect(agenda.getByRole('button', { name: /Budget review/ })).toContainText(await localLabel(page, '08:00')); // Outlook's Paris time shown in this zone
  await expect(agenda.getByRole('button', { name: /Company day/ })).toContainText('All day');
  await expect(agenda.getByRole('button', { name: /Shared lunch/ })).toHaveCount(1); // in both calendars, shown once

  // each calendar has its own colour on the chips
  const colours = await today.locator('span[style*="border-left"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.borderLeftColor));
  expect(new Set(colours).size).toBe(2);
});

test('imported meetings are read-only and stay out of your own events and synced data', async ({ page }) => {
  await signIn(page);
  await openMonth(page);
  const agenda = page.getByRole('complementary', { name: 'Selected day' });
  await agenda.getByRole('button', { name: /Team sync/ }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Work (Google) · read-only');
  await expect(dlg).toContainText('Room 4');
  await expect(dlg).toContainText('Weekly catch-up');
  for (const name of [/Delete/, /Save/, /Edit/]) await expect(dlg.getByRole('button', { name })).toHaveCount(0);
  await expect(dlg.locator('input, textarea, select')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // your own events still work, and are separate
  await page.getByRole('button', { name: '＋ Event' }).click();
  await page.getByLabel('Title').fill('My own event');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(agenda.getByRole('button', { name: /My own event/ })).toBeVisible();
  await expect.poll(async () => (await docData(page)).data?.events.map((e) => e.title)).toEqual(['My own event']);
  const raw = JSON.stringify(await docData(page));
  for (const t of ['Team sync', 'Budget review', 'Company day']) expect(raw).not.toContain(t);

  await agenda.getByRole('button', { name: /My own event/ }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Delete' })).toBeVisible(); // own events stay editable
  await page.keyboard.press('Escape');
});

test('renaming and removing a calendar', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  const feeds = page.getByRole('region', { name: 'Calendar feeds' });
  const row = feeds.getByRole('listitem').filter({ hasText: 'Office (Outlook)' });
  await row.getByRole('button', { name: 'Edit' }).click();
  await row.getByLabel('Name').fill('Office');
  await row.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(feeds.getByRole('listitem').filter({ hasText: 'Office' }).first()).toBeVisible();

  const renamed = feeds.getByRole('listitem').filter({ hasText: /^Office/ }); // the row no longer matches its old name
  await renamed.getByRole('button', { name: 'Remove' }).click();
  await renamed.getByRole('button', { name: 'Remove?' }).click();
  await expect(feeds.getByRole('listitem').filter({ hasText: 'Office' })).toHaveCount(0);
  await closeSettings(page);
  await openMonth(page);
  const today = page.getByRole('gridcell', { selected: true });
  await expect(today).toContainText('Team sync');
  await expect(today).not.toContainText('Budget review');
  await expect(today).toContainText('Shared lunch'); // still in the Google calendar
});
