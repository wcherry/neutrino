import { test, expect } from '../../fixtures/base';

const BASE_URL = 'http://localhost:9880';

async function registerAndLogin(
  request: Parameters<Parameters<typeof test>[2]>[0]['request'],
  page: Parameters<Parameters<typeof test>[2]>[0]['page'],
  name = 'Profile Test User',
): Promise<{ name: string; email: string; password: string }> {
  const email = `profile_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = 'Password123!';

  await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name, email, password },
    headers: { 'Content-Type': 'application/json' },
  });

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });

  return { name, email, password };
}

test.describe('Profile page — smoke', () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndLogin(request, page);
  });

  test('loads and shows heading', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Profile', {
      timeout: 10_000,
    });
  });

  test('hero shows user email', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.locator('[class*="heroEmail"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[class*="heroEmail"]')).toContainText('@example.com');
  });

  test('unauthenticated visit redirects to sign-in', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    });
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 10_000 });
  });
});

test.describe('Profile page — hero and layout', () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndLogin(request, page, 'Hero Test User');
    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Profile', {
      timeout: 10_000,
    });
  });

  test('avatar initials are derived from user name', async ({ page }) => {
    // No avatar set → initials block should contain "HT" (Hero Test User → H, T)
    await expect(page.locator('[class*="avatarInitials"]')).toBeVisible();
    await expect(page.locator('[class*="avatarInitials"]')).toContainText('HT');
  });

  test('About section is visible with correct fields', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'About', level: 2 })).toBeVisible();
    // Form labels have no htmlFor; identify inputs by placeholder
    await expect(page.getByPlaceholder('Your name')).toBeVisible();
    await expect(page.getByPlaceholder('Tell others a little about yourself')).toBeVisible();
    await expect(page.getByPlaceholder('https://yoursite.com')).toBeVisible();
  });

  test('Locale section is visible with language, timezone, country fields', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Locale', level: 2 })).toBeVisible();
    await expect(page.getByPlaceholder('e.g. en, fr, es')).toBeVisible();
    await expect(page.getByPlaceholder('e.g. America/New_York')).toBeVisible();
    await expect(page.getByPlaceholder('e.g. US, GB, CA')).toBeVisible();
  });

  test('Social links section is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Social links', level: 2 })).toBeVisible();
    await expect(page.getByPlaceholder('https://github.com/username')).toBeVisible();
    await expect(page.getByPlaceholder('https://x.com/username')).toBeVisible();
  });

  test('Appearance section with theme picker is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Appearance', level: 2 })).toBeVisible();
    // Use exact: true to distinguish "Light" from "Light Glass"
    await expect(page.getByRole('button', { name: 'Light', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dark', exact: true })).toBeVisible();
  });

  test('Email notifications section is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Email notifications', level: 2 })).toBeVisible();
    await expect(page.getByText('Critical alerts')).toBeVisible();
    await expect(page.getByText('Marketing')).toBeVisible();
  });

  test('Save changes button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  });
});

test.describe('Profile page — editing and saving', () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Profile', {
      timeout: 10_000,
    });
  });

  test('filling bio and saving shows Saved confirmation', async ({ page }) => {
    await page.getByPlaceholder('Tell others a little about yourself').fill('E2E test bio text');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 5_000 });
  });

  test('saved bio text appears in hero after save', async ({ page }) => {
    await page.getByPlaceholder('Tell others a little about yourself').fill('My test bio');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[class*="heroBio"]')).toContainText('My test bio');
  });

  test('filling website shows it in hero after save', async ({ page }) => {
    await page.getByPlaceholder('https://yoursite.com').fill('https://example.com');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[class*="heroWebsite"]')).toBeVisible();
    await expect(page.locator('[class*="heroWebsite"]')).toContainText('example.com');
  });

  test('bio persists across page reload', async ({ page }) => {
    await page.getByPlaceholder('Tell others a little about yourself').fill('Persistent bio value');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 5_000 });

    await page.reload();
    await expect(page.getByPlaceholder('Tell others a little about yourself')).toHaveValue(
      'Persistent bio value',
      { timeout: 10_000 },
    );
  });

  test('toggling a notification preference and saving succeeds', async ({ page }) => {
    const marketingLabel = page.locator('label', { hasText: 'Marketing' });
    const checkbox = marketingLabel.locator('input[type="checkbox"]');
    const initialChecked = await checkbox.isChecked();

    await marketingLabel.click();
    await expect(checkbox).toBeChecked({ checked: !initialChecked });

    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[class*="saveError"]')).toBeHidden({ timeout: 3_000 });
  });
});

test.describe('Profile page — locale fields', () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Profile', {
      timeout: 10_000,
    });
  });

  test('language field persists after save and reload', async ({ page }) => {
    await page.getByPlaceholder('e.g. en, fr, es').fill('fr');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 5_000 });

    await page.reload();
    await expect(page.getByPlaceholder('e.g. en, fr, es')).toHaveValue('fr', { timeout: 10_000 });
  });

  test('timezone field accepts and persists a value', async ({ page }) => {
    await page.getByPlaceholder('e.g. America/New_York').fill('America/New_York');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 5_000 });

    await page.reload();
    await expect(page.getByPlaceholder('e.g. America/New_York')).toHaveValue('America/New_York', {
      timeout: 10_000,
    });
  });
});

test.describe('Profile page — social links', () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Profile', {
      timeout: 10_000,
    });
  });

  test('can enter and save a GitHub link', async ({ page }) => {
    await page.getByPlaceholder('https://github.com/username').fill('https://github.com/testuser');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 5_000 });
  });

  test('GitHub link persists after save and reload', async ({ page }) => {
    await page.getByPlaceholder('https://github.com/username').fill('https://github.com/persisteduser');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 5_000 });

    await page.reload();
    await expect(page.getByPlaceholder('https://github.com/username')).toHaveValue(
      'https://github.com/persisteduser',
      { timeout: 10_000 },
    );
  });
});
