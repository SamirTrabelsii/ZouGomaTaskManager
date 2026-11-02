import bcrypt from 'bcryptjs';
import pg from 'pg';
import { expect, test, type Page } from '@playwright/test';
import { assertTestDatabase, TEST_DATABASE_URL } from './testdb';

// Owns its account (created straight in the test database). The tests below build on each other.
// Named so it runs after app.spec.ts, whose first-run test needs a database with no user in it.
test.describe.configure({ mode: 'serial' });

const EMAIL = 'agent@example.com';
const PASSWORD = 'agent-correct-horse-battery';

test.beforeAll(async () => {
  assertTestDatabase(TEST_DATABASE_URL);
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  try {
    await pool.query('INSERT INTO users (email, password_hash) VALUES ($1,$2) ON CONFLICT (email) DO NOTHING', [EMAIL, await bcrypt.hash(PASSWORD, 4)]);
  } finally { await pool.end(); }
});

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

let token = '';

test('create an agent token from Settings and see it only once', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  const agent = page.getByRole('region', { name: 'AI agent' });
  await expect(agent.getByRole('status', { name: 'Agent status' })).toContainText('Not connected yet');
  await expect(agent.getByText('No access tokens yet.')).toBeVisible();

  await agent.getByRole('button', { name: /Create token/ }).click();
  await expect(agent.getByRole('alert')).toContainText('Give the token a name');

  await agent.getByLabel('New token').fill('Work laptop');
  await agent.getByRole('button', { name: /Create token/ }).click();
  const shown = agent.getByLabel('New agent token');
  await expect(shown).toHaveValue(/^lifeos_agent_[\w-]{40,}$/);
  token = await shown.inputValue();

  await agent.getByRole('button', { name: 'I’ve saved it' }).click();
  await expect(agent.getByLabel('New agent token')).toHaveCount(0);
  const row = agent.getByRole('list', { name: 'Access tokens' }).getByRole('listitem');
  await expect(row).toContainText('Work laptop');
  await expect(row).toContainText(`…${token.slice(-4)}`);
  await expect(row).toContainText('never used');
  // the token is gone from the page and never comes back from the server
  await expect(page.getByText(token)).toHaveCount(0);
  expect(JSON.stringify(await (await page.request.get('/api/agent')).json())).not.toContain(token);
});

test('shows the agent online once it checks in, and pauses it with an order', async ({ page }) => {
  const beat = await page.request.post('/api/agent/heartbeat', { headers: { authorization: `Bearer ${token}` }, data: { version: '0.1.0', state: 'idle' } });
  expect(beat.status()).toBe(200);

  await signIn(page);
  await openSettings(page);
  const agent = page.getByRole('region', { name: 'AI agent' });
  const status = agent.getByRole('status', { name: 'Agent status' });
  await expect(status).toContainText('Online');
  await expect(status).toContainText('v0.1.0');
  await expect(agent.getByRole('list', { name: 'Access tokens' })).toContainText('last used');

  await status.getByRole('button', { name: 'Pause agent' }).click();
  await expect(page.getByText('Order sent')).toBeVisible();
  // the agent would find the order when it asks; the order is a fixed kind, not text
  const pending = await page.request.get('/api/agent/commands/pending', { headers: { authorization: `Bearer ${token}` } });
  expect((await pending.json()).commands).toEqual([expect.objectContaining({ kind: 'pause', alertId: null })]);

  // once the agent reports it is paused, the button offers to resume
  await page.request.post('/api/agent/heartbeat', { headers: { authorization: `Bearer ${token}` }, data: { version: '0.1.0', state: 'paused' } });
  await closeSettings(page);
  await openSettings(page);
  await expect(status).toContainText('Online, paused');
  await expect(status.getByRole('button', { name: 'Resume agent' })).toBeVisible();
});

test('revoking a token cuts the agent off, and the limit of three is explained', async ({ page }) => {
  await signIn(page);
  await openSettings(page);
  const agent = page.getByRole('region', { name: 'AI agent' });

  for (const n of ['Second', 'Third']) {
    await agent.getByLabel('New token').fill(n);
    await agent.getByRole('button', { name: /Create token/ }).click();
    await agent.getByRole('button', { name: 'I’ve saved it' }).click();
  }
  await expect(agent.getByText('the most allowed')).toBeVisible();
  await expect(agent.getByLabel('New token')).toHaveCount(0);

  const first = agent.getByRole('list', { name: 'Access tokens' }).getByRole('listitem').filter({ hasText: 'Work laptop' });
  await first.getByRole('button', { name: 'Revoke' }).click();
  await first.getByRole('button', { name: 'Revoke?' }).click();
  await expect(page.getByText('Revoked “Work laptop”')).toBeVisible();
  await expect(agent.getByRole('list', { name: 'Access tokens' })).not.toContainText('Work laptop');
  await expect(agent.getByLabel('New token')).toBeVisible();

  const after = await page.request.post('/api/agent/heartbeat', { headers: { authorization: `Bearer ${token}` }, data: {} });
  expect(after.status()).toBe(401);
});
