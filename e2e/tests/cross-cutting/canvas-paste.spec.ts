import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Copying a selection in Drawing and pasting it into Docs and Slides, through
 * the real system clipboard.
 *
 * The clip rides in the clipboard's `text/html` as an attribute on an `<img>`,
 * and Chromium rewrites HTML that passes through the async clipboard API — so
 * whether the clip survives the trip is a property of the browser, not of our
 * code, and only a real copy and a real paste can show it.
 */

const BASE_URL = 'http://localhost:9880';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DRAWING = 'application/x-neutrino-drawing';

async function registerAndLogin(request: APIRequestContext, page: Page, context: BrowserContext): Promise<void> {
  const email = `canvas_paste_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Canvas Paste User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);
}

async function createFile(request: APIRequestContext, page: Page, name: string, mimeType: string): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  const res = await request.post(`${BASE_URL}/api/v1/drive/files`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { id: randomUUID(), name, mimeType, folderId: null },
  });
  expect(res.ok(), `create ${name} failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

/**
 * Pictures in the editor. ProseMirror puts a hidden `<img class="ProseMirror-separator">` after an
 * inline node that ends a line (a cursor workaround for Chrome), so a bare `img` counts it too.
 */
const pictures = (editor: ReturnType<Page['locator']>) => editor.locator('img:not(.ProseMirror-separator)');

const autosave = (page: Page) => page.waitForResponse(
  (r) => r.url().includes('/api/v1/drive/files/') && r.url().includes('/autosave') && r.ok(),
  { timeout: 15_000 },
);

/** Draws a rectangle in a new drawing, waits for it to be saved, and copies it. */
async function copyRectangleFromDrawing(request: APIRequestContext, page: Page): Promise<void> {
  const id = await createFile(request, page, 'Logo', DRAWING);
  await page.goto(`/drawing/editor?id=${id}`);
  await expect(page.getByLabel('Drawing title')).toBeVisible({ timeout: 15_000 });

  await page.getByLabel('Rectangle').click();
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas not found');
  const saved = autosave(page);
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 200, { steps: 10 });
  await page.mouse.up();
  await saved;

  // The new rectangle is the selection; select it explicitly in case a tool change cleared it.
  await page.getByLabel('Select', { exact: true }).click();
  await page.mouse.click(box.x + 175, box.y + 150);
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(
    () => page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types)),
    { timeout: 10_000 },
  ).toEqual(expect.arrayContaining(['image/png', 'text/html']));
}

async function openDoc(request: APIRequestContext, page: Page) {
  const id = await createFile(request, page, 'Report', DOCX);
  await page.goto(`/docs/editor?id=${id}`);
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.click();
  return editor;
}

test.describe('Pasting a Drawing selection', () => {
  test('into a doc as a live drawing, which survives a reload', async ({ page, request, context }) => {
    await registerAndLogin(request, page, context);
    await copyRectangleFromDrawing(request, page);
    const editor = await openDoc(request, page);

    await page.keyboard.press('ControlOrMeta+v');
    await expect(page.getByTestId('canvas-paste-dialog')).toBeVisible({ timeout: 5_000 });
    // Nothing is inserted until a choice is made — the clipboard's own HTML image included.
    await expect(pictures(editor)).toHaveCount(0);

    const saved = autosave(page);
    await page.getByTestId('paste-as-live-canvas-btn').click();
    const embed = editor.getByTestId('drawing-embed');
    await expect(embed.locator('canvas')).toBeVisible({ timeout: 15_000 });
    await saved;

    await page.reload();
    await expect(page.locator('.ProseMirror').getByTestId('drawing-embed').locator('canvas'))
      .toBeVisible({ timeout: 20_000 });
  });

  test('into a doc as a picture', async ({ page, request, context }) => {
    await registerAndLogin(request, page, context);
    await copyRectangleFromDrawing(request, page);
    const editor = await openDoc(request, page);

    await page.keyboard.press('ControlOrMeta+v');
    await page.getByTestId('paste-as-picture-btn').click();
    await expect(pictures(editor)).toHaveCount(1, { timeout: 15_000 });
    await expect(editor.getByTestId('drawing-embed')).toHaveCount(0);
  });

  test('onto a slide as a live drawing', async ({ page, request, context }) => {
    await registerAndLogin(request, page, context);
    await copyRectangleFromDrawing(request, page);
    const id = await createFile(request, page, 'Deck', PPTX);
    await page.goto(`/slides/editor?id=${id}`);
    const slide = page.locator('[data-slide-canvas]');
    await expect(slide).toBeVisible({ timeout: 15_000 });
    await slide.click({ position: { x: 5, y: 5 } });

    await page.keyboard.press('ControlOrMeta+v');
    await page.getByTestId('paste-as-live-canvas-btn').click();
    await expect(slide.locator('canvas')).toBeVisible({ timeout: 15_000 });
  });
});

test('a lone picture pasted into a doc is stored and inserted as an image', async ({ page, request, context }) => {
  await registerAndLogin(request, page, context);
  const editor = await openDoc(request, page);

  // What a screenshot puts on the clipboard: a PNG and nothing else.
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 30;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#c33';
    ctx.fillRect(0, 0, 40, 30);
    const png = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  });
  await editor.click();
  await page.keyboard.press('ControlOrMeta+v');

  await expect(pictures(editor)).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId('canvas-paste-dialog')).toHaveCount(0);
});
