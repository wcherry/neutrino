/**
 * A diagram is stored in one of two formats — its own JSON, or a plain `.svg`
 * with the diagram inside it — and the editor opens and saves either one.
 *
 * The unit tests pin down the format itself (`svgFormat.test.ts`). What is only
 * checkable here is that the whole loop closes against the real backend: a copy
 * saved as SVG becomes a Drive file with the SVG mime type, that file reopens
 * on the canvas with its shapes intact, and an SVG that Neutrino did *not*
 * write is refused rather than overwritten.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const BASE_URL = 'http://localhost:9880';
const DIAGRAM_MIME = 'application/x-neutrino-diagram';
const SVG_MIME = 'image/svg+xml';

function uniqueEmail(): string {
  return `diagrams_svg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'SVG Test User', email, password },
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

async function token(page: Page): Promise<string> {
  const t = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!t) throw new Error('access_token not found');
  return t;
}

/** Create a Drive file directly, so a test can start from a file of any type. */
async function createFile(
  request: APIRequestContext,
  page: Page,
  opts: { name: string; mimeType: string; initialContent?: string },
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/drive/files`, {
    headers: { Authorization: `Bearer ${await token(page)}`, 'Content-Type': 'application/json' },
    data: {
      id: randomUUID(),
      name: opts.name,
      mimeType: opts.mimeType,
      folderId: null,
      ...(opts.initialContent ? { initialContent: opts.initialContent } : {}),
    },
  });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const { id } = (await res.json()) as { id: string };
  return id;
}

async function openEditor(page: Page, id: string): Promise<void> {
  await page.goto(`/diagrams/editor?id=${id}`);
}

async function openCanvas(page: Page, id: string): Promise<void> {
  await openEditor(page, id);
  await expect(page.getByTitle('Select (V)')).toBeVisible({ timeout: 15_000 });
}

async function listFiles(request: APIRequestContext, page: Page, mimeType: string) {
  const res = await request.get(
    `${BASE_URL}/api/v1/drive/files?mimeType=${encodeURIComponent(mimeType)}&limit=200`,
    { headers: { Authorization: `Bearer ${await token(page)}` } },
  );
  expect(res.ok(), `list failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { files: Array<{ id: string; name: string }> }).files ?? [];
}

test.describe('Diagrams — the SVG storage format', () => {
  /**
   * The export used to be a picture and nothing more. It now carries the
   * diagram in a `<metadata>` element, which is what makes the download a file
   * that can be dragged back in rather than a dead end.
   */
  test('an exported SVG carries the diagram inside it', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const id = await createFile(request, page, { name: 'Exported', mimeType: DIAGRAM_MIME });
    await openCanvas(page, id);

    await page.getByTitle('Rectangle').first().click();

    await page.getByTitle('Export diagram').click();
    await expect(page.getByText('JSON — Neutrino diagram format')).toBeVisible({ timeout: 5_000 });
    await page.getByText('SVG — Scalable vector graphic').click();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByRole('button', { name: /^export$/i }).last().click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.svg$/);

    const path = await download.path();
    expect(path).toBeTruthy();
    const markup = await readFile(path!, 'utf8');
    expect(markup).toContain('<svg');
    expect(markup).toContain('id="neutrino-diagram"');
  });

  /**
   * The round trip that the whole format exists for: save a copy as SVG, then
   * open that copy and find the diagram — not a picture of it.
   */
  test('a copy saved as SVG is a real Drive SVG that reopens on the canvas', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const id = await createFile(request, page, { name: 'Round Trip', mimeType: DIAGRAM_MIME });
    await openCanvas(page, id);

    // A shape with a label, so "the diagram came back" is checkable.
    await page.getByTitle('Rectangle').first().click();
    await expect(page.locator('svg [data-shape-id], svg path').first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('button', { name: 'Save a copy as SVG…' }).click();

    await expect(page.getByText('SVG Image (.svg) — reopens in Diagrams')).toBeVisible({
      timeout: 5_000,
    });
    await page.getByRole('button', { name: 'Neutrino Drive' }).click();
    await page.getByRole('button', { name: 'Save to Drive' }).click();

    // The copy is a Drive file carrying the SVG mime type — not a private one.
    let copies: Array<{ id: string; name: string }> = [];
    await expect
      .poll(async () => {
        copies = await listFiles(request, page, SVG_MIME);
        return copies.length;
      }, { timeout: 20_000 })
      .toBeGreaterThan(0);
    expect(copies[0].name).toMatch(/\.svg$/);

    // And it opens as the diagram, on the canvas, with the shape still there.
    await openCanvas(page, copies[0].id);
    await expect(page.locator('svg path').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/will not save over it/i)).toHaveCount(0);
  });

  /**
   * Every SVG in Drive now opens in Diagrams, and most of them were never
   * diagrams. The editor has nothing to load from one, so opening it as a blank
   * canvas would let the autosave write an empty diagram over somebody's
   * artwork — which is the failure this screen exists to prevent.
   */
  test('an SVG Neutrino did not write is shown, not opened and overwritten', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const artwork =
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">' +
      '<circle cx="40" cy="40" r="36" fill="#2563eb"/></svg>';
    const id = await createFile(request, page, {
      name: 'logo.svg',
      mimeType: SVG_MIME,
      initialContent: artwork,
    });

    await openEditor(page, id);

    await expect(page.getByText(/will not save over it/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTitle('Select (V)')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Create a diagram from this image' }),
    ).toBeVisible();

    // Well past the autosave debounce, the file is still byte-for-byte itself.
    await page.waitForTimeout(5_000);
    const res = await request.get(`${BASE_URL}/api/v1/drive/files/${id}`, {
      headers: { Authorization: `Bearer ${await token(page)}` },
    });
    expect(res.ok()).toBeTruthy();
    expect(await res.text()).toBe(artwork);
  });

  /** The way forward from that screen: a new diagram built around the picture. */
  test('a foreign SVG can be turned into a diagram without changing the original', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const artwork =
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">' +
      '<rect width="80" height="80" fill="#16a34a"/></svg>';
    const id = await createFile(request, page, {
      name: 'badge.svg',
      mimeType: SVG_MIME,
      initialContent: artwork,
    });

    await openEditor(page, id);
    await page.getByRole('button', { name: 'Create a diagram from this image' }).click();

    // A different file, on the canvas, leaving the SVG alone.
    await expect(page).toHaveURL(new RegExp(`/diagrams/editor\\?id=(?!${id})`), {
      timeout: 20_000,
    });
    await expect(page.getByTitle('Select (V)')).toBeVisible({ timeout: 15_000 });

    const res = await request.get(`${BASE_URL}/api/v1/drive/files/${id}`, {
      headers: { Authorization: `Bearer ${await token(page)}` },
    });
    expect(await res.text()).toBe(artwork);
  });
});
