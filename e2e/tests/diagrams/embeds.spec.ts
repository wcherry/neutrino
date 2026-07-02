import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `diagrams_embed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Embed Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

async function getAuthToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return token;
}

async function createDiagramViaApi(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/diagrams`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { title },
  });
  expect(res.ok(), `create diagram failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = await res.json() as { id: string };
  return data.id;
}

async function createDocViaApi(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/docs`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { title },
  });
  expect(res.ok(), `create doc failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const data = await res.json() as { id: string };
  return data.id;
}

test.describe('Diagram embeds in docs', () => {
  test('insert diagram dialog shows created diagrams', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);

    // Create a diagram and a doc
    await createDiagramViaApi(request, token, 'Embeddable Diagram');
    const docId = await createDocViaApi(request, token, 'Doc With Diagram');

    // Open the doc editor
    await page.goto(`/docs/editor?id=${docId}`);
    await expect(page.locator('[contenteditable="true"]').first()).toBeVisible({ timeout: 15_000 });

    // Open the insert diagram dialog via the toolbar
    await page.getByTitle('Insert diagram').click();

    await expect(page.getByRole('heading', { name: 'Insert Diagram' })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText('Embeddable Diagram')).toBeVisible({ timeout: 5_000 });
  });

  test('inserting a diagram embeds it in the doc editor', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);

    await createDiagramViaApi(request, token, 'Embedded Flow');
    const docId = await createDocViaApi(request, token, 'Doc With Embed');

    await page.goto(`/docs/editor?id=${docId}`);
    await expect(page.locator('[contenteditable="true"]').first()).toBeVisible({ timeout: 15_000 });

    // Click the insert diagram toolbar button
    await page.getByTitle('Insert diagram').click();
    await expect(page.getByText('Embedded Flow')).toBeVisible({ timeout: 5_000 });

    // Select the diagram
    await page.getByText('Embedded Flow').click();

    // Click the Insert button in the dialog
    await page.getByRole('button', { name: 'Insert', exact: true }).click();

    // The dialog should close and an embedded diagram node should appear in the doc
    await expect(page.getByRole('heading', { name: 'Insert Diagram' })).not.toBeVisible({
      timeout: 5_000,
    });
    // The embedded diagram renders as a node with a title or preview
    await expect(
      page.locator('[data-diagram-embed], [class*="diagramEmbed"], [class*="embedded"]')
        .or(page.getByText('Embedded Flow'))
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('inserting a diagram embed persists after doc reload', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);

    await createDiagramViaApi(request, token, 'Persistent Embed');
    const docId = await createDocViaApi(request, token, 'Reload Test Doc');

    await page.goto(`/docs/editor?id=${docId}`);
    await expect(page.locator('[contenteditable="true"]').first()).toBeVisible({ timeout: 15_000 });

    await page.getByTitle('Insert diagram').click();
    await expect(page.getByText('Persistent Embed')).toBeVisible({ timeout: 5_000 });
    await page.getByText('Persistent Embed').click();
    await page.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Insert Diagram' })).not.toBeVisible({
      timeout: 5_000,
    });

    // Wait for autosave. Doc content is persisted through the generic E2EE
    // drive autosave route (/api/v1/drive/files/{id}/autosave), not /api/v1/docs/.
    await page.waitForResponse(
      (r) => r.url().includes('/autosave') && r.request().method() === 'PUT',
      { timeout: 15_000 },
    );

    // Reload and verify the embed is still there
    await page.reload();
    await expect(page.locator('[contenteditable="true"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('[data-diagram-embed], [class*="diagramEmbed"], [class*="embedded"]')
        .or(page.getByText('Persistent Embed'))
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('insert diagram dialog shows empty state when no diagrams exist', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);

    // Create only a doc — no diagrams
    const docId = await createDocViaApi(request, token, 'Empty Embed Test');
    await page.goto(`/docs/editor?id=${docId}`);
    await expect(page.locator('[contenteditable="true"]').first()).toBeVisible({ timeout: 15_000 });

    await page.getByTitle('Insert diagram').click();
    await expect(page.getByText('No diagrams found. Create one in Diagrams.')).toBeVisible({
      timeout: 5_000,
    });
  });

  test('insert diagram dialog can be cancelled without embedding', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const token = await getAuthToken(page);

    await createDiagramViaApi(request, token, 'Cancellable Diagram');
    const docId = await createDocViaApi(request, token, 'Cancel Embed Doc');

    await page.goto(`/docs/editor?id=${docId}`);
    await expect(page.locator('[contenteditable="true"]').first()).toBeVisible({ timeout: 15_000 });

    await page.getByTitle('Insert diagram').click();
    await expect(page.getByText('Cancellable Diagram')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Insert Diagram' })).not.toBeVisible({
      timeout: 5_000,
    });
  });
});
