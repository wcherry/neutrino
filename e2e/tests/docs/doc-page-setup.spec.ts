/**
 * Page setup end-to-end.
 *
 * Margins, orientation and page size used to be server-side state with their
 * own endpoints (`GET`/`PUT /api/v1/docs/{id}/page-setup`) and their own table.
 * They now ride in the document body's `_meta` block, beside the header/footer,
 * watermark and theme settings that were already stored there — which puts them
 * inside the E2EE payload, where the server cannot read them.
 *
 * The properties these cover, each of which fails silently:
 *   1. A customised page setup survives a reload — it is written into the body
 *      and read back out of it. This is the whole feature.
 *   2. It survives a reload of a document that has been *edited*, which is the
 *      case where the collab room holds the body and the editor skips loading
 *      the stored file over it. `_meta` is not in the Y.Doc, so it has to be
 *      read back regardless — miss that and the next autosave writes the
 *      defaults over what the user set.
 *   3. Nothing calls a page-setup endpoint any more, and the routes are gone.
 *   4. The stored bytes do not spell out the margins, which is what moving the
 *      setting inside the encrypted body actually bought.
 */

import { test, expect } from '../../fixtures/base';
import { setUpEncryption, waitForKeyring } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `e2e_doc_pagesetup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Page Setup User', email, password },
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

async function getAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return token;
}

async function getUserId(request: APIRequestContext, token: string): Promise<string> {
  const res = await request.get(`${BASE_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `profile fetch failed: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

/** Create a document through the FAB and wait for the editor to be usable. */
async function createDoc(page: Page): Promise<string> {
  await page.goto('/drive');
  await page.getByRole('button', { name: 'Create new item' }).click();
  await page.getByRole('menuitem', { name: 'Document' }).click();
  await expect(page).toHaveURL(/\/docs\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });
  const docId = new URL(page.url()).searchParams.get('id');
  expect(docId, 'doc id must be in the URL').toBeTruthy();
  return docId!;
}

/** Open hamburger → File → Page setup… */
async function openPageSetup(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('menu').getByText('File').hover();
  await page.getByText('Page setup…').click();
  await expect(page.getByText('Page setup', { exact: true })).toBeVisible({ timeout: 5_000 });
}

// The modal's labels are siblings of their controls rather than bound to them,
// so each control is located by something only it has: the page-size select is
// the one offering A4, the orientation select the one offering Landscape, and
// the margins are the four number inputs, in the order the modal renders them.
function pageSizeSelect(page: Page) {
  return page.locator('select').filter({ has: page.locator('option[value="a4"]') });
}

function orientationSelect(page: Page) {
  return page.locator('select').filter({ has: page.locator('option[value="landscape"]') });
}

function marginInputs(page: Page) {
  const inputs = page.locator('input[type="number"][step="0.001"]');
  return {
    top: inputs.nth(0),
    bottom: inputs.nth(1),
    left: inputs.nth(2),
    right: inputs.nth(3),
  };
}

/**
 * Wait until the sheet on screen is wider than US Letter.
 *
 * Two jobs. It is an assertion in its own right — the stored page setup reaches
 * the layout, not just the modal. And it is the gate every "reopen the modal"
 * step needs: `PageSetupModal` snapshots its fields into `useState` when it
 * mounts, so opening it before the document's content has been fetched and
 * decrypted would read the defaults and keep showing them, whatever loads next.
 *
 * Letter portrait with 1in margins leaves the editor 672px wide (816 − 72 − 72
 * at 96dpi). Every setup these tests apply is well past 800.
 */
async function waitForWideSheet(page: Page): Promise<void> {
  await expect
    .poll(async () => (await page.locator('.ProseMirror').boundingBox())?.width ?? 0, {
      timeout: 15_000,
      message: 'the stored page setup should have widened the sheet',
    })
    .toBeGreaterThan(800);
}

/**
 * Wait for the editor to report every change written.
 *
 * Content writes carry the revision the editor last saw, and the server rejects
 * one that arrives against a newer revision. Starting a second save while the
 * first is still in flight is therefore a real conflict, not just slow — so
 * every step that saves settles here before the next one begins.
 */
async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 20_000 });
}

/**
 * Apply a page setup and wait for the content write it triggers.
 *
 * Page setup is a content save now, so what confirms it landed is a write to
 * the drive file — there is no page-setup request to wait on any more. The
 * response status is asserted rather than merely awaited: a rejected write
 * (a stale revision, say) would otherwise show up much later as a document
 * that simply opens at the wrong size, with nothing pointing at the cause.
 */
async function applyPageSetup(
  page: Page,
  docId: string,
  setup: { pageSize?: string; orientation?: string; top?: string; bottom?: string; left?: string; right?: string },
): Promise<void> {
  if (setup.pageSize) await pageSizeSelect(page).selectOption(setup.pageSize);
  if (setup.orientation) await orientationSelect(page).selectOption(setup.orientation);
  const margins = marginInputs(page);
  if (setup.top !== undefined) await margins.top.fill(setup.top);
  if (setup.bottom !== undefined) await margins.bottom.fill(setup.bottom);
  if (setup.left !== undefined) await margins.left.fill(setup.left);
  if (setup.right !== undefined) await margins.right.fill(setup.right);

  const written = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/v1/drive/files/${docId}`) &&
      ['POST', 'PUT'].includes(r.request().method()),
    { timeout: 30_000 },
  );
  await page.getByRole('button', { name: 'Apply' }).click();
  const res = await written;
  expect(
    res.ok(),
    `the page-setup content write was rejected: ${res.status()} ${res.statusText()}`,
  ).toBeTruthy();
  await waitForSaved(page);
}

test.describe('Document page setup', () => {
  test('a new document opens at the default page setup', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDoc(page);
    await openPageSetup(page);

    await expect(pageSizeSelect(page)).toHaveValue('letter');
    await expect(orientationSelect(page)).toHaveValue('portrait');
    const margins = marginInputs(page);
    await expect(margins.top).toHaveValue('1.000');
    await expect(margins.bottom).toHaveValue('1.000');
    await expect(margins.left).toHaveValue('1.000');
    await expect(margins.right).toHaveValue('1.000');
  });

  test('a customised page setup survives a reload', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    await waitForKeyring(page, await getUserId(request, token));

    const docId = await createDoc(page);
    await openPageSetup(page);
    await applyPageSetup(page, docId, {
      pageSize: 'a4',
      orientation: 'landscape',
      top: '0.500',
      bottom: '0.500',
      left: '0.750',
      right: '0.750',
    });
    // It takes effect immediately, before any reload is involved.
    await waitForWideSheet(page);

    await page.reload();
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 15_000 });
    await waitForWideSheet(page);
    await openPageSetup(page);

    await expect(pageSizeSelect(page)).toHaveValue('a4');
    await expect(orientationSelect(page)).toHaveValue('landscape');
    const margins = marginInputs(page);
    await expect(margins.top).toHaveValue('0.500');
    await expect(margins.left).toHaveValue('0.750');
  });

  test('page setup survives a reload of a document that has been edited', async ({
    page,
    request,
  }) => {
    // The case the plain reload above cannot reach: once the document has been
    // typed into, the collab room holds the body and is seeded back into the
    // next session, so the editor does not load the stored file over it. `_meta`
    // lives only in that stored file, so it still has to be read back — and if
    // it is not, the next autosave writes the default margins over the saved
    // ones and the setting is gone for good.
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    await waitForKeyring(page, await getUserId(request, token));

    const docId = await createDoc(page);

    const editor = page.locator('[contenteditable="true"]').first();
    await editor.click();
    const typed = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/drive/files/${docId}`) &&
        ['POST', 'PUT'].includes(r.request().method()),
      { timeout: 30_000 },
    );
    await editor.pressSequentially('Body text that puts the room ahead of the file.');
    await typed;
    // The typing autosave has to be fully settled before the page-setup save
    // starts, or the second write races the first for the same revision.
    await waitForSaved(page);

    await openPageSetup(page);
    // A3 rather than Legal: Legal is a taller Letter, not a wider one, and the
    // width is what `waitForWideSheet` can see.
    await applyPageSetup(page, docId, { pageSize: 'a3', top: '0.250' });

    await page.reload();
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 15_000 });
    // The body came back from the collab room…
    await expect(page.locator('.ProseMirror')).toContainText('Body text that puts the room ahead', {
      timeout: 15_000,
    });
    // …and the page setup came back from the stored file.
    await waitForWideSheet(page);
    await openPageSetup(page);
    await expect(pageSizeSelect(page)).toHaveValue('a3');
    await expect(marginInputs(page).top).toHaveValue('0.250');
  });

  test('no page-setup endpoint is called, and the routes are gone', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    await waitForKeyring(page, await getUserId(request, token));

    const docsCalls: string[] = [];
    page.on('request', (r) => {
      const url = r.url();
      if (url.includes('/api/v1/docs/')) docsCalls.push(`${r.method()} ${url}`);
    });

    const docId = await createDoc(page);
    await openPageSetup(page);
    await applyPageSetup(page, docId, { orientation: 'landscape', left: '2.000' });
    await page.reload();
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 15_000 });

    expect(
      docsCalls.filter((c) => c.includes('page-setup')),
      'opening and restyling a document must not call a page-setup endpoint',
    ).toEqual([]);
    expect(
      docsCalls.filter((c) => c.includes('export/text')),
      'nothing may call the removed plain-text export route',
    ).toEqual([]);

    // And the routes themselves are gone, not merely unused.
    for (const [method, path] of [
      ['get', `/api/v1/docs/${docId}/page-setup`],
      ['put', `/api/v1/docs/${docId}/page-setup`],
      ['get', `/api/v1/docs/${docId}/export/text`],
    ] as const) {
      const res = await request.fetch(`${BASE_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: method === 'put' ? {} : undefined,
      });
      expect(res.status(), `${method.toUpperCase()} ${path} must no longer be routed`).toBe(404);
    }
  });

  test('the stored bytes do not reveal the page setup', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);
    await waitForKeyring(page, await getUserId(request, token));

    const docId = await createDoc(page);
    await openPageSetup(page);
    await applyPageSetup(page, docId, { pageSize: 'a3', orientation: 'landscape', top: '2.000' });

    const downloadRes = await request.get(`${BASE_URL}/api/v1/drive/files/${docId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(downloadRes.ok(), `download failed: ${downloadRes.status()}`).toBeTruthy();
    const rawText = (await downloadRes.body()).toString('utf8');

    // Page setup is inside the encrypted body now, so none of it is legible in
    // the stored bytes — the point of the move.
    expect(rawText, 'margins must not be readable in the stored bytes').not.toContain('marginTop');
    expect(rawText, 'page size must not be readable in the stored bytes').not.toContain('pageSize');
    expect(rawText, 'orientation must not be readable in the stored bytes').not.toContain('landscape');
  });
});
