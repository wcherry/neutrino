/**
 * Onboarding phase 3: the welcome wizard (agent_docs/plans/feature-onboarding-wizard.md).
 *
 * The server marks every account it creates with `onboarding.welcome: pending`; the wizard opens
 * for a marked account straight after the encryption-key dialog, and Finish or close writes `done`.
 * It does not open by itself under browser automation — Playwright sets `navigator.webdriver`, and
 * every other spec registers a fresh, marked user — so this spec asks for it with the device-local
 * override (`neutrino.wizard.autoStart = on`) before the app loads. The Drive tour is asked for the
 * same way, since the last test is about the hand-off to it.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';
const PASSWORD = 'Password123!';

const wizard = (page: Page): Locator => page.getByRole('dialog', { name: 'Set up Neutrino' });
const tour = (page: Page): Locator => page.getByRole('dialog', { name: 'Drive tour' });
const item = (page: Page, step: string): Locator => wizard(page).locator(`[data-step="${step}"]`);

interface Account {
  email: string;
  token: string;
}

function uniqueEmail(): string {
  return `wizard_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function register(request: APIRequestContext): Promise<string> {
  const email = uniqueEmail();
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Wizard Test User', email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return email;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

/** A new account, signed in, with its key made: the moment the wizard is owed. */
async function newAccount(request: APIRequestContext, page: Page): Promise<Account> {
  const email = await register(request);
  await signIn(page, email);
  await setUpEncryption(page);
  const token = (await page.evaluate(() => localStorage.getItem('access_token')))!;
  return { email, token };
}

async function preferences(request: APIRequestContext, token: string): Promise<Record<string, unknown>> {
  const res = await request.get(`${BASE_URL}/api/v1/preferences`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { values: Record<string, unknown> }).values;
}

async function patchPreferences(request: APIRequestContext, token: string, values: Record<string, unknown>) {
  const res = await request.patch(`${BASE_URL}/api/v1/preferences`, {
    data: { values },
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `patch failed: ${res.status()}`).toBeTruthy();
}

const html = (page: Page, attribute: string) =>
  page.evaluate((a) => document.documentElement.getAttribute(a), attribute);

async function next(page: Page) {
  await wizard(page).getByRole('button', { name: 'Next' }).click();
}

/** Long enough for a wizard that was going to open by itself to have done so. */
async function expectNoWizard(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Quick access' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2_500);
  await expect(wizard(page)).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('neutrino.wizard.autoStart', 'on'));
});

test.describe('Welcome wizard', () => {
  test('opens for a new account after the key dialog, over the dimmed Drive page', async ({ page, request }) => {
    await newAccount(request, page);

    const dialog = wizard(page);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/drive/);
    await expect(dialog.getByText('Step 2 of 7')).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Make it yours' })).toBeVisible();

    // 960×640 at most, not the whole screen.
    const box = (await dialog.locator('[class*="dialog"]').first().boundingBox()) ?? (await dialog.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(960);
    expect(box.height).toBeLessThanOrEqual(640);

    // The list: seven steps, the key already done and the one on screen current.
    await expect(dialog.getByRole('listitem')).toHaveCount(7);
    await expect(item(page, 'key')).toHaveAttribute('data-status', 'done');
    await expect(item(page, 'look')).toHaveAttribute('data-status', 'current');

    // The footer holds Back / Next / Finish and nothing else; Back is off on step 2.
    const footer = dialog.locator('footer');
    await expect(footer.getByRole('button')).toHaveText(['Back', 'Next', 'Finish']);
    await expect(footer.getByRole('button', { name: 'Back' })).toBeDisabled();
    await expect(dialog).not.toContainText(/optional/i);
  });

  test('changing the look restyles the app behind it at once, and Back does not undo it', async ({ page, request }) => {
    const { token } = await newAccount(request, page);
    const dialog = wizard(page);
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    expect(await html(page, 'data-look')).toBe('classic');
    await dialog.getByRole('radio', { name: /Quiet Precision/ }).click();
    await expect.poll(() => html(page, 'data-look')).toBe('precision');

    await dialog.getByRole('radio', { name: 'Teal' }).click();
    await expect(page.locator('style#neutrino-accent')).toHaveCount(1);

    await dialog.getByRole('radio', { name: 'Dark', exact: true }).click();
    await expect.poll(() => html(page, 'data-theme')).toBe('dark');

    // Leave the step and come back: nothing is undone.
    await next(page);
    await expect(dialog.getByText('Step 3 of 7')).toBeVisible();
    await dialog.getByRole('button', { name: 'Back' }).click();
    expect(await html(page, 'data-look')).toBe('precision');
    expect(await html(page, 'data-theme')).toBe('dark');
    await expect(dialog.getByRole('radio', { name: /Quiet Precision/ })).toHaveAttribute('aria-checked', 'true');

    // And it persisted: the server holds all three.
    await expect
      .poll(async () => {
        const prefs = await preferences(request, token);
        return [prefs['appearance.look'], prefs['appearance.accent'], prefs['appearance.theme']];
      }, { timeout: 10_000 })
      .toEqual(['precision', '#0e8c8c', 'dark']);

    // And back again: the page follows the theme.
    await dialog.getByRole('radio', { name: 'Light', exact: true }).click();
    await expect.poll(() => html(page, 'data-theme')).toBe('light');
  });

  test('walks the steps, marks the ones left alone as skipped, and ends on Finish', async ({ page, request }) => {
    await newAccount(request, page);
    const dialog = wizard(page);
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // Step 2, left alone.
    await next(page);
    await expect(item(page, 'look')).toHaveAttribute('data-status', 'skipped');
    await expect(item(page, 'look')).toContainText('skipped');

    // Step 3: a line about you is saved when the step is left.
    await expect(dialog.getByRole('heading', { name: 'How should people see you?' })).toBeVisible();
    await expect(dialog.getByText('Your email stays private.')).toBeVisible();
    await dialog.getByLabel('A line about you').fill('Maths, mostly.');
    await dialog.getByLabel('Region').fill('GB');
    await next(page);
    await expect(item(page, 'profile')).toHaveAttribute('data-status', 'done');

    // Step 4: an empty key is "later", and nothing is saved.
    await expect(dialog.getByRole('heading', { name: 'Bring your own AI' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Test key' })).toBeDisabled();
    await expect(dialog.getByLabel('Provider').locator('option')).toHaveText([
      'Google Gemini (free tier available)',
      'Anthropic Claude',
      'OpenAI (GPT-4o)',
    ]);
    await expect(dialog.getByRole('link', { name: 'Where do I get a key?' })).toHaveAttribute('href', /aistudio\.google\.com/);
    await next(page);
    await expect(item(page, 'ai')).toHaveAttribute('data-status', 'skipped');

    // Step 5: a row for each provider, none connected.
    await expect(dialog.getByRole('heading', { name: 'See all your calendars in one place' })).toBeVisible();
    for (const name of ['Google Calendar', 'Outlook / Microsoft 365', 'Apple Calendar (iCloud)']) {
      await expect(dialog.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(dialog.getByRole('button', { name: /^Connect / })).toHaveCount(3);
    await next(page);
    await expect(item(page, 'calendar')).toHaveAttribute('data-status', 'skipped');

    // Step 6: the import, with its "From Google" card.
    await expect(dialog.getByRole('heading', { name: 'Bring your files with you' })).toBeVisible();
    await expect(dialog.getByText('From Google', { exact: false }).first()).toBeVisible();
    await next(page);
    await expect(item(page, 'files')).toHaveAttribute('data-status', 'skipped');

    // Step 7: Next is off, Finish is the primary button.
    await expect(dialog.getByRole('heading', { name: 'Neutrino is better with people you trust' })).toBeVisible();
    await expect(dialog.getByText('Step 7 of 7')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Next' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Back' })).toBeEnabled();
    await expect(dialog.getByRole('textbox', { name: 'Invite link' })).toHaveValue(/\/register\?invite=/);
    await expect(dialog.getByText('Invitations sent by email work once and expire after 14 days')).toBeVisible();
    await expect(dialog).not.toContainText(/optional/i);

    // Sending an invite is this step's own button, in its body.
    await dialog.getByLabel(/send invitations by email/i).fill(`friend_${Date.now()}@example.com `);
    await dialog.getByRole('button', { name: 'Send 1 invite' }).click();
    await expect(dialog.getByRole('status')).toContainText(/sent/i, { timeout: 15_000 });

    await dialog.getByRole('button', { name: 'Finish' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('a key typed in the AI step is saved by Next; Test key reports what the provider said', async ({ page, request }) => {
    await newAccount(request, page);
    const dialog = wizard(page);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await next(page);
    await next(page);

    await dialog.getByLabel('Provider').selectOption('claude');
    await dialog.getByLabel('API key').fill('sk-ant-not-a-real-key');
    // The key is refused by the provider (or unreachable from here): the message is shown, not saved.
    await dialog.getByRole('button', { name: 'Test key' }).click();
    await expect(dialog.getByRole('status')).not.toBeEmpty({ timeout: 30_000 });
    await expect(dialog.getByText('Key works.')).toHaveCount(0);

    await next(page);
    await expect(item(page, 'ai')).toHaveAttribute('data-status', 'done');
    await dialog.getByRole('button', { name: 'Back' }).click();
    await expect(dialog.getByLabel('API key')).toHaveValue('sk-ant-not-a-real-key');
  });

  test('Finish lands in Drive and the Drive tour starts; neither comes back on reload or a second sign-in', async ({ page, request }) => {
    await page.addInitScript(() => window.localStorage.setItem('neutrino.tours.autoStart', 'on'));
    const { email, token } = await newAccount(request, page);
    const dialog = wizard(page);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // The tour waits for the wizard.
    await page.waitForTimeout(2_000);
    await expect(tour(page)).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Finish' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/drive\/?$/);
    await expect(tour(page)).toBeVisible({ timeout: 15_000 });
    await expect(tour(page)).toContainText('Create anything from here');
    await expect.poll(async () => (await preferences(request, token))['onboarding.welcome'], { timeout: 10_000 }).toBe('done');

    // Reload: no wizard, and the tour that has been seen does not come back either.
    await tour(page).getByRole('button', { name: 'Skip tour' }).click();
    await expect.poll(async () => (await preferences(request, token))['onboarding.toursSeen'], { timeout: 10_000 }).toEqual(['drive']);
    await page.reload();
    await expectNoWizard(page);

    // A second sign-in on the same device.
    await page.getByRole('button', { name: 'User menu' }).click();
    await page.getByRole('menuitem', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 });
    await signIn(page, email);
    await expectNoWizard(page);
  });

  test('closing it early ends it for good too', async ({ page, request }) => {
    const { token } = await newAccount(request, page);
    await expect(wizard(page)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(wizard(page)).toHaveCount(0);
    await expect.poll(async () => (await preferences(request, token))['onboarding.welcome'], { timeout: 10_000 }).toBe('done');
    await page.reload();
    await expectNoWizard(page);
  });

  test('is owed to a new account and to nobody else: an existing user never sees it', async ({ page, request }) => {
    const email = await register(request);
    await signIn(page, email);
    await setUpEncryption(page);
    const token = (await page.evaluate(() => localStorage.getItem('access_token')))!;
    // Registration marked the account…
    expect((await preferences(request, token))['onboarding.welcome']).toBe('pending');
    // …so make it look like an account that predates the wizard, which was never marked.
    await patchPreferences(request, token, { 'onboarding.welcome': null });
    expect((await preferences(request, token))['onboarding.welcome']).toBeUndefined();

    await page.reload();
    await expectNoWizard(page);
  });

  test('does not open by itself under automation unless a spec asks for it', async ({ page, request }) => {
    await page.addInitScript(() => window.localStorage.removeItem('neutrino.wizard.autoStart'));
    await page.addInitScript(() => window.localStorage.setItem('neutrino.wizard.autoStart', 'off'));
    const email = await register(request);
    await signIn(page, email);
    await setUpEncryption(page);
    await expectNoWizard(page);
  });
});
