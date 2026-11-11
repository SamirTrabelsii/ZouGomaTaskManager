import bcrypt from 'bcryptjs';
import pg from 'pg';
import { expect, test, type Page } from '@playwright/test';
import { assertTestDatabase, TEST_DATABASE_URL } from './testdb';

// Owns its account (created straight in the test database). The tests below build on each other.
// Named so it runs after app.spec.ts, whose first-run test needs a database with no user in it.
test.describe.configure({ mode: 'serial' });

const EMAIL = 'room-agent@example.com';
const PASSWORD = 'room-agent-correct-horse-battery';

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
const dock = (page: Page) => page.getByRole('navigation', { name: 'Room objects' });
const agentButton = (page: Page) => dock(page).getByRole('button', { name: /Chopper Bot/ });
// the panel is named after what it shows: "Chopper Bot" for the list, the alert's title for one alert
const panel = (page: Page) => page.getByRole('complementary');
// A two-step button arms itself for 4 seconds, and the 3D scene is slow to draw here (software WebGL), so a slow page can miss
// that window. Try again until both clicks land inside it.
async function confirmed(page: Page, first: string, second: string) {
  await expect(async () => {
    const armed = panel(page).getByRole('button', { name: second });
    if (!(await armed.count())) await panel(page).getByRole('button', { name: first }).click({ timeout: 10_000 });
    await armed.click({ timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
}

// Windows turns line breaks into CRLF on the clipboard; what matters is that the text is the fix
const clipboard = async (page: Page) => (await page.evaluate(() => navigator.clipboard.readText())).split('\r\n').join('\n');
const FIX = "select o.id, o.customer_id\nfrom {{ ref('stg_orders') }} o\nleft join {{ ref('stg_customers') }} c on c.id = o.customer_id";
let token = '';
let criticalId = '';
const asAgent = () => ({ authorization: `Bearer ${token}` });

test('the console appears only once the agent is set up, and lists alerts worst first', async ({ page }) => {
  await signIn(page);
  await expect(dock(page).getByRole('button', { name: /Chest/ })).toBeVisible();
  await expect(agentButton(page)).toHaveCount(0); // no token and no agent yet: no console in the room

  token = (await (await page.request.post('/api/agent/tokens', { data: { name: 'room' } })).json()).token;
  await page.request.post('/api/agent/heartbeat', { headers: asAgent(), data: { version: '0.1.0', state: 'idle' } });
  await page.request.post('/api/agent/alerts', { headers: asAgent(), data: { externalId: 'rb-2', title: 'Slow model fct_sessions', category: 'performance', severity: 'medium', occurrences: 3 } });
  const a = await (await page.request.post('/api/agent/alerts', {
    headers: asAgent(),
    data: { externalId: 'rb-1', title: 'NULL customer_id in orders', category: 'data_quality', severity: 'critical', occurrences: 40, summary: 'The join with customers drops rows without an address.' },
  })).json();
  criticalId = a.id;
  await page.request.post(`/api/agent/alerts/${criticalId}/findings`, { headers: asAgent(), data: { kind: 'cause', text: 'LEFT JOIN on customers loses customers with no address.' } });
  await page.request.post(`/api/agent/alerts/${criticalId}/patches`, {
    headers: asAgent(), data: { title: 'Keep customers without an address', filePath: 'models/staging/stg_orders.sql', body: FIX, testCommand: 'dbt test -s stg_orders' },
  });

  await page.reload();
  await expect(agentButton(page)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Chopper Bot: 2 open alerts · 1 critical/ })).toBeAttached();

  await agentButton(page).click();
  await expect(panel(page)).toContainText('Online');
  const items = panel(page).getByRole('list', { name: 'Open alerts' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('NULL customer_id in orders'); // the critical one first
  await expect(items.nth(0)).toContainText('Critical');
  await expect(items.nth(0)).toContainText('Data quality');
  await expect(items.nth(1)).toContainText('Slow model fct_sessions');
});

test('read a diagnosis, copy the fix, and mark it applied: its text is wiped from the server', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page);
  await agentButton(page).click();
  await panel(page).getByRole('button', { name: /NULL customer_id/ }).click();

  await expect(panel(page)).toContainText('The join with customers drops rows without an address.');
  await expect(panel(page)).toContainText('LEFT JOIN on customers loses customers with no address.');
  await expect(panel(page)).toContainText('models/staging/stg_orders.sql');
  await expect(panel(page).getByLabel('Fix for models/staging/stg_orders.sql')).toContainText("left join {{ ref('stg_customers') }}");

  await panel(page).getByRole('button', { name: 'Copy fix' }).click();
  await expect(page.getByText('Fix copied')).toBeVisible();
  expect(await clipboard(page)).toBe(FIX);
  await panel(page).getByRole('button', { name: 'Copy', exact: true }).click(); // the test command
  expect(await clipboard(page)).toBe('dbt test -s stg_orders');

  await panel(page).getByRole('button', { name: 'I applied it' }).click();
  await expect(panel(page)).toContainText('The text of this fix was deleted from the server.');
  await expect(panel(page).getByLabel('Fix for models/staging/stg_orders.sql')).toHaveCount(0);
  const stored = await (await page.request.get(`/api/agent/alerts/${criticalId}`)).json();
  expect(stored.patches[0]).toMatchObject({ status: 'applied', body: '' });
});

test('give the agent an order, follow it to its result, then ignore the alert', async ({ page }) => {
  await signIn(page);
  await agentButton(page).click();
  await panel(page).getByRole('button', { name: /NULL customer_id/ }).click();

  await panel(page).getByRole('button', { name: 'Investigate', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: /Investigate… \(waiting\)/ })).toBeDisabled();
  const pending = await (await page.request.get('/api/agent/commands/pending', { headers: asAgent() })).json();
  expect(pending.commands).toEqual([expect.objectContaining({ kind: 'investigate', externalId: 'rb-1' })]);
  const orderId = pending.commands[0].id;
  await page.request.post(`/api/agent/commands/${orderId}/ack`, { headers: asAgent(), data: {} });
  await page.request.post(`/api/agent/commands/${orderId}/result`, { headers: asAgent(), data: { status: 'done', result: 'Cause found: left join drops rows' } });

  // going back to the list refreshes the orders, so the result shows at once
  await panel(page).getByRole('button', { name: '← All alerts' }).click();
  await expect(panel(page)).toContainText('Cause found: left join drops rows');

  await panel(page).getByRole('button', { name: /NULL customer_id/ }).click();
  await confirmed(page, 'Ignore alert', 'Ignore it?');
  await expect(page.getByText('Alert ignored.')).toBeVisible();
  await panel(page).getByRole('button', { name: '← All alerts' }).click();
  await expect(panel(page).getByRole('list', { name: 'Open alerts' }).getByRole('listitem')).toHaveCount(1);
  await expect(panel(page).getByRole('list', { name: 'Closed alerts' })).toContainText('NULL customer_id in orders');
  // the agent is told to stop working on it
  const stop = await (await page.request.get('/api/agent/commands/pending', { headers: asAgent() })).json();
  expect(stop.commands).toEqual([expect.objectContaining({ kind: 'ignore', externalId: 'rb-1' })]);
});

test('the room flags alerts you have not seen yet, until you open the agent panel', async ({ page }) => {
  await signIn(page);
  // the first look in a browser counts what is there as seen: nothing is new
  await expect(page.getByRole('button', { name: /^Chopper Bot: 1 open alert/ })).toBeAttached();
  await expect(page.getByRole('button', { name: /new$/ })).toHaveCount(0);

  await page.request.post('/api/agent/alerts', { headers: asAgent(), data: { externalId: 'rb-3', title: 'Duplicate rows in dim_customers', category: 'data_quality', severity: 'high', occurrences: 2 } });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // the room checks again when the tab is shown
  await expect(page.getByRole('button', { name: /^Chopper Bot: 2 open alerts · 1 new/ })).toBeAttached();

  await agentButton(page).click();
  const fresh = panel(page).getByRole('list', { name: 'Open alerts' }).getByRole('listitem').filter({ hasText: 'Duplicate rows in dim_customers' });
  await expect(fresh).toContainText('New');
  await expect(panel(page).getByRole('list', { name: 'Open alerts' }).getByRole('listitem').filter({ hasText: 'Slow model' })).not.toContainText('New');
  await expect(page.getByRole('button', { name: /new$/ })).toHaveCount(0); // looking at the list put the beacon out

  await page.reload(); // and it stays out
  await expect(page.getByRole('button', { name: /^Chopper Bot: 2 open alerts/ })).toBeAttached();
  await expect(page.getByRole('button', { name: /new$/ })).toHaveCount(0);

  // an alert that happens again is new again
  await page.request.post('/api/agent/alerts', { headers: asAgent(), data: { externalId: 'rb-3', title: 'Duplicate rows in dim_customers', category: 'data_quality', severity: 'high', occurrences: 7 } });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: /^Chopper Bot: 2 open alerts · 1 new/ })).toBeAttached();
});

test('each open alert says whether the agent found something, and the demo alerts can be deleted', async ({ page }) => {
  await signIn(page); // the list calls below need the session
  const list = async () => (await (await page.request.get('/api/agent/alerts')).json()).alerts as { id: string; externalId: string }[];
  const id = async (externalId: string) => (await list()).find((a) => a.externalId === externalId)!.id;
  await page.request.post(`/api/agent/alerts/${await id('rb-2')}/findings`, { headers: asAgent(), data: { kind: 'note', text: 'Nothing conclusive in the logs.' } });
  await page.request.post(`/api/agent/alerts/${await id('rb-3')}/findings`, { headers: asAgent(), data: { kind: 'cause', text: 'A duplicate key in the seed file.' } });
  await page.request.post('/api/agent/alerts', { headers: asAgent(), data: { externalId: 'sim-1', title: '[simulated] Nightly pipeline failed', category: 'pipeline_failure', severity: 'critical', occurrences: 1, status: 'ignored' } });

  await page.reload();
  await agentButton(page).click();
  const open = panel(page).getByRole('list', { name: 'Open alerts' }).getByRole('listitem');
  await expect(open.filter({ hasText: 'Duplicate rows in dim_customers' })).toContainText('Cause found');
  await expect(open.filter({ hasText: 'Slow model fct_sessions' })).toContainText('Analysed · no cause found');

  const closed = panel(page).getByRole('list', { name: 'Closed alerts' });
  await expect(closed).toContainText('[simulated] Nightly pipeline failed');
  await confirmed(page, 'Delete the 1 simulated alert', 'Delete them for good?');
  await expect(page.getByText('1 simulated alert deleted.')).toBeVisible();
  await expect(closed).not.toContainText('[simulated]');
  await expect(panel(page).getByRole('button', { name: /Delete the \d+ simulated/ })).toHaveCount(0);
  expect((await list()).some((a) => a.externalId === 'sim-1')).toBe(false);
});

test('one click makes the task that tracks an investigation: in progress, high priority, 1 point, under Run S&Y', async ({ page }) => {
  await signIn(page);
  await agentButton(page).click();
  await panel(page).getByRole('button', { name: /Duplicate rows in dim_customers/ }).click();
  await panel(page).getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText(/Task created: Investigation Alerte RollBar - \d{8}/)).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Create task' })).toHaveCount(0); // once a day per alert
  await expect(panel(page)).toContainText('Task created today');

  type Saved = { data: { tasks: { title: string; status: string; priority: string; size: string; scopeId: string; notes: string }[]; scopes: { id: string; title: string }[] } };
  const saved = async () => ((await (await page.request.get('/api/data')).json()) as Saved).data;
  await expect.poll(async () => (await saved()).tasks.length).toBe(1);
  const { tasks, scopes } = await saved();
  const now = new Date();
  const ddmmyyyy = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${now.getFullYear()}`;
  expect(tasks[0]).toMatchObject({ title: `Investigation Alerte RollBar - ${ddmmyyyy}`, status: 'doing', priority: 'high', size: 'XS' });
  expect(scopes.find((s) => s.id === tasks[0].scopeId)?.title).toBe("Run 'S&Y'");
  expect(tasks[0].notes).toContain('[rb-3]');
  expect(tasks[0].notes).toContain('A duplicate key in the seed file.'); // what the agent found goes with it

  // coming back later still knows the task exists
  await page.reload();
  await agentButton(page).click();
  await panel(page).getByRole('button', { name: /Duplicate rows in dim_customers/ }).click();
  await expect(panel(page)).toContainText('Task created today');
});

test('an analysis reads as a verdict, what to do and the evidence, and a new one replaces the old', async ({ page }) => {
  await signIn(page);
  const create = async (externalId: string, title: string) => (await (await page.request.post('/api/agent/alerts', { headers: asAgent(), data: { externalId, title, category: 'pipeline_failure', severity: 'medium', occurrences: 1334 } })).json()).id as string;
  const id = await create('rb-35', 'DBT run failed (#35)');
  const say = (kind: string, text: string, replace?: boolean) => page.request.post(`/api/agent/alerts/${id}/findings`, { headers: asAgent(), data: { kind, text, replace } });
  await say('lead', 'An old idea that the next analysis drops.');
  await say('noise', 'Not a real failure: the daily run succeeded, 0 of 665 models failed.', true); // a new analysis
  await say('note', 'The build at 07:03 UTC built 665 models, none failed.');
  await say('todo', 'Open the payload of item 35 in Rollbar.');

  await page.reload();
  await agentButton(page).click();
  const row = panel(page).getByRole('list', { name: 'Open alerts' }).getByRole('listitem').filter({ hasText: 'DBT run failed (#35)' });
  await expect(row).toContainText('Not a real failure'); // the tag in the list says what the agent concluded
  await row.getByRole('button').click();

  await expect(panel(page).getByRole('region', { name: 'Verdict' })).toContainText('the daily run succeeded');
  await expect(panel(page).getByRole('region', { name: 'Verdict' })).toContainText('Not a real failure');
  await expect(panel(page)).toContainText('To do by you');
  await expect(panel(page)).toContainText('Open the payload of item 35 in Rollbar.');
  await expect(panel(page)).toContainText('The build at 07:03 UTC built 665 models, none failed.');
  await expect(panel(page)).not.toContainText('An old idea'); // replaced
});

test('signing out clears the agent from the room', async ({ page }) => {
  await signIn(page);
  await expect(agentButton(page)).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out of this device?' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('NULL customer_id')).toHaveCount(0);
});
