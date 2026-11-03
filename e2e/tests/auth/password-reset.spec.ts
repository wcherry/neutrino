/**
 * Forgot password: "Forgot password?" on the sign-in page mails a single-use link, and the link's
 * page sets a new password.
 *
 * The server's mail transport in the test stack is the outbox (see `onboarding/invites.spec.ts`),
 * so the reset link is read straight off the disk. Two-factor, lockouts, expiry and the hourly cap
 * are covered by the Rust tests in `src/auth/password_reset/tests.rs`.
 */

import { test, expect } from '../../fixtures/base';
import type { APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:9880';
const PASSWORD = 'Password123!';
const NEW_PASSWORD = 'NewPassword456!';
const OUTBOX = path.join(process.env.RUN_DIR ?? '/tmp/neutrino-e2e/default', 'data', 'outbox.jsonl');
const RESET_SUBJECT = 'Reset your Neutrino password';
const CHANGED_SUBJECT = 'Your Neutrino password was changed';

interface OutboxMessage {
  to: string;
  subject: string;
  body: string;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function readOutbox(): OutboxMessage[] {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs
    .readFileSync(OUTBOX, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      // The server may be part-way through appending the last line.
      try {
        return [JSON.parse(line) as OutboxMessage];
      } catch {
        return [];
      }
    });
}

function mailTo(to: string, subject: string): OutboxMessage[] {
  return readOutbox().filter((m) => m.to.toLowerCase() === to.toLowerCase() && m.subject === subject);
}

/** Polls the outbox for the `count`th message to `to` with `subject`. */
async function waitForMail(to: string, subject: string, count = 1, timeoutMs = 15_000): Promise<OutboxMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = mailTo(to, subject);
    if (found.length >= count) return found[count - 1];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no mail #${count} to ${to} matching ${subject} in ${OUTBOX} after ${timeoutMs}ms`);
}

/** The `/reset-password?token=…` link in a reset mail, as a path on this site. */
function resetPathFrom(mail: OutboxMessage): { path: string; token: string } {
  const match = mail.body.match(/\/reset-password\?token=([A-Za-z0-9_-]+)/);
  expect(match, `no reset link in: ${mail.body}`).not.toBeNull();
  return { path: match![0], token: match![1] };
}

async function register(request: APIRequestContext, prefix: string): Promise<string> {
  const email = uniqueEmail(prefix);
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Reset Tester', email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return email;
}

async function loginStatus(request: APIRequestContext, email: string, password: string): Promise<number> {
  const res = await request.post(`${BASE_URL}/api/v1/auth/login`, {
    data: { email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  return res.status();
}

async function forgot(request: APIRequestContext, email: string): Promise<number> {
  const res = await request.post(`${BASE_URL}/api/v1/auth/password/forgot`, {
    data: { email },
    headers: { 'Content-Type': 'application/json' },
  });
  return res.status();
}

test.describe('Forgot password', () => {
  test('ask from the sign-in page, follow the emailed link, and sign in with the new password', async ({
    page,
    request,
  }) => {
    const email = await register(request, 'reset_ui');

    await page.goto('/sign-in');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toContainText(`If ${email} has an account`);

    const { path: resetPath } = resetPathFrom(await waitForMail(email, RESET_SUBJECT));
    await page.goto(resetPath);
    await expect(page.getByText(email)).toBeVisible();
    await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();

    await waitForMail(email, CHANGED_SUBJECT);
    expect(await loginStatus(request, email, NEW_PASSWORD)).toBe(200);
    expect(await loginStatus(request, email, PASSWORD)).toBe(401);

    // The link is spent: opening it again offers a new one instead of a form.
    await page.goto(resetPath);
    // Filtered by text: Next.js renders its own route announcer with role="alert".
    await expect(page.getByRole('alert').filter({ hasText: 'already been used' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Send a new link' })).toBeVisible();
  });

  test('an address with no account is answered the same way and sent nothing', async ({ request }) => {
    const email = uniqueEmail('reset_nobody');
    expect(await forgot(request, email)).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(mailTo(email, RESET_SUBJECT)).toHaveLength(0);
  });

  test('asking again replaces the earlier link', async ({ request }) => {
    const email = await register(request, 'reset_twice');
    expect(await forgot(request, email)).toBe(202);
    const first = resetPathFrom(await waitForMail(email, RESET_SUBJECT, 1)).token;
    expect(await forgot(request, email)).toBe(202);
    const second = resetPathFrom(await waitForMail(email, RESET_SUBJECT, 2)).token;

    const check = (token: string) =>
      request.post(`${BASE_URL}/api/v1/auth/password/reset/check`, {
        data: { token },
        headers: { 'Content-Type': 'application/json' },
      });
    const old = await check(first);
    expect(old.status()).toBe(410);
    expect((await old.json()).error.code).toBe('RESET_REVOKED');
    const live = await check(second);
    expect(live.status()).toBe(200);
    expect(await live.json()).toEqual({ email, requiresTwoFactor: false });
  });

  test('a made-up token is 404 RESET_NOT_FOUND', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/v1/auth/password/reset`, {
      data: { token: 'not-a-real-token', newPassword: NEW_PASSWORD },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe('RESET_NOT_FOUND');
  });
});
