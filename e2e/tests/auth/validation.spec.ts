import { test, expect } from '../../fixtures/base';

function trackLoginRequests(page: Parameters<Parameters<typeof test>[2]>[0]['page']): () => boolean {
  let made = false;
  page.on('request', req => {
    if (req.url().includes('/api/v1/auth/login')) made = true;
  });
  return () => made;
}

function trackRegisterRequests(page: Parameters<Parameters<typeof test>[2]>[0]['page']): () => boolean {
  let made = false;
  page.on('request', req => {
    if (req.url().includes('/api/v1/auth/register')) made = true;
  });
  return () => made;
}

test.describe('Login form validation', () => {
  test('empty email — browser validation prevents submission', async ({ page }) => {
    await page.goto('/sign-in');
    const wasRequested = trackLoginRequests(page);

    await page.getByLabel('Password').fill('Password123!');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.waitForTimeout(1000);
    expect(wasRequested()).toBe(false);
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('empty password — browser validation prevents submission', async ({ page }) => {
    await page.goto('/sign-in');
    const wasRequested = trackLoginRequests(page);

    await page.getByLabel('Email').fill('user@example.com');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.waitForTimeout(1000);
    expect(wasRequested()).toBe(false);
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('malformed email — browser validation prevents submission', async ({ page }) => {
    await page.goto('/sign-in');
    const wasRequested = trackLoginRequests(page);

    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Password').fill('Password123!');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.waitForTimeout(1000);
    expect(wasRequested()).toBe(false);
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe('Register form validation', () => {
  test('empty name — browser validation prevents submission', async ({ page }) => {
    await page.goto('/register');
    const wasRequested = trackRegisterRequests(page);

    await page.getByLabel('Email').fill('user@example.com');
    await page.getByLabel('Password').fill('Password123!');
    await page.getByRole('button', { name: 'Create free account' }).click();

    await page.waitForTimeout(1000);
    expect(wasRequested()).toBe(false);
    await expect(page).toHaveURL(/\/register/);
  });

  test('malformed email — browser validation prevents submission', async ({ page }) => {
    await page.goto('/register');
    const wasRequested = trackRegisterRequests(page);

    await page.getByLabel('Name').fill('Test User');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Password').fill('Password123!');
    await page.getByRole('button', { name: 'Create free account' }).click();

    await page.waitForTimeout(1000);
    expect(wasRequested()).toBe(false);
    await expect(page).toHaveURL(/\/register/);
  });

  test('empty password — browser validation prevents submission', async ({ page }) => {
    await page.goto('/register');
    const wasRequested = trackRegisterRequests(page);

    await page.getByLabel('Name').fill('Test User');
    await page.getByLabel('Email').fill('user@example.com');
    await page.getByRole('button', { name: 'Create free account' }).click();

    await page.waitForTimeout(1000);
    expect(wasRequested()).toBe(false);
    await expect(page).toHaveURL(/\/register/);
  });
});
