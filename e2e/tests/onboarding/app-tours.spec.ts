/**
 * Onboarding phase 2: the tours of the other eight apps (agent_docs/plans/feature-onboarding-app-tours.md).
 *
 * Each app's tour starts by itself the first time the app is opened — in the editor for the
 * document apps, since that is where everything it points at is, and on the landing page for
 * Photos and Calendar — walks to Done, is recorded in `onboarding.toursSeen`, does not come back
 * after a reload, and replays from the account menu.
 *
 * As in drive-tour.spec.ts, tours only start by themselves under Playwright when the device-local
 * override says so. Here it is switched on only after sign-in and after Drive's tour has been
 * marked seen, so the Drive tour never opens over My Drive on the way to the app under test.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';
const PASSWORD = 'Password123!';

interface AppCase {
  id: string;
  /** As the card and the menu name it. */
  name: string;
  /** The step titles a new account sees, in order. */
  steps: string[];
  /** Opens the app the way a user would the first time; the tour starts there. */
  open: (page: Page) => Promise<void>;
}

/** New → the given kind, from My Drive, into its editor. */
function createFromDrive(item: string, editor: RegExp): (page: Page) => Promise<void> {
  return async (page) => {
    await page.goto('/drive');
    await page.getByRole('button', { name: 'Create new item' }).click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
    await expect(page).toHaveURL(editor, { timeout: 15_000 });
  };
}

const APPS: AppCase[] = [
  {
    id: 'docs',
    name: 'Docs',
    steps: [
      'Name it, and it saves itself',
      'The toolbar',
      'Outline',
      'Comments, history and compare',
      'Share',
      'Search and run anything',
    ],
    open: createFromDrive('Document', /\/docs\/editor\/?\?id=/),
  },
  {
    id: 'sheets',
    name: 'Sheets',
    steps: ['Formula bar and name box', 'Formatting', 'Charts', 'Sheet tabs', 'Version history', 'Share'],
    open: createFromDrive('Spreadsheet', /\/sheets\/editor\/?\?id=/),
  },
  {
    id: 'slides',
    name: 'Slides',
    steps: ['Your slides', 'Layouts and themes', 'Speaker notes', 'Present', 'Export'],
    open: createFromDrive('Presentation', /\/slides\/editor\/?\?id=/),
  },
  {
    id: 'notes',
    name: 'Notes',
    steps: ['Type / for anything', 'Link your notes', 'Synced live'],
    open: createFromDrive('Note', /\/notes\/editor\/?\?id=/),
  },
  {
    id: 'photos',
    name: 'Photos',
    // "Open a photo to edit it" points at the first photo, and a new library has none.
    steps: ['Upload', 'Albums, People and Memories', 'Favorites and Archive', 'Photo info and Suggestions'],
    open: async (page) => {
      await page.goto('/photos');
    },
  },
  {
    id: 'calendar',
    name: 'Calendar',
    steps: ['New event', 'Month, Week and Agenda', 'Your calendars', 'Reminders', 'Tasks'],
    open: async (page) => {
      await page.goto('/calendar');
    },
  },
  {
    id: 'diagrams',
    name: 'Diagrams',
    steps: ['Shapes', 'Connect shapes', 'Generate a diagram', 'Save as SVG'],
    open: createFromDrive('Diagram', /\/diagrams\/editor\/?\?id=/),
  },
  {
    id: 'drawing',
    name: 'Drawings',
    steps: ['Tools', 'Layers', 'Brush and colour', 'Export'],
    open: createFromDrive('Drawing', /\/drawing\/editor\/?\?id=/),
  },
];

function uniqueEmail(): string {
  return `apptour_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function patchPrefs(request: APIRequestContext, token: string, values: Record<string, unknown>): Promise<void> {
  const res = await request.patch(`${BASE_URL}/api/v1/preferences`, {
    data: { values },
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `preferences patch failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

/**
 * A new account, signed in, its encryption set up and Drive's tour already seen — then tours are
 * allowed to start by themselves on this device.
 */
async function newUser(request: APIRequestContext, page: Page): Promise<string> {
  const email = uniqueEmail();
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'App Tour User', email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);
  const token = (await page.evaluate(() => localStorage.getItem('access_token')))!;
  await patchPrefs(request, token, { 'onboarding.toursSeen': ['drive'] });
  await page.evaluate(() => localStorage.setItem('neutrino.tours.autoStart', 'on'));
  return token;
}

async function toursSeen(request: APIRequestContext, token: string): Promise<unknown> {
  const res = await request.get(`${BASE_URL}/api/v1/preferences`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { values: Record<string, unknown> }).values['onboarding.toursSeen'];
}

function tour(page: Page, app: AppCase): Locator {
  return page.getByRole('dialog', { name: `${app.name} tour` });
}

/** Starts by itself, walks every step forward and back, Done marks it seen. */
async function walk(page: Page, app: AppCase): Promise<void> {
  const card = tour(page, app);
  const total = app.steps.length;
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText(`1 of ${total}`);
  await expect(card).toContainText(app.steps[0]);
  await expect(card.getByRole('button', { name: 'Back' })).toBeDisabled();
  await expect(card.getByRole('button', { name: total > 1 ? 'Next' : 'Done' })).toBeFocused();
  for (let i = 1; i < total; i++) {
    await card.getByRole('button', { name: 'Next' }).click();
    await expect(card).toContainText(`${i + 1} of ${total}`);
    await expect(card.getByRole('heading')).toHaveText(app.steps[i]);
    // The spotlight is on something: every step shown has its target on screen.
    const box = await page.getByTestId('tour-spotlight').boundingBox();
    expect(box && box.width > 0 && box.height > 0, `step ${i + 1} has a spotlight`).toBeTruthy();
  }
  await card.getByRole('button', { name: 'Back' }).click();
  await expect(card).toContainText(`${total - 1} of ${total}`);
  await page.keyboard.press('ArrowRight');
  await expect(card).toContainText(`${total} of ${total}`);
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(card).toHaveCount(0);
}

for (const app of APPS) {
  test.describe(`${app.name} tour`, () => {
    test('starts by itself the first time, walks every step, and does not come back', async ({ page, request }) => {
      const token = await newUser(request, page);
      await app.open(page);
      await walk(page, app);
      await expect.poll(() => toursSeen(request, token), { timeout: 10_000 }).toEqual(['drive', app.id]);

      await page.reload();
      // Long enough for a tour that was going to start by itself to have done so.
      await page.waitForTimeout(3_000);
      await expect(tour(page, app)).toHaveCount(0);
    });

    test('replays from the account menu', async ({ page, request }) => {
      const token = await newUser(request, page);
      await app.open(page);
      await expect(tour(page, app)).toBeVisible({ timeout: 20_000 });
      await page.keyboard.press('Escape');
      await expect(tour(page, app)).toHaveCount(0);
      await expect.poll(() => toursSeen(request, token), { timeout: 10_000 }).toEqual(['drive', app.id]);

      await page.getByRole('button', { name: 'User menu' }).click();
      await page.getByRole('menuitem', { name: `Take the ${app.name} tour` }).click();
      await expect(tour(page, app)).toContainText(`1 of ${app.steps.length}`);
      await expect(tour(page, app)).toContainText(app.steps[0]);
    });
  });
}

test.describe('Replaying an app tour', () => {
  const docs = APPS.find((a) => a.id === 'docs')!;
  const calendar = APPS.find((a) => a.id === 'calendar')!;
  const photos = APPS.find((a) => a.id === 'photos')!;

  test('from an editor’s title bar in Blended, and not from the library', async ({ page, request }) => {
    const token = await newUser(request, page);
    await patchPrefs(request, token, { 'onboarding.toursSeen': ['drive', 'docs'], 'appearance.look': 'blended' });
    // The library has no document to tour, so it offers no Docs tour.
    await page.goto('/docs');
    await page.getByRole('button', { name: 'Account' }).click();
    await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Take the Docs tour' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await docs.open(page);
    await page.waitForTimeout(2_000);
    await expect(tour(page, docs)).toHaveCount(0);
    // The editor frame has no top bar: the account menu is at the end of the editor's title bar.
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('menuitem', { name: 'Take the Docs tour' }).click();
    await expect(tour(page, docs)).toContainText(`1 of ${docs.steps.length}`);
  });

  test('from elsewhere in Photos goes back to the library first', async ({ page, request }) => {
    const token = await newUser(request, page);
    await patchPrefs(request, token, { 'onboarding.toursSeen': ['drive', 'photos'] });
    await page.goto('/photos/map');
    await page.getByRole('button', { name: 'User menu' }).click();
    await page.getByRole('menuitem', { name: 'Take the Photos tour' }).click();
    await expect(page).toHaveURL(/\/photos\/?$/);
    await expect(tour(page, photos)).toContainText(`1 of ${photos.steps.length}`);
  });

  test('from the palette', async ({ page, request }) => {
    const token = await newUser(request, page);
    await patchPrefs(request, token, { 'onboarding.toursSeen': ['drive', 'calendar'] });
    await page.goto('/calendar');
    await expect(page.locator('[data-tour="calendar-new"]')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Search and commands' }).click();
    await page.keyboard.type('Take the tour');
    await page.getByRole('option', { name: /Take the tour of this app/ }).click();
    await expect(tour(page, calendar)).toContainText(`1 of ${calendar.steps.length}`);
  });
});
