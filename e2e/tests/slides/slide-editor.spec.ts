import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(prefix = 'editor'): string {
  return `slides_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(
  request: APIRequestContext,
  page: Page,
  prefix = 'editor',
): Promise<void> {
  const email = uniqueEmail(prefix);
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Slides Editor User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

/**
 * Create a new presentation and return its ID. Waits for the initial encrypted
 * content upload so that the DEK is confirmed ready before any test edits.
 */
async function createSlideAndGetId(page: Page): Promise<string> {
  await page.goto('/drive');

  // Register before clicking so we don't miss the initial autosave.
  const initialSavePromise = page.waitForResponse(
    (r) =>
      r.url().includes('/api/v1/drive/files/') &&
      r.url().includes('/autosave') &&
      r.request().method() === 'PUT',
    { timeout: 20_000 },
  );

  await page.getByRole('button', { name: 'Create new item' }).click();
  await page.getByRole('menuitem', { name: 'Presentation' }).click();
  await expect(page).toHaveURL(/\/slides\/editor\/?\?id=/, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Slides' })).toBeVisible({ timeout: 10_000 });

  const slideId = new URL(page.url()).searchParams.get('id')!;
  expect(slideId, 'slide ID must be present in URL').toBeTruthy();

  // Confirm the DEK is ready before any test edits.
  await initialSavePromise;

  return slideId;
}

// ── Slide panel: add / delete / duplicate / reorder ──────────────────────────

test.describe('Slide panel — add / delete / duplicate / reorder', () => {
  test('clicking the add-slide button appends a new slide', async ({ page, request }) => {
    await registerAndLogin(request, page, 'add');
    await createSlideAndGetId(page);

    await expect(page.locator('text=Slides (1)')).toBeVisible({ timeout: 5_000 });

    await page.getByTitle('Add slide').click();

    await expect(page.locator('text=Slides (2)')).toBeVisible({ timeout: 5_000 });
  });

  test('clicking the delete-slide button removes the current slide', async ({ page, request }) => {
    await registerAndLogin(request, page, 'del');
    await createSlideAndGetId(page);

    // Need at least two slides before we can delete one.
    await page.getByTitle('Add slide').click();
    await expect(page.locator('text=Slides (2)')).toBeVisible({ timeout: 5_000 });

    await page.getByTitle('Delete slide').click();
    await expect(page.locator('text=Slides (1)')).toBeVisible({ timeout: 5_000 });
  });

  test('clicking the duplicate-slide button copies the selected slide', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page, 'dup');
    await createSlideAndGetId(page);

    await expect(page.locator('text=Slides (1)')).toBeVisible({ timeout: 5_000 });

    await page.getByTitle('Duplicate slide').click();
    await expect(page.locator('text=Slides (2)')).toBeVisible({ timeout: 5_000 });
  });

  test('move-up reorders slides and disables itself at the top position', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page, 'reorder');
    await createSlideAndGetId(page);

    // Add a second slide; it becomes selected (index 1).
    await page.getByTitle('Add slide').click();
    await expect(page.locator('text=Slides (2)')).toBeVisible({ timeout: 5_000 });

    // Move the selected slide to position 0.
    await page.getByTitle('Move up').click();

    // Now at index 0, the move-up button must be disabled.
    await expect(page.getByTitle('Move up')).toBeDisabled({ timeout: 3_000 });
  });
});

// ── Text editing ──────────────────────────────────────────────────────────────

test.describe('Slide canvas — text editing', () => {
  test('double-clicking the title placeholder opens an editable textarea', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page, 'textedit');
    await createSlideAndGetId(page);

    await page.locator('text=Click to add title').first().dblclick();

    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 5_000 });
  });

  test('text typed into the title element is saved and survives a reload', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'persist');
    const slideId = await createSlideAndGetId(page);

    const uniqueTitle = `Slide-Title-${Date.now()}`;

    await page.locator('text=Click to add title').first().dblclick();
    const textarea = page.locator('textarea').first();
    await textarea.waitFor({ state: 'visible', timeout: 5_000 });
    await textarea.fill(uniqueTitle);
    // Tab out of the text element to commit the edit.
    await page.keyboard.press('Tab');

    // Use the back button's synchronous flush: handleBack() saves before navigating.
    const savePromise = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/drive/files/${slideId}/autosave`) &&
        r.request().method() === 'PUT',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Slides' }).click();
    await savePromise;
    await expect(page).toHaveURL(/\/drive/, { timeout: 10_000 });

    // Reopen the presentation and verify the title survived the round-trip.
    await page.goto(`/slides/editor?id=${slideId}`);
    await expect(page.getByRole('button', { name: 'Slides' })).toBeVisible({ timeout: 15_000 });

    await expect(page.locator(`text=${uniqueTitle}`).first()).toBeVisible({ timeout: 10_000 });
  });
});

// ── Insert panel ──────────────────────────────────────────────────────────────

test.describe('Insert panel', () => {
  test('clicking Text Box in the Insert panel adds a text element to the canvas', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page, 'inserttext');
    await createSlideAndGetId(page);

    // Switch to the Insert tab in the right panel. Use an exact-name button
    // locator so it doesn't also match the "Insert line" shape toolbar button.
    await page.getByRole('button', { name: 'Insert', exact: true }).click();

    await page.getByRole('button', { name: 'Text Box' }).click();

    // A "New text box" element should appear on the canvas.
    await expect(page.locator('text=New text box').first()).toBeVisible({ timeout: 5_000 });
  });
});

// ── Speaker notes ─────────────────────────────────────────────────────────────

test.describe('Speaker notes', () => {
  test('notes typed for a slide are saved and survive a reload', async ({ page, request }) => {
    test.setTimeout(60_000);
    await registerAndLogin(request, page, 'notes');
    const slideId = await createSlideAndGetId(page);

    const noteText = `Speaker note ${Date.now()}`;
    await page.getByPlaceholder('Add speaker notes for this slide…').fill(noteText);

    // Flush via the back button's synchronous save.
    const savePromise = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/drive/files/${slideId}/autosave`) &&
        r.request().method() === 'PUT',
      { timeout: 15_000 },
    );
    await page.getByRole('button', { name: 'Slides' }).click();
    await savePromise;
    await expect(page).toHaveURL(/\/drive/, { timeout: 10_000 });

    // Reopen and verify the notes survived the round-trip.
    await page.goto(`/slides/editor?id=${slideId}`);
    await expect(page.getByRole('button', { name: 'Slides' })).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByPlaceholder('Add speaker notes for this slide…'),
    ).toHaveValue(noteText, { timeout: 10_000 });
  });
});
