import { test, expect } from '../../fixtures/base';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function createUser(
  request: Parameters<Parameters<typeof test>[2]>[0]['request'],
): Promise<{ name: string; email: string; password: string }> {
  const creds = {
    name: 'Test User',
    email: uniqueEmail(),
    password: 'Password123!',
  };
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: creds,
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `API register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return creds;
}

async function loginViaUi(
  page: Parameters<Parameters<typeof test>[2]>[0]['page'],
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

test.describe('Session persistence', () => {
  test('session persists across page reload', async ({ page, request }) => {
    const { email, password } = await createUser(request);
    await loginViaUi(page, email, password);

    await page.reload();

    await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  });

  test('new browser context has no session — /drive redirects to /sign-in', async ({ browser }) => {
    const freshContext = await browser.newContext();
    try {
      const freshPage = await freshContext.newPage();
      await freshPage.goto(`${BASE_URL}/drive`);
      await expect(freshPage).toHaveURL(/\/sign-in/, { timeout: 15_000 });
    } finally {
      await freshContext.close();
    }
  });

  test('tampered tokens — /drive redirects to /sign-in', async ({ page }) => {
    await page.goto('/sign-in');
    await page.evaluate(() => {
      localStorage.setItem('access_token', 'invalid.token.value');
      localStorage.setItem('refresh_token', 'invalid.refresh.value');
    });

    await page.goto('/drive');

    await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 });
  });
});

test.describe('Sign out', () => {
  test('topbar sign out redirects to /sign-in', async ({ page, request }) => {
    const { email, password } = await createUser(request);
    await loginViaUi(page, email, password);

    await page.getByRole('button', { name: 'User menu' }).click();
    await page.getByRole('menuitem', { name: /sign out/i }).click();

    await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 });
  });

  test('after sign out, /drive redirects back to /sign-in', async ({ page, request }) => {
    const { email, password } = await createUser(request);
    await loginViaUi(page, email, password);

    await page.getByRole('button', { name: 'User menu' }).click();
    await page.getByRole('menuitem', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 });

    await page.goto('/drive');
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 });
  });
});
