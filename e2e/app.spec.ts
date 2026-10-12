import { expect, test, type Page } from '@playwright/test';

// One user, one database, tests run in order: each step builds on the account created first.
test.describe.configure({ mode: 'serial' });

const EMAIL = 'e2e@example.com';
const PASSWORD = 'e2e-correct-horse-battery';

const errors: string[] = [];
test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => {
  expect(errors, 'uncaught page errors').toEqual([]);
});

async function signIn(page: Page, password = PASSWORD) {
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const openSettings = async (page: Page) => page.getByRole('button', { name: 'Settings' }).click();
const closeSettings = async (page: Page) => page.getByRole('button', { name: 'Close' }).first().click();
const cloudData = async (page: Page) => (await (await page.request.get('/api/data')).json()) as { data: { tasks: { title: string; status: string }[]; prefs: { scene: Record<string, unknown> } } };

test('first run creates the account and opens the 3D room', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'LifeOS' })).toBeVisible();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  // the HTML minLength check blocks a short password; nothing was created
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Room objects' })).toBeVisible();
});

test('a task added in the list is saved to the account and survives a reload', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Tasks' }).click();
  await expect(page.getByText('No tasks yet')).toBeVisible();

  await page.getByLabel('Quick add task').fill('Water the monstera');
  await page.getByLabel('Quick add task').press('Enter');
  await expect(page.getByRole('button', { name: 'Edit Water the monstera' })).toBeVisible();

  await page.getByRole('checkbox', { name: 'Complete: Water the monstera' }).click();
  // finished tasks leave the default "open" list; they show under the Done filter
  await expect(page.getByRole('button', { name: 'Edit Water the monstera' })).toBeHidden();
  await page.getByLabel('Status', { exact: true }).selectOption('done');
  await expect(page.getByRole('checkbox', { name: 'Mark not done: Water the monstera' })).toBeVisible();

  await expect.poll(async () => (await cloudData(page)).data.tasks.map((t) => `${t.title}:${t.status}`)).toEqual(['Water the monstera:done']);

  await page.reload();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Tasks' }).click();
  await page.getByLabel('Status', { exact: true }).selectOption('done');
  await expect(page.getByRole('checkbox', { name: 'Mark not done: Water the monstera' })).toBeVisible();
});

test('the main views open', async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const [tab, heading] of [['Calendar', /calendar|\w+ \d{4}/i], ['Insights', /insights/i], ['Tasks', /^Tasks$/]] as const) {
    await nav.getByRole('button', { name: tab }).click();
    await expect(nav.getByRole('button', { name: tab })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('main').getByRole('heading', { name: heading }).first()).toBeVisible();
  }
  await nav.getByRole('button', { name: 'Home' }).click();
  await expect(page.locator('canvas')).toBeVisible();
});

test('a room object opens its panel and Escape closes it', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation', { name: 'Room objects' }).getByRole('button').first().click();
  await expect(page.getByLabel('Quick add task')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Quick add task')).toBeHidden();
});

test('lighting, rain and quality choices apply and are saved to the account', async ({ page }) => {
  await signIn(page);
  const nightBtn = page.getByRole('button', { name: /Night|Day/ });
  await openSettings(page);

  const lighting = page.getByRole('group', { name: 'Lighting' });
  await lighting.getByRole('button', { name: /Day/ }).click();
  await page.getByLabel('Rain on the window').check();
  await page.getByLabel('Graphics quality').selectOption('balanced');
  await closeSettings(page);
  await expect(nightBtn).toHaveText(/Night/); // currently day → offers Night
  await expect(page.locator('canvas')).toBeVisible();

  await expect.poll(async () => (await cloudData(page)).data.prefs.scene).toMatchObject({ theme: 'day', weather: 'rain', quality: 'balanced' });

  await openSettings(page);
  await lighting.getByRole('button', { name: /Night/ }).click();
  await page.getByLabel('Graphics quality').selectOption('auto');
  await closeSettings(page);
  await expect(nightBtn).toHaveText(/Day/);
  await expect.poll(async () => (await cloudData(page)).data.prefs.scene).toMatchObject({ theme: 'evening', quality: 'auto' });
});

test('wrong password is rejected, sign out returns to the gate, sign in brings the data back', async ({ page }) => {
  await signIn(page, 'definitely-the-wrong-one');
  await expect(page.getByRole('alert')).toBeVisible();

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  await openSettings(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Sign out of this device?' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  await signIn(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Tasks' }).click();
  await page.getByLabel('Status', { exact: true }).selectOption('done');
  await expect(page.getByRole('button', { name: 'Edit Water the monstera' })).toBeVisible();
});
