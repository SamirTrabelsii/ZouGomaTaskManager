import { expect, test, type Page } from '@playwright/test';

// One user, one database, tests run in order: each step builds on the account created first.
test.describe.configure({ mode: 'serial' });

const EMAIL = 'e2e@example.com';
const PASSWORD = 'e2e-correct-horse-battery';
const CHANGED = 'e2e-a-changed-passphrase';
const RESET = 'e2e-after-the-reset-flow';
/**
 * Passwords are hashed with bcrypt (cost 12, pure JavaScript: about a second when idle). While the 3D room renders in software
 * the CPU is shared, so steps that wait for a hash can take far longer than Playwright's default 5 s.
 */
const HASHING = { timeout: 45_000 };
/**
 * Hides WebGL from the page so the app falls back to its 2D room. The account-security tests don't need the 3D scene, and its
 * software rendering takes so much CPU that the API's bcrypt calls (30 s instead of under 1 s) starve and the test times out.
 */
const without3D = (page: Page) => page.addInitScript(() => {
  const real = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    return /webgl/i.test(type) ? null : (real as (...a: unknown[]) => unknown).call(this, type, ...rest);
  } as typeof real;
});
/** The password currently valid for the account; the later tests change it. */
let current = PASSWORD;
/** The recovery code last shown to the user. */
let recoveryCode = '';

const errors: string[] = [];
test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => {
  expect(errors, 'uncaught page errors').toEqual([]);
});

async function signIn(page: Page, password = current) {
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
  // the recovery code is shown once and must be acknowledged before entering the app
  const dialog = page.getByRole('dialog', { name: 'Save your recovery code' });
  await expect(dialog).toBeVisible(HASHING);
  recoveryCode = (await dialog.getByTestId('recovery-code').textContent()) ?? '';
  expect(recoveryCode).toMatch(/^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
  await expect(dialog.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible(); // can't be dismissed by accident
  await dialog.getByLabel(/saved this code/).check();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog).toBeHidden();
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

  await page.getByLabel('Password').fill(current);
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

test('the account download holds the studio and nothing secret', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download account data/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^lifeos-account-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  const text = (await import('node:fs')).readFileSync(path, 'utf8');
  const out = JSON.parse(text);
  expect(out).toMatchObject({ format: 'lifeos-account-export', account: { email: EMAIL } });
  expect(out.data.data.tasks.map((t: { title: string }) => t.title)).toContain('Water the monstera');
  expect(text).not.toMatch(/\$2[aby]\$/); // no bcrypt hash
  await closeSettings(page);
});

test('changing the password in Settings: wrong current password is refused, then the new one is required', async ({ page, playwright }) => {
  test.setTimeout(150_000);
  await without3D(page);
  // a second device signed in before the change (an API client with its own cookie jar: a second 3D page would starve the first)
  const other = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  expect((await other.post('/api/auth/login', { data: { email: EMAIL, password: current } })).status()).toBe(200);
  expect((await other.get('/api/auth/me')).status()).toBe(200);

  await signIn(page);
  await openSettings(page);
  await page.getByRole('button', { name: 'Change password' }).click();
  const form = page.getByRole('form', { name: 'Change password' });
  await form.getByLabel('Current password').fill('definitely-not-it');
  await form.getByLabel('New password').fill(CHANGED);
  await form.getByRole('button', { name: 'Change password' }).click();
  await expect(form.getByRole('alert')).toContainText('incorrect', HASHING);

  await form.getByLabel('Current password').fill(current);
  await form.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText(/Password changed/)).toBeVisible(HASHING);
  current = CHANGED;
  await closeSettings(page);

  // this device stays signed in; the other one is rejected by the server on its next request
  expect((await page.request.get('/api/auth/me')).status()).toBe(200);
  expect((await other.get('/api/auth/me')).status()).toBe(401);
  await other.dispose();

  expect((await page.request.post('/api/auth/login', { data: { email: EMAIL, password: PASSWORD } })).status()).toBe(401);
});

test('forgot password: the recovery code resets it, shows a new code, and the used code is dead', async ({ page }) => {
  test.setTimeout(150_000);
  await without3D(page);
  await page.context().clearCookies();
  await page.goto('/');
  await page.getByRole('button', { name: 'Forgot your password?' }).click();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Recovery code').fill('AAAA-AAAA-AAAA-AAAA-AAAA');
  await page.getByLabel('New password').fill(RESET);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('alert')).toContainText('do not match', HASHING);

  await page.getByLabel('Recovery code').fill(recoveryCode);
  await page.getByLabel('New password').fill(RESET); // the form clears the password after a failed attempt
  await page.getByRole('button', { name: 'Reset password' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save your recovery code' });
  await expect(dialog).toBeVisible(HASHING);
  const fresh = (await dialog.getByTestId('recovery-code').textContent()) ?? '';
  expect(fresh).toMatch(/^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
  expect(fresh).not.toBe(recoveryCode);
  await dialog.getByLabel(/saved this code/).check();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  current = RESET;

  // the studio is intact, the old password and the used code no longer work
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Tasks' }).click();
  await page.getByLabel('Status', { exact: true }).selectOption('done');
  await expect(page.getByRole('button', { name: 'Edit Water the monstera' })).toBeVisible();
  expect((await page.request.post('/api/auth/login', { data: { email: EMAIL, password: CHANGED } })).status()).toBe(401);
  expect((await page.request.post('/api/auth/reset-password', { data: { email: EMAIL, recoveryCode, newPassword: 'another-new-passphrase' } })).status()).toBe(401);
  recoveryCode = fresh;
});

test('scopes, sizes and statuses: a blocked task keeps its note, a quick status change clears it, and size filters work', async ({ page }) => {
  await without3D(page);
  await signIn(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Tasks' }).click();

  await page.getByRole('button', { name: /New task/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  /** Dialog fields are wrapped in <label><span class="label">…</span>control</label>. */
  const field = (name: string) => dialog.locator('label').filter({ has: page.locator('span.label', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
  await dialog.getByPlaceholder('What needs doing?').fill('Draft contract');
  await field('Size (story points)').locator('select').selectOption('L');
  await field('Status').locator('select').selectOption('blocked');
  await field('Blocked by').locator('input').fill('counsel feedback');
  // create a scope on the spot; it is selected right away
  await dialog.getByRole('button', { name: 'Create a new scope' }).click();
  await dialog.getByLabel('New scope name').fill('Legal');
  await dialog.getByLabel('New scope name').press('Enter');
  await expect(field('Scope').locator('select')).toContainText('Legal');
  await dialog.getByRole('button', { name: 'Add task' }).click();

  const row = page.getByRole('button', { name: 'Edit Draft contract' });
  await expect(row).toContainText('counsel feedback');
  await expect(row).toContainText('5'); // size L = 5 points
  await expect(row).toContainText('Legal');

  type Saved = { title: string; status: string; size: string | null; blockedBy: string; scopeId: string | null };
  const saved = async () => ((await cloudData(page)).data.tasks as unknown as Saved[]).find((t) => t.title === 'Draft contract');
  await expect.poll(async () => (await saved())?.size).toBe('L');
  expect(await saved()).toMatchObject({ status: 'blocked', blockedBy: 'counsel feedback' });
  expect((await saved())?.scopeId).toBeTruthy();

  // one-click status change from the row; the blocked note goes with the status
  await page.getByLabel('Status of Draft contract').selectOption('onhold');
  await expect(row).not.toContainText('counsel feedback');
  await expect.poll(async () => (await saved())?.status).toBe('onhold');
  expect((await saved())?.blockedBy).toBe('');

  // size filter
  await page.getByLabel('Size', { exact: true }).selectOption('XS');
  await expect(row).toBeHidden();
  await page.getByLabel('Size', { exact: true }).selectOption('L');
  await expect(row).toBeVisible();

  // scope filter chip
  await page.getByRole('button', { name: /^Legal/ }).click();
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'All', exact: true }).click();
});
