/**
 * One signed-in, encryption-ready account, and the keys to seal fixtures for it.
 *
 * The functional specs each carry their own `registerAndLogin`; the perf suite
 * needs one more thing from it, which is why this exists rather than importing
 * theirs. Seeding a fixture from Node means sealing a DEK to the account's
 * public key, so the session has to hand back the keypair the browser minted —
 * `activeKeyPair` reads it out of the same IndexedDB record the app wrote.
 *
 * Sign-in itself is deliberately never measured. It happens once per spec,
 * before any throttling is applied, and the scenarios navigate from there.
 */

import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { activeKeyPair, setUpEncryption, waitForKeyring } from '../../fixtures/e2ee';
import { BASE_URL } from './env';

export interface Session {
  email: string;
  token: string;
  userId: string;
  /** base64url, the pair the account's keyring holds. */
  keyPair: { publicKey: string; secretKey: string };
  page: Page;
  request: APIRequestContext;
}

function uniqueEmail(prefix: string): string {
  return `perf_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/**
 * Register, sign in through the UI, pass the first-run encryption gate, and
 * return everything a seeder needs.
 *
 * Through the UI rather than through the token endpoint because the keyring is
 * minted by the gate, not by the API: an account created and authenticated
 * purely over HTTP has no published public key, and every seeded fixture would
 * fail to seal.
 */
export async function signIn(
  request: APIRequestContext,
  page: Page,
  prefix = 'perf',
): Promise<Session> {
  const email = uniqueEmail(prefix);
  const password = 'Password123!';

  const registered = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Perf Fixture User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(
    registered.ok(),
    `register failed: ${registered.status()} ${await registered.text()}`,
  ).toBeTruthy();

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 30_000 });
  await setUpEncryption(page);

  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage after sign-in');

  const me = await request.get(`${BASE_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(me.ok(), `profile fetch failed: ${me.status()}`).toBeTruthy();
  const { id: userId } = (await me.json()) as { id: string };

  // `setUpEncryption` returns when the dialog closes; the IndexedDB write it
  // triggers can still be in flight, and `activeKeyPair` would read nothing.
  await waitForKeyring(page, userId);
  const keyPair = await activeKeyPair(page, userId);

  return { email, token, userId, keyPair, page, request };
}

export const authHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});
