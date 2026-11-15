/**
 * Drive web: press and hold a Live Photo to loop its clip until release (issue #316).
 *
 * A still and a same-named clip are uploaded through Drive's own upload dialog,
 * so both are encrypted the way a real pair is, and the clip is registered with
 * Photos carrying `metadata.motionPhoto` — what Drive iOS photo sync and the web
 * imports write — which is what confirms a name match without the browser
 * parsing the movie. The clip itself is recorded in the page with
 * `MediaRecorder`, so it is a real, playable video in the Chromium under test.
 *
 * A second pair has no such record. Its "clip" is not a QuickTime movie with
 * Apple's content identifier, so the browser's own check refuses it: the
 * acceptance criterion that an ordinary video sharing a still's name gets no
 * badge and does not loop.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption, waitForKeyring } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';
const HOLD_LABEL = 'Hold to play Live Photo';

function uniqueEmail(): string {
  return `e2e_live_hold_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Live Photo User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);
}

async function authToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return token;
}

async function userIdOf(request: APIRequestContext, token: string): Promise<string> {
  const res = await request.get(`${BASE_URL}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

/** A small JPEG and a ~1.5 s WebM clip, both made by this Chromium so it can decode them. */
async function makeMedia(page: Page): Promise<{ jpeg: number[]; clip: number[] }> {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#4488cc';
    ctx.fillRect(0, 0, 64, 48);
    const jpegB64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1] ?? '';
    const jpeg = Array.from(atob(jpegB64), (c) => c.charCodeAt(0));

    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start(100);
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const frame = () => {
        const t = performance.now() - started;
        ctx.fillStyle = `hsl(${(t / 5) % 360}, 70%, 50%)`;
        ctx.fillRect(0, 0, 64, 48);
        if (t < 1500) requestAnimationFrame(frame);
        else resolve();
      };
      frame();
    });
    recorder.stop();
    await stopped;
    const clip = Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    return { jpeg, clip };
  });
}

/** Drop files onto Drive's Upload dialog and wait for them to finish. */
async function uploadViaDrive(
  page: Page,
  files: { name: string; type: string; bytes: number[] }[],
): Promise<void> {
  await page.getByRole('button', { name: 'Create new item' }).click();
  await page.getByRole('menuitem', { name: 'Upload' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload files' });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  const dropZone = dialog.getByRole('button', { name: 'Drag & drop files here' });
  const dataTransfer = await page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.type }));
    return dt;
  }, files);
  await dropZone.dispatchEvent('drop', { dataTransfer });

  const bars = dialog.locator('[role="progressbar"]');
  await expect(bars).toHaveCount(files.length, { timeout: 10_000 });
  for (let i = 0; i < files.length; i++) {
    await expect(bars.nth(i)).toHaveAttribute('aria-valuenow', '100', { timeout: 30_000 });
  }
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
}

async function fileIdByName(request: APIRequestContext, token: string, userId: string, name: string): Promise<string> {
  const res = await request.get(`${BASE_URL}/api/v1/drive/folders/${userId}?limit=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `folder listing failed: ${res.status()}`).toBeTruthy();
  const { files } = (await res.json()) as { files: { id: string; name: string }[] };
  const match = files.find((f) => f.name === name);
  if (!match) throw new Error(`${name} is not in the drive root`);
  return match.id;
}

/** Register the clip as a Live Photo's motion half, as Drive iOS photo sync does. */
async function registerAsLiveClip(request: APIRequestContext, token: string, fileId: string): Promise<void> {
  const res = await request.post(`${BASE_URL}/api/v1/photos`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      fileId,
      metadata: {
        motionPhoto: {
          subtype: 'live_photo_apple',
          signal: 'com.apple.quicktime.content.identifier',
          contentIdentifier: 'E2E-LIVE-0001',
        },
      },
    },
  });
  expect(res.ok(), `registering the clip failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

function videoState(page: Page, scope: string) {
  return page.locator(scope).locator('video').evaluate((v: HTMLVideoElement) => ({
    paused: v.paused,
    loop: v.loop,
    currentTime: v.currentTime,
  }));
}

test.describe('Drive Live Photo hold', () => {
  test('holding a Live Photo loops its clip until release, with no click side effects', async ({ page, request }) => {
    test.setTimeout(120_000);
    await registerAndLogin(request, page);
    const token = await authToken(page);
    const userId = await userIdOf(request, token);
    await waitForKeyring(page, userId);

    const { jpeg, clip } = await makeMedia(page);
    await uploadViaDrive(page, [
      { name: 'IMG_0001.JPG', type: 'image/jpeg', bytes: jpeg },
      { name: 'IMG_0001.webm', type: 'video/webm', bytes: clip },
      { name: 'IMG_0002.JPG', type: 'image/jpeg', bytes: jpeg },
      // Same stem, but an ordinary video: no Live Photo metadata anywhere.
      { name: 'IMG_0002.webm', type: 'video/webm', bytes: clip },
    ]);
    await registerAsLiveClip(request, token, await fileIdByName(request, token, userId, 'IMG_0001.webm'));

    await page.goto('/drive');
    const live = page.getByRole('listitem', { name: 'IMG_0001.JPG' });
    const ordinary = page.getByRole('listitem', { name: 'IMG_0002.JPG' });
    await expect(live).toBeVisible({ timeout: 15_000 });

    // ── Grid: badge, and a hold that loops in place ─────────────────────────
    await expect(live.getByRole('button', { name: HOLD_LABEL })).toBeVisible({ timeout: 15_000 });

    const tileMedia = live.locator('[data-live-state]');
    await tileMedia.hover();
    await page.mouse.down();
    await expect(tileMedia).toHaveAttribute('data-live-state', 'playing', { timeout: 15_000 });
    await expect
      .poll(async () => (await videoState(page, `[role="listitem"][aria-label="IMG_0001.JPG"]`)).currentTime, {
        timeout: 5_000,
      })
      .toBeGreaterThan(0);
    const playing = await videoState(page, `[role="listitem"][aria-label="IMG_0001.JPG"]`);
    expect(playing.loop).toBe(true);
    expect(playing.paused).toBe(false);

    // Held past the clip's own length, it is still playing: it loops.
    await page.waitForTimeout(2_000);
    expect((await videoState(page, `[role="listitem"][aria-label="IMG_0001.JPG"]`)).paused).toBe(false);

    await page.mouse.up();
    await expect(tileMedia).toHaveAttribute('data-live-state', 'idle');
    expect((await videoState(page, `[role="listitem"][aria-label="IMG_0001.JPG"]`)).paused).toBe(true);
    // Releasing a hold is not a click: the picture did not open.
    await expect(page).toHaveURL(/\/drive(\?|$)/);

    // ── An ordinary video sharing the stem: no badge, no loop ───────────────
    // Its bytes are checked in the background; give that time to finish.
    await page.waitForTimeout(3_000);
    await expect(ordinary.getByRole('button', { name: HOLD_LABEL })).toHaveCount(0);

    // ── Keyboard: holding Space on the focused tile ─────────────────────────
    await live.focus();
    await page.keyboard.down(' ');
    await expect(tileMedia).toHaveAttribute('data-live-state', 'playing', { timeout: 5_000 });
    await page.keyboard.up(' ');
    await expect(tileMedia).toHaveAttribute('data-live-state', 'idle');
    await expect(page).toHaveURL(/\/drive(\?|$)/);

    // ── A short click does what it always did: opens the picture ───────────
    await live.locator('img').click();
    await expect(page).toHaveURL(/\/photos\/editor\?fileId=/, { timeout: 10_000 });
    await page.goBack();
    await expect(live).toBeVisible({ timeout: 15_000 });

    // ── Preview (from the file's menu) ──────────────────────────────────────
    await live.getByRole('button', { name: 'More options for IMG_0001.JPG' }).click();
    await page.getByRole('menuitem', { name: 'Preview' }).click();
    const preview = page.getByRole('dialog', { name: 'Preview IMG_0001.JPG' });
    await expect(preview).toBeVisible({ timeout: 10_000 });
    await expect(preview.getByRole('button', { name: HOLD_LABEL })).toBeVisible({ timeout: 15_000 });

    // ── Preview: hold loops, release returns to the still, modal stays ─────
    const previewMedia = preview.locator('[data-live-state]');
    await previewMedia.hover();
    await page.mouse.down();
    await expect(previewMedia).toHaveAttribute('data-live-state', 'playing', { timeout: 15_000 });
    await page.mouse.up();
    await expect(previewMedia).toHaveAttribute('data-live-state', 'idle');
    await expect(preview).toBeVisible();
  });
});
