import { test, expect } from '../../fixtures/base';

const BASE_URL = 'http://localhost:9880';

async function registerAndLogin(
  request: Parameters<Parameters<typeof test>[2]>[0]['request'],
  page: Parameters<Parameters<typeof test>[2]>[0]['page'],
  name = 'Settings Test User',
): Promise<{ email: string; password: string }> {
  const email = `settings_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`;
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

  return { email, password };
}

// Helper to click a settings tab without conflicting with the topbar Notifications button.
function clickTab(page: Parameters<Parameters<typeof test>[2]>[0]['page'], label: string) {
  return page.locator('[class*="tabBar"]').getByRole('button', { name: label }).click();
}

test.describe('Settings page — smoke', () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndLogin(request, page);
  });

  test('loads and shows heading', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Settings', {
      timeout: 10_000,
    });
  });

  test('all tabs are visible', async ({ page }) => {
    await page.goto('/settings');
    const tabBar = page.locator('[class*="tabBar"]');
    for (const label of ['AI Assistant', 'Appearance', 'Notifications', 'Calendar', 'Account', 'Advanced']) {
      await expect(tabBar.getByRole('button', { name: label })).toBeVisible({ timeout: 10_000 });
    }
  });

  test('default tab is AI Assistant', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'AI assistant', level: 2 })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('unauthenticated visit redirects to sign-in', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    });
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 10_000 });
  });
});

test.describe('Settings page — tab navigation', () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Settings', {
      timeout: 10_000,
    });
  });

  test('Appearance tab shows theme picker', async ({ page }) => {
    await clickTab(page, 'Appearance');
    await expect(page.getByRole('heading', { name: 'Appearance', level: 2 })).toBeVisible();
    // Use exact: true to distinguish "Light" from "Light Glass"
    await expect(page.getByRole('button', { name: 'Light', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dark', exact: true })).toBeVisible();
  });

  test('Notifications tab shows email preference checkboxes', async ({ page }) => {
    await clickTab(page, 'Notifications');
    await expect(page.getByRole('heading', { name: 'Email notifications', level: 2 })).toBeVisible();
    await expect(page.getByText('Critical alerts')).toBeVisible();
    await expect(page.getByText('Marketing')).toBeVisible();
  });

  test('Account tab shows read-only email field', async ({ page }) => {
    await clickTab(page, 'Account');
    await expect(page.getByRole('heading', { name: 'Account', level: 2 })).toBeVisible();
    // The email input has no label association; select by type+disabled attribute
    const emailInput = page.locator('input[type="email"][disabled]');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toBeDisabled();
  });

  test('Account tab shows editable display name field', async ({ page }) => {
    await clickTab(page, 'Account');
    await expect(page.getByRole('heading', { name: 'Account', level: 2 })).toBeVisible();
    // The display name input has placeholder "Your name" (no label association)
    await expect(page.getByPlaceholder('Your name')).toBeVisible();
    await expect(page.getByPlaceholder('Your name')).toBeEnabled();
  });

  test('Calendar tab shows week-start options', async ({ page }) => {
    await clickTab(page, 'Calendar');
    await expect(page.getByRole('heading', { name: 'General', level: 2 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sunday' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Monday' })).toBeVisible();
  });

  test('Advanced tab shows search index controls', async ({ page }) => {
    await clickTab(page, 'Advanced');
    await expect(page.getByRole('heading', { name: 'Search', level: 2 })).toBeVisible();
    await expect(page.getByText('Disable search index syncing')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rebuild index' })).toBeVisible();
  });
});

test.describe('Settings page — appearance', () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/settings');
    await clickTab(page, 'Appearance');
    await expect(page.getByRole('heading', { name: 'Appearance', level: 2 })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('selecting a theme card marks it active and save button appears', async ({ page }) => {
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save appearance' })).toBeVisible();
  });

  test('saving theme shows Saved confirmation', async ({ page }) => {
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.getByRole('button', { name: 'Save appearance' }).click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 5_000 });
  });

  test('theme choice persists across page reload', async ({ page }) => {
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.getByRole('button', { name: 'Save appearance' }).click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 5_000 });

    await page.reload();
    await clickTab(page, 'Appearance');
    const darkCard = page.getByRole('button', { name: 'Dark', exact: true });
    await expect(darkCard).toHaveClass(/themeCardActive/, { timeout: 10_000 });
  });
});

test.describe('Settings page — notifications', () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/settings');
    await clickTab(page, 'Notifications');
    await expect(page.getByRole('heading', { name: 'Email notifications', level: 2 })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('can toggle marketing emails and save', async ({ page }) => {
    const marketingLabel = page.locator('label', { hasText: 'Marketing' });
    const checkbox = marketingLabel.locator('input[type="checkbox"]');
    const initialChecked = await checkbox.isChecked();

    await marketingLabel.click();
    await expect(checkbox).toBeChecked({ checked: !initialChecked });

    await page.getByRole('button', { name: 'Save notifications' }).click();
    await expect(page.locator('[class*="saveError"]')).toBeHidden({ timeout: 5_000 });
  });
});

test.describe('Settings page — account', () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndLogin(request, page, 'AccountTest User');
    await page.goto('/settings');
    await clickTab(page, 'Account');
    await expect(page.getByRole('heading', { name: 'Account', level: 2 })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('email field is pre-filled and read-only', async ({ page }) => {
    const emailInput = page.locator('input[type="email"][disabled]');
    await expect(emailInput).toHaveValue(/@example\.com/);
    await expect(emailInput).toBeDisabled();
  });

  test('saving account shows Saved confirmation', async ({ page }) => {
    await page.getByPlaceholder('Your name').fill('Updated Name');
    await page.getByRole('button', { name: 'Save account' }).click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 5_000 });
  });

  test('delete account button opens confirmation dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'Delete account' }).click();
    await expect(page.getByText('Delete your account?')).toBeVisible();
    // Scope to the dialog body to avoid matching the static danger zone description
    await expect(page.locator('[class*="dialogBody"]')).toContainText('cannot be undone');
  });

  test('cancelling the delete dialog closes it', async ({ page }) => {
    await page.getByRole('button', { name: 'Delete account' }).click();
    await expect(page.getByText('Delete your account?')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Delete your account?')).toBeHidden();
  });
});

test.describe('Settings page — tab URL param', () => {
  test.beforeEach(async ({ page, request }) => {
    await registerAndLogin(request, page);
  });

  test('?tab=appearance opens the Appearance tab directly', async ({ page }) => {
    await page.goto('/settings?tab=appearance');
    await expect(page.getByRole('heading', { name: 'Appearance', level: 2 })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('?tab=account opens the Account tab directly', async ({ page }) => {
    await page.goto('/settings?tab=account');
    await expect(page.getByRole('heading', { name: 'Account', level: 2 })).toBeVisible({
      timeout: 10_000,
    });
  });
});
