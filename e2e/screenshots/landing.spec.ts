/**
 * Captures the web app screenshots on the landing page (`web/apps/web/public/screenshots/`).
 *
 * Not part of the e2e suite — `screenshots.config.ts` points at this folder and the suite's own
 * config does not. It runs against the same disposable Docker stack, so the account and its
 * content never touch a real database:
 *
 *   cd e2e && pnpm screenshots
 *
 * One demo account, in the Blended Flow look, with content seeded the way a person would add it:
 * office files and notes dropped on Drive's upload dialog, photos through Photos' own upload, so
 * everything is encrypted on the way in exactly as it is for real. Each screen is captured at a
 * 1600×1000 viewport at 2× and scaled to the 2000×1250 the showcase reserves (see the README
 * beside the screenshots).
 */

import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setUpEncryption } from '../fixtures/e2ee';
import { DECK_NAME, DOC_NAME, NOTE_NAME, SHEET_NAME, demoFiles } from './demoContent';

const BASE_URL = 'http://localhost:9880';
const OUT_DIR = path.resolve(__dirname, '../../web/apps/web/public/screenshots');
const LOOK = 'blended';

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<string> {
  const email = `ada_${Date.now()}@example.com`;
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Ada Lovelace', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('no access token after sign-in');
  return token;
}

async function api(request: APIRequestContext, token: string, method: 'post' | 'patch', url: string, data: unknown) {
  const res = await request[method](`${BASE_URL}${url}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data,
  });
  expect(res.ok(), `${method.toUpperCase()} ${url} failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** Drop files on Drive's upload dialog, as a person dragging them in from Finder would. */
async function uploadToDrive(page: Page, files: { name: string; mimeType: string; bytes: Buffer }[]) {
  await page.goto('/drive');
  await page.getByRole('button', { name: 'Create new item' }).click();
  await page.getByRole('menuitem', { name: 'Upload' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload files' });
  await expect(dialog).toBeVisible();
  const dataTransfer = await page.evaluateHandle(
    (list) => {
      const dt = new DataTransfer();
      for (const f of list) {
        const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], f.name, { type: f.mimeType }));
      }
      return dt;
    },
    files.map((f) => ({ name: f.name, mimeType: f.mimeType, b64: f.bytes.toString('base64') })),
  );
  await dialog.getByRole('button', { name: 'Drag & drop files here' }).dispatchEvent('drop', { dataTransfer });
  const bars = dialog.locator('[role="progressbar"]');
  await expect(bars).toHaveCount(files.length, { timeout: 30_000 });
  for (let i = 0; i < files.length; i += 1) {
    await expect(bars.nth(i)).toHaveAttribute('aria-valuenow', '100', { timeout: 60_000 });
  }
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Landscape "photos", painted in the page so Chromium can decode them for thumbnails: a sky
 * gradient, a sun, three ridges of hills and a lake. Procedural rather than downloaded, so the
 * capture needs nothing from the network and the images carry no one's copyright.
 */
async function paintPhotos(page: Page, count: number): Promise<Buffer[]> {
  const encoded = await page.evaluate((n) => {
    const palettes = [
      ['#ffb88c', '#de6262', '#3b1f47', '#26173a', '#140d22'],
      ['#a1c4fd', '#c2e9fb', '#5b8c6a', '#3f6b50', '#284836'],
      ['#fbd786', '#f7797d', '#6b4c7a', '#4a3459', '#2d1f38'],
      ['#89f7fe', '#66a6ff', '#4a6fa5', '#33507a', '#1f3350'],
      ['#fdfbfb', '#ebedee', '#9aa5b1', '#6f7c8a', '#47525e'],
      ['#f6d365', '#fda085', '#9b5d4b', '#6e3f34', '#43251f'],
      ['#d4fc79', '#96e6a1', '#4e8d5b', '#356a43', '#20452b'],
      ['#e0c3fc', '#8ec5fc', '#5d6fb0', '#424f86', '#2a335a'],
    ];
    const out: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const [skyTop, skyLow, far, mid, near] = palettes[i % palettes.length];
      const c = document.createElement('canvas');
      c.width = 1600;
      c.height = 1067;
      const g = c.getContext('2d')!;
      const sky = g.createLinearGradient(0, 0, 0, c.height * 0.7);
      sky.addColorStop(0, skyTop);
      sky.addColorStop(1, skyLow);
      g.fillStyle = sky;
      g.fillRect(0, 0, c.width, c.height);
      const sx = 300 + ((i * 397) % 1000);
      const sy = 260 + ((i * 131) % 220);
      const sun = g.createRadialGradient(sx, sy, 10, sx, sy, 220);
      sun.addColorStop(0, 'rgba(255,255,240,0.95)');
      sun.addColorStop(0.25, 'rgba(255,245,220,0.6)');
      sun.addColorStop(1, 'rgba(255,240,220,0)');
      g.fillStyle = sun;
      g.fillRect(0, 0, c.width, c.height);
      const ridge = (base: number, amp: number, color: string, seed: number) => {
        g.beginPath();
        g.moveTo(0, c.height);
        for (let x = 0; x <= c.width; x += 8) {
          const y = base
            + Math.sin((x + seed * 97) / 210) * amp
            + Math.sin((x + seed * 53) / 83) * amp * 0.35
            + Math.sin((x + seed * 29) / 31) * amp * 0.08;
          g.lineTo(x, y);
        }
        g.lineTo(c.width, c.height);
        g.closePath();
        g.fillStyle = color;
        g.fill();
      };
      ridge(c.height * 0.55, 60, far, i + 1);
      ridge(c.height * 0.66, 45, mid, i + 7);
      if (i % 2 === 0) {
        const lake = g.createLinearGradient(0, c.height * 0.78, 0, c.height);
        lake.addColorStop(0, skyLow);
        lake.addColorStop(1, near);
        g.fillStyle = lake;
        g.fillRect(0, c.height * 0.78, c.width, c.height * 0.22);
      } else {
        ridge(c.height * 0.8, 30, near, i + 13);
      }
      out.push(c.toDataURL('image/jpeg', 0.88).split(',')[1]);
    }
    return out;
  }, count);
  return encoded.map((b64) => Buffer.from(b64, 'base64'));
}

const PHOTO_NAMES = [
  'Lake at dawn', 'Ridge walk', 'Evening glow', 'Blue hour', 'Winter haze', 'Desert road',
  'Spring valley', 'Twilight', 'Harbour', 'Pass at noon', 'Golden hour', 'Fjord', 'Highlands',
  'Coast path', 'Summit', 'Sunset over the bay',
];

async function uploadPhotos(page: Page) {
  await page.goto('/photos');
  const photos = await paintPhotos(page, PHOTO_NAMES.length);
  const registered = page.waitForResponse(
    (r) => r.url().includes('/api/v1/photos') && r.request().method() === 'POST',
    { timeout: 60_000 },
  );
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Upload Photos', exact: true }).click(),
  ]);
  await chooser.setFiles(
    photos.map((buffer, i) => ({ name: `${PHOTO_NAMES[i]}.jpg`, mimeType: 'image/jpeg', buffer })),
  );
  await registered;
  // Every tile drawn from its own thumbnail before moving on.
  await expect
    .poll(() => page.locator('main img').count(), { timeout: 90_000 })
    .toBeGreaterThanOrEqual(PHOTO_NAMES.length);
}

/** This week's events, Monday to Friday, at times that fill the week view's working hours. */
async function seedCalendar(request: APIRequestContext, token: string) {
  const now = new Date();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const at = (day: number, h: number, m = 0) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + day);
    d.setHours(h, m, 0, 0);
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  };
  const events: [string, number, number, number, number, number][] = [
    ['Team standup', 0, 9, 30, 10, 0],
    ['Design review — Quick access', 0, 13, 0, 14, 0],
    ['Sync protocol deep dive', 1, 10, 0, 11, 30],
    ['1:1 with Grace', 1, 15, 0, 15, 30],
    ['Team standup', 2, 9, 30, 10, 0],
    ['Customer call — Analytical Engines Ltd', 2, 11, 0, 12, 0],
    ['Lunch & learn: key rotation', 2, 12, 30, 13, 30],
    ['Release planning', 3, 14, 0, 15, 30],
    ['Team standup', 4, 9, 30, 10, 0],
    ['Demo day', 4, 16, 0, 17, 0],
  ];
  for (const [title, day, sh, sm, eh, em] of events) {
    await api(request, token, 'post', '/api/v1/calendar/events', {
      title,
      startTime: at(day, sh, sm),
      endTime: at(day, eh, em),
      allDay: false,
    });
  }
}

/** Screenshot at 2× and scale to the showcase's 2000×1250 with `sips` (macOS). */
async function capture(page: Page, name: string) {
  await page.mouse.move(1599, 999);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  const raw = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'landing-')), `${name}.png`);
  await page.screenshot({ path: raw });
  const out = path.join(OUT_DIR, `${name}.png`);
  execFileSync('sips', ['--resampleHeightWidth', '1250', '2000', raw, '--out', out], { stdio: 'ignore' });
}

async function openFromDrive(page: Page, name: string) {
  await page.goto('/drive');
  await page.getByRole('listitem', { name }).first().dblclick();
}

test('landing page screenshots', async ({ page, request }) => {
  test.setTimeout(15 * 60_000);

  const token = await registerAndLogin(request, page);

  // Synced preferences, so every page after this renders with them: the look, and no spelling
  // squiggles under product words like "macOS" and "ciphertext".
  await request.patch(`${BASE_URL}/api/v1/preferences`, {
    data: { values: { 'appearance.look': LOOK, 'docs.spellCheck': false } },
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }).then(async (res) => expect(res.ok(), `preferences: ${res.status()} ${await res.text()}`).toBeTruthy());
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-look', LOOK);

  for (const name of ['Design', 'Engineering', 'Finance', 'Marketing', 'Product']) {
    await api(request, token, 'post', '/api/v1/drive/folders', { name });
  }
  await uploadPhotos(page);
  await uploadToDrive(page, await demoFiles());
  await seedCalendar(request, token);

  // Quick access: the office files are the most recent; a star on two of them as well.
  const recent = (await (await request.get(`${BASE_URL}/api/v1/drive/recent?limit=50`, {
    headers: { Authorization: `Bearer ${token}` },
  })).json()) as { files: { id: string; name: string }[] };
  for (const name of [SHEET_NAME, DECK_NAME]) {
    const file = recent.files.find((f) => f.name === name);
    if (file) await api(request, token, 'patch', `/api/v1/drive/files/${file.id}`, { isStarred: true });
  }

  // ── Drive ───────────────────────────────────────────────────────────────
  await page.goto('/drive');
  await expect(page.getByRole('heading', { name: 'Quick access' })).toBeVisible();
  await expect(page.getByRole('button', { name: `Open ${DOC_NAME}` })).toBeVisible({ timeout: 30_000 });
  await capture(page, 'drive');

  // ── Docs ────────────────────────────────────────────────────────────────
  await openFromDrive(page, DOC_NAME);
  await expect(page.locator('.ProseMirror')).toContainText('Engineering Brief', { timeout: 30_000 });
  await capture(page, 'docs');

  // ── Sheets ──────────────────────────────────────────────────────────────
  await openFromDrive(page, SHEET_NAME);
  await expect(page.locator('[data-type="cell"]').filter({ hasText: 'Net ARR' }).first()).toBeVisible({ timeout: 30_000 });
  // Bold the header row and the totals, which SheetJS's community build cannot write, then rest
  // the selection on a plain value so no cell is open showing its formula.
  const cell = (text: string) => page.locator('[data-type="cell"]').filter({ hasText: new RegExp(`^${text.replace(/[$]/g, '\\$')}$`) }).first();
  await cell('Quarter').click();
  await cell('Growth QoQ').click({ modifiers: ['Shift'] });
  await page.keyboard.press('ControlOrMeta+b');
  await cell('Total').click();
  await cell('$2,362,000').click({ modifiers: ['Shift'] });
  await page.keyboard.press('ControlOrMeta+b');
  await cell('$604,000').click();
  await capture(page, 'sheets');

  // ── Slides ──────────────────────────────────────────────────────────────
  await openFromDrive(page, DECK_NAME);
  await expect(page.getByText('Your files, encrypted on your devices').first()).toBeVisible({ timeout: 30_000 });
  await capture(page, 'slides');

  // ── Notes ───────────────────────────────────────────────────────────────
  await openFromDrive(page, NOTE_NAME);
  await expect(page.getByText('Things to bring').first()).toBeVisible({ timeout: 30_000 });
  await capture(page, 'notes');

  // ── Photos ──────────────────────────────────────────────────────────────
  await page.goto('/photos');
  await expect.poll(() => page.locator('main img').count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(PHOTO_NAMES.length);
  await expect
    .poll(() => page.locator('main img').evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)))
    .toBe(true);
  await capture(page, 'photos');

  // ── Calendar ────────────────────────────────────────────────────────────
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await expect(page.getByText('Sync protocol deep dive').first()).toBeAttached({ timeout: 30_000 });
  // The working day, not midnight: the week view opens scrolled to its top.
  await page.getByText('8 AM', { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await capture(page, 'calendar');
});
