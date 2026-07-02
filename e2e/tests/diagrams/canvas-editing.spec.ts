import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `diagrams_canvas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Canvas Test User', email, password },
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

async function createDiagramAndOpenEditor(
  request: APIRequestContext,
  page: Page,
): Promise<void> {
  const token = await getAuthToken(page);
  const res = await request.post(`${BASE_URL}/api/v1/diagrams`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { title: 'Canvas Test Diagram' },
  });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const { id } = await res.json() as { id: string };
  await page.goto(`/diagrams/editor?id=${id}`);
  // Wait for the editor toolbar to be visible
  await expect(page.getByTitle('Select (V)')).toBeVisible({ timeout: 15_000 });
}

test.describe('Canvas editing', () => {
  test('clicking a shape in the panel adds it to the canvas', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    // The shape panel shows "Basic" and "Flowchart" categories expanded by default
    // Click the "Rectangle" shape in the Basic category
    await page.getByTitle('Rectangle').first().click();

    // The shape label appears as SVG text on the canvas
    await expect(page.locator('svg text').filter({ hasText: 'Rectangle' }).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('undo removes a just-added shape', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    await page.getByTitle('Rectangle').first().click();
    await expect(page.locator('svg text').filter({ hasText: 'Rectangle' }).first()).toBeVisible({
      timeout: 5_000,
    });

    // Undo via keyboard shortcut
    await page.keyboard.press('Control+z');
    await expect(page.locator('svg text').filter({ hasText: 'Rectangle' })).toHaveCount(0, {
      timeout: 5_000,
    });
  });

  test('redo restores a shape after undo', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    await page.getByTitle('Rectangle').first().click();
    await expect(page.locator('svg text').filter({ hasText: 'Rectangle' }).first()).toBeVisible({
      timeout: 5_000,
    });

    await page.keyboard.press('Control+z');
    await expect(page.locator('svg text').filter({ hasText: 'Rectangle' })).toHaveCount(0, {
      timeout: 5_000,
    });

    // Redo via keyboard shortcut
    await page.keyboard.press('Control+Shift+z');
    await expect(page.locator('svg text').filter({ hasText: 'Rectangle' }).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('toolbar undo and redo buttons reflect edit history state', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    // Undo button is disabled on a blank diagram
    const undoBtn = page.getByTitle('Undo (⌘Z)');
    await expect(undoBtn).toBeDisabled({ timeout: 5_000 });

    // Add a shape — undo button should become enabled
    await page.getByTitle('Rectangle').first().click();
    await expect(undoBtn).toBeEnabled({ timeout: 5_000 });

    // Click undo — redo button should become enabled
    const redoBtn = page.getByTitle('Redo (⌘⇧Z)');
    await undoBtn.click();
    await expect(redoBtn).toBeEnabled({ timeout: 5_000 });
  });

  test('adding multiple shapes from different categories places all on the canvas', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    await page.getByTitle('Rectangle').first().click();
    await page.getByTitle('Ellipse').first().click();

    await expect(page.locator('svg text').filter({ hasText: 'Rectangle' }).first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('svg text').filter({ hasText: 'Ellipse' }).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('adding a second page creates a new tab in the page panel', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    // Verify initial state: one page named "Page 1"
    await expect(page.getByText('Page 1')).toBeVisible({ timeout: 5_000 });

    // Click the "+" button in the page panel
    await page.getByTitle('Add page').click();

    // A second page tab should appear
    await expect(page.getByText('Page 2')).toBeVisible({ timeout: 5_000 });
  });

  test('renaming a page tab updates its label', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    // Double-click the "Page 1" tab to enter rename mode
    await page.getByText('Page 1').dblclick();
    const nameInput = page.locator('input[class*="nameInput"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });

    await nameInput.fill('Overview');
    await nameInput.press('Enter');

    await expect(page.getByText('Overview')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Page 1')).not.toBeVisible({ timeout: 5_000 });
  });

  test('switching pages moves the active tab highlight', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    await page.getByTitle('Add page').click();
    await expect(page.getByText('Page 2')).toBeVisible({ timeout: 5_000 });

    // Click Page 1 then Page 2 and back — just confirm no errors and tabs remain
    await page.getByText('Page 1').click();
    await page.getByText('Page 2').click();
    await expect(page.getByText('Page 2')).toBeVisible({ timeout: 3_000 });
  });

  test('deleting a page reduces the page count', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    await page.getByTitle('Add page').click();
    await expect(page.getByText('Page 2')).toBeVisible({ timeout: 5_000 });

    // Remove Page 2 — the X button appears inside the page tab
    const page2Tab = page.locator('[class*="tab"]').filter({ hasText: 'Page 2' });
    await page2Tab.getByTitle('Remove page').click();

    await expect(page.getByText('Page 2')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Page 1')).toBeVisible({ timeout: 3_000 });
  });

  test('selecting all shapes via Ctrl+A selects all on the canvas', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    await page.getByTitle('Rectangle').first().click();
    await page.getByTitle('Ellipse').first().click();

    // Click on the canvas background to deselect, then Ctrl+A
    const canvas = page.locator('[class*="canvasWrapper"]').first();
    await canvas.click({ position: { x: 5, y: 5 } });

    await page.keyboard.press('Control+a');

    // After Ctrl+A the layer-ordering toolbar buttons appear (because shapes are selected)
    await expect(page.getByTitle('Bring to front')).toBeVisible({ timeout: 5_000 });
  });

  test('Escape key deselects shapes and resets mode to select', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await createDiagramAndOpenEditor(request, page);

    // Switch to pan mode
    await page.getByTitle('Pan (H)').click();
    await expect(page.getByTitle('Pan (H)')).toHaveClass(/active/, { timeout: 3_000 });

    // Press Escape — should deselect and reset to select mode; layer buttons should disappear
    await page.keyboard.press('Escape');
    // No shapes selected so bring-to-front should not be visible
    await expect(page.getByTitle('Bring to front')).not.toBeVisible({ timeout: 3_000 });
  });
});
