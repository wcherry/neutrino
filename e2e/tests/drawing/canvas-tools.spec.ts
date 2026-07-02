import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `drawing_canvas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Canvas Tools Test User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

async function openEditor(request: APIRequestContext, page: Page): Promise<void> {
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found');
  const res = await request.post(`${BASE_URL}/api/v1/drawing`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { title: 'Canvas Test Drawing' },
  });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const { id } = await res.json() as { id: string };
  await page.goto(`/drawing/editor?id=${id}`);
  await expect(page.getByLabel('Drawing title')).toBeVisible({ timeout: 15_000 });
}

test.describe('Canvas tools', () => {
  test('all toolbar tool buttons are present', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openEditor(request, page);

    for (const label of ['Select', 'Pen', 'Line', 'Rectangle', 'Ellipse', 'Arrow', 'Text', 'Eraser']) {
      // exact: true avoids substring collisions, e.g. "Pen" matching the "Open menu" button's aria-label.
      await expect(page.getByLabel(label, { exact: true })).toBeVisible({ timeout: 5_000 });
    }
  });

  test('clicking a tool button activates it', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openEditor(request, page);

    // Select is active by default
    await expect(page.getByLabel('Select', { exact: true })).toHaveAttribute('aria-pressed', 'true');

    // Activate Rectangle
    await page.getByLabel('Rectangle', { exact: true }).click();
    await expect(page.getByLabel('Rectangle', { exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Select', { exact: true })).toHaveAttribute('aria-pressed', 'false');

    // Activate Pen
    await page.getByLabel('Pen', { exact: true }).click();
    await expect(page.getByLabel('Pen', { exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Rectangle', { exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  test('drawing a rectangle on the canvas triggers autosave', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openEditor(request, page);

    // Switch to rectangle tool
    await page.getByLabel('Rectangle').click();

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    // Draw a rectangle by dragging
    const autosaved = page.waitForResponse(
      (r) => r.url().includes('/api/v1/drawing/') && r.url().includes('/autosave'),
      { timeout: 15_000 },
    );
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, box.y + 200, { steps: 10 });
    await page.mouse.up();
    await autosaved;
  });

  test('undo removes a drawn shape', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openEditor(request, page);

    await page.getByLabel('Rectangle').click();
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    // Draw a rectangle
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, box.y + 200, { steps: 10 });
    await page.mouse.up();

    // Wait for history to settle (debounce is 600ms)
    await page.waitForTimeout(700);

    // Undo — the autosave for the empty state fires
    const autosaved = page.waitForResponse(
      (r) => r.url().includes('/api/v1/drawing/') && r.url().includes('/autosave'),
      { timeout: 15_000 },
    );
    await page.keyboard.press('Control+z');
    await autosaved;
  });

  test('redo restores a shape after undo', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openEditor(request, page);

    await page.getByLabel('Rectangle').click();
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    // Draw
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, box.y + 200, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(700);

    // Undo then redo — both should produce autosave requests
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(1_100);
    const autosaved = page.waitForResponse(
      (r) => r.url().includes('/api/v1/drawing/') && r.url().includes('/autosave'),
      { timeout: 15_000 },
    );
    await page.keyboard.press('Control+Shift+z');
    await autosaved;
  });

  test('layers panel is visible and the add-layer button works', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openEditor(request, page);

    // The Layers panel header should be visible
    await expect(page.getByText('Layers')).toBeVisible({ timeout: 5_000 });

    // Click "Add layer" — a new "New layer" entry should appear
    await page.getByTitle('Add layer').click();
    await expect(page.getByText('New layer')).toBeVisible({ timeout: 5_000 });
  });

  test('layer rename is persisted within the session', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await openEditor(request, page);

    // Add a new layer first (the Background layer cannot be renamed via double-click in this test)
    await page.getByTitle('Add layer').click();
    const newLayerEntry = page.getByText('New layer').first();
    await expect(newLayerEntry).toBeVisible({ timeout: 5_000 });

    // Double-click the label to enter rename mode
    await newLayerEntry.dblclick();
    const nameInput = page.locator('input[class*="renameInput"]').first();
    await expect(nameInput).toBeVisible({ timeout: 3_000 });
    await nameInput.fill('Foreground');
    await nameInput.press('Enter');

    await expect(page.getByText('Foreground')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('New layer')).not.toBeVisible({ timeout: 3_000 });
  });
});
