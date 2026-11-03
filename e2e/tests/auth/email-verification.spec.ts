/**
 * Email verification: a new account is mailed a link, the app nags until it is followed, and
 * following it clears the nag.
 *
 * The test stack runs `EMAIL_VERIFICATION=soft` (docker-compose-test.yml): links go out and are
 * followed, but nothing is held back, since every other spec shares straight after signing up.
 * What `enforce` holds back — sharing, password reset, sign-in after 30 days — is covered by the
 * Rust tests in `src/auth/email_verification/tests.rs`.
 */

import { test, expect } from '../../fixtures/base';
import type { APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:9880';
const PASSWORD = 'Password123!';
const OUTBOX = path.join(process.env.RUN_DIR ?? '/tmp/neutrino-e2e/default', 'data', 'outbox.jsonl');
const VERIFY_SUBJECT = 'Verify your email address for Neutrino';

interface OutboxMessage {
  to: string;
  subject: string;
  body: string;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function mailTo(to: string, subject: string): OutboxMessage[] {
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
    })
    .filter((m) => m.to.toLowerCase() === to.toLowerCase() && m.subject === subject);
}

async function waitForMail(to: string, subject: string, count = 1, timeoutMs = 15_000): Promise<OutboxMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = mailTo(to, subject);
    if (found.length >= count) return found[count - 1];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no mail #${count} to ${to} matching ${subject} in ${OUTBOX} after ${timeoutMs}ms`);
}

function verifyPathFrom(mail: OutboxMessage): string {
  const match = mail.body.match(/\/verify-email\?token=[A-Za-z0-9_-]+/);
  expect(match, `no verification link in: ${mail.body}`).not.toBeNull();
  return match![0];
}

async function register(request: APIRequestContext, prefix: string): Promise<string> {
  const email = uniqueEmail(prefix);
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Verify Tester', email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return email;
}

async function token(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/auth/login`, {
    data: { email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `login failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function status(request: APIRequestContext, accessToken: string) {
  const res = await request.get(`${BASE_URL}/api/v1/auth/email/verification`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { verified: boolean; mode: string; blockAt: string | null };
}

test.describe('Email verification', () => {
  test('a new account is mailed a link, nagged until it follows it, and verified by it', async ({
    page,
    request,
  }) => {
    const email = await register(request, 'verify_ui');
    const link = verifyPathFrom(await waitForMail(email, VERIFY_SUBJECT));
    expect(await status(request, await token(request, email))).toMatchObject({
      verified: false,
      mode: 'soft',
      blockAt: null,
    });

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
    const banner = page.getByRole('region', { name: 'Verify your email address' });
    await expect(banner).toContainText(`We sent a link to ${email}.`);
    // Soft: nothing is held back, so nothing is said to be.
    await expect(banner).not.toContainText('share files');

    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Email address verified' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText(`${email} is verified`);
    expect((await status(request, await token(request, email))).verified).toBe(true);

    await page.goto('/drive');
    await expect(page.getByRole('region', { name: 'Verify your email address' })).toHaveCount(0);

    // The link is spent, and says so kindly.
    await page.goto(link);
    await expect(page.getByRole('alert').filter({ hasText: 'already been used' })).toBeVisible();
  });

  test('resending replaces the earlier link', async ({ request }) => {
    const email = await register(request, 'verify_resend');
    const first = verifyPathFrom(await waitForMail(email, VERIFY_SUBJECT, 1));
    const accessToken = await token(request, email);
    const resend = await request.post(`${BASE_URL}/api/v1/auth/email/verification/resend`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(resend.status()).toBe(202);
    const second = verifyPathFrom(await waitForMail(email, VERIFY_SUBJECT, 2));

    const follow = (p: string) =>
      request.post(`${BASE_URL}/api/v1/auth/email/verify`, {
        data: { token: new URL(p, BASE_URL).searchParams.get('token') },
        headers: { 'Content-Type': 'application/json' },
      });
    const old = await follow(first);
    expect(old.status()).toBe(410);
    expect((await old.json()).error.code).toBe('VERIFY_REVOKED');
    const live = await follow(second);
    expect(live.status()).toBe(200);
    expect(await live.json()).toEqual({ email });

    // Verified now: resending has nothing to send.
    const again = await request.post(`${BASE_URL}/api/v1/auth/email/verification/resend`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(again.status()).toBe(204);
  });

  test('the public form answers the same for an address with no account and sends nothing', async ({
    request,
  }) => {
    const email = uniqueEmail('verify_nobody');
    const res = await request.post(`${BASE_URL}/api/v1/auth/email/verification/request`, {
      data: { email },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(mailTo(email, VERIFY_SUBJECT)).toHaveLength(0);
  });
});
