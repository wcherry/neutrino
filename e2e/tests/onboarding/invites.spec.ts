/**
 * Onboarding phase 5 — friend invites and the welcome email
 * (agent_docs/plans/feature-onboarding-invites.md).
 *
 * The server's mail transport in the test stack is the outbox: every message is
 * appended as a JSON line to `${RUN_DIR}/data/outbox.jsonl`, which
 * docker-compose-test.yml mounts from the host, so this spec reads the mail the
 * server sent straight off the disk.
 *
 * The shared stack runs with public sign-up OPEN (every other spec registers),
 * so closed sign-up is covered by the Rust tests, not here.
 */

import { test, expect } from '../../fixtures/base';
import { finishRegistrationEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:9880';
const PASSWORD = 'Password123!';
const OUTBOX = path.join(process.env.RUN_DIR ?? '/tmp/neutrino-e2e/default', 'data', 'outbox.jsonl');

interface OutboxMessage {
  to: string;
  subject: string;
  body: string;
  html?: string;
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
    .map((line) => JSON.parse(line) as OutboxMessage);
}

/** Polls the outbox for a message to `to` (optionally matching `subject`). */
async function waitForMail(
  to: string,
  subject?: string | RegExp,
  timeoutMs = 15_000,
): Promise<OutboxMessage> {
  const matches = (m: OutboxMessage) =>
    m.to.toLowerCase() === to.toLowerCase() &&
    (subject === undefined ||
      (typeof subject === 'string' ? m.subject === subject : subject.test(m.subject)));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = readOutbox().find(matches);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no mail to ${to}${subject ? ` matching ${subject}` : ''} in ${OUTBOX} after ${timeoutMs}ms`);
}

/** The token in the `/register?invite=` link of an invitation mail. */
function inviteTokenFrom(mail: OutboxMessage): string {
  const match = mail.body.match(/\/register\?invite=([A-Za-z0-9_\-%.~]+)/);
  expect(match, `no invite link in: ${mail.body}`).not.toBeNull();
  return decodeURIComponent(match![1]);
}

async function registerThroughUi(page: Page, name: string, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create free account' }).click();
  await finishRegistrationEncryption(page);
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
}

/**
 * Opens the account menu in whichever look is active: Classic (the default)
 * labels its trigger "User menu", Flow/Blended label theirs "Account".
 */
async function openAccountMenu(page: Page): Promise<void> {
  const classic = page.getByRole('button', { name: 'User menu' });
  const flow = page.getByRole('button', { name: 'Account', exact: true });
  await expect(classic.or(flow).first()).toBeVisible({ timeout: 15_000 });
  if (await classic.isVisible()) await classic.click();
  else await flow.click();
}

async function openInviteDialog(page: Page) {
  await openAccountMenu(page);
  await page.getByRole('menuitem', { name: 'Invite friends' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite friends' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function apiToken(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/auth/login`, {
    data: { email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `login failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()).accessToken;
}

async function registerViaApi(request: APIRequestContext, prefix: string): Promise<{ email: string; token: string }> {
  const email = uniqueEmail(prefix);
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Invite Api', email, password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return { email, token: await apiToken(request, email) };
}

test.describe('Friend invites', () => {
  test('invite a friend by email from the account menu, and they sign up through the link', async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const inviterEmail = uniqueEmail('inviter');
    const inviteeEmail = uniqueEmail('invitee');

    // ── A signs up and gets the welcome email ───────────────────────────────
    await registerThroughUi(page, 'Ada Inviter', inviterEmail);
    const welcome = await waitForMail(inviterEmail, 'Welcome to Neutrino');
    expect(welcome.body).toContain('/settings?tab=appearance');
    expect(welcome.body).toContain('/invite');
    expect(welcome.body.toLowerCase()).not.toContain('optional');

    // ── A opens Invite friends and sends one invitation ─────────────────────
    const dialog = await openInviteDialog(page);
    const linkField = dialog.getByLabel('Invite link');
    await expect(linkField).toHaveValue(/\/register\?invite=.+/);

    const emailField = dialog.getByLabel('Or send invitations by email');
    await emailField.fill(inviteeEmail);
    await emailField.press('Enter');
    await expect(dialog.getByRole('button', { name: `Remove ${inviteeEmail}` })).toBeVisible();
    await dialog.getByLabel('A note').fill('Come and try it with me');
    await dialog.getByRole('button', { name: 'Send 1 invite' }).click();

    await expect(dialog.getByText('Sent 1 invite.')).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(inviteeEmail)).toBeVisible();
    await expect(dialog.getByText('Pending')).toBeVisible();
    await expect(dialog.getByText('Each invite link works once and expires after 14 days.')).toBeVisible();

    // ── the invitation is in the outbox ─────────────────────────────────────
    const invitation = await waitForMail(inviteeEmail);
    expect(invitation.body).toContain('Ada Inviter');
    expect(invitation.body).toContain('Come and try it with me');
    expect(invitation.body).toContain('14 days');
    const token = inviteTokenFrom(invitation);

    // ── the invitee signs up from the link in a fresh browser ───────────────
    const origin = new URL(page.url()).origin;
    const inviteeContext = await browser.newContext();
    try {
      const invitee = await inviteeContext.newPage();
      await invitee.goto(`${origin}/register?invite=${encodeURIComponent(token)}`);
      await expect(invitee.getByText('Ada Inviter invited you to Neutrino.')).toBeVisible({ timeout: 15_000 });
      await expect(invitee.getByLabel('Email')).toHaveValue(inviteeEmail);

      await invitee.getByLabel('Name').fill('Bob Invitee');
      await invitee.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await invitee.getByLabel('Confirm password').fill(PASSWORD);
      await invitee.getByRole('button', { name: 'Create free account' }).click();
      await finishRegistrationEncryption(invitee);
      await expect(invitee).toHaveURL(/\/drive/, { timeout: 15_000 });

      // The invitee is a new account too.
      await waitForMail(inviteeEmail, 'Welcome to Neutrino');

      // The emailed link worked once; it is spent now.
      const again = await request.post(`${BASE_URL}/api/v1/invites/validate`, {
        data: { token },
        headers: { 'Content-Type': 'application/json' },
      });
      expect(again.status()).toBe(410);
      expect((await again.json()).error.code).toBe('INVITE_USED');
    } finally {
      await inviteeContext.close();
    }

    // ── back as A: the invite is accepted ───────────────────────────────────
    const inviterToken = (await page.evaluate(() => localStorage.getItem('access_token')))!;
    const listRes = await request.get(`${BASE_URL}/api/v1/invites`, {
      headers: { Authorization: `Bearer ${inviterToken}` },
    });
    expect(listRes.ok()).toBeTruthy();
    const { invites } = (await listRes.json()) as { invites: Array<{ email: string; status: string; acceptedAt: string | null }> };
    const row = invites.find((i) => i.email === inviteeEmail.toLowerCase());
    expect(row, JSON.stringify(invites)).toBeTruthy();
    expect(row!.status).toBe('accepted');
    expect(row!.acceptedAt).toBeTruthy();

    await page.reload();
    const reopened = await openInviteDialog(page);
    await expect(reopened.getByText('Joined')).toBeVisible({ timeout: 15_000 });
  });

  test('the invite page is reachable at /invite', async ({ page, request }) => {
    const { email } = await registerViaApi(request, 'invite_page');
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });

    await page.goto('/invite');

    await expect(page.getByRole('heading', { name: 'Invite friends' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Invite link')).toHaveValue(/\/register\?invite=.+/);
  });
});

test.describe('Invites API', () => {
  test('validate refuses a garbage token with 404 INVITE_NOT_FOUND', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/v1/invites/validate`, {
      data: { token: 'definitely-not-a-real-invite-token' },
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe('INVITE_NOT_FOUND');
  });

  test('the sign-up policy is public and open on the test stack', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/auth/signup-policy`);

    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toEqual({ publicSignup: true });
  });

  test('the invite routes need a signed-in user', async ({ request }) => {
    const calls = [
      request.get(`${BASE_URL}/api/v1/invites`),
      request.post(`${BASE_URL}/api/v1/invites`, {
        data: { emails: ['nobody@example.com'] },
        headers: { 'Content-Type': 'application/json' },
      }),
      request.delete(`${BASE_URL}/api/v1/invites/some-id`),
      request.get(`${BASE_URL}/api/v1/invites/link`),
      request.post(`${BASE_URL}/api/v1/invites/link/reset`),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status(), res.url()).toBe(401);
    }
  });

  test('the personal link is stable until reset, and reset kills the old one', async ({ request }) => {
    const { token } = await registerViaApi(request, 'invite_link');
    const auth = { Authorization: `Bearer ${token}` };

    const first = await (await request.get(`${BASE_URL}/api/v1/invites/link`, { headers: auth })).json();
    const second = await (await request.get(`${BASE_URL}/api/v1/invites/link`, { headers: auth })).json();
    expect(first.token).toBeTruthy();
    expect(second.token).toBe(first.token);
    expect(first.url).toContain(`/register?invite=`);

    const validation = await request.post(`${BASE_URL}/api/v1/invites/validate`, {
      data: { token: first.token },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(validation.ok()).toBeTruthy();
    expect(await validation.json()).toMatchObject({ kind: 'link', inviterName: 'Invite Api', email: null });

    const reset = await (await request.post(`${BASE_URL}/api/v1/invites/link/reset`, { headers: auth })).json();
    expect(reset.token).not.toBe(first.token);

    const old = await request.post(`${BASE_URL}/api/v1/invites/validate`, {
      data: { token: first.token },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(old.status()).toBe(410);
    expect((await old.json()).error.code).toBe('INVITE_REVOKED');
  });

  test('inviting your own address is 400 INVALID_EMAIL', async ({ request }) => {
    const { email, token } = await registerViaApi(request, 'invite_self');

    const res = await request.post(`${BASE_URL}/api/v1/invites`, {
      data: { emails: [email.toUpperCase()] },
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_EMAIL');
  });

  test('a sent invite can be revoked, and then no longer validates', async ({ request }) => {
    const { token } = await registerViaApi(request, 'invite_revoke');
    const invitee = uniqueEmail('revoked');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const created = await request.post(`${BASE_URL}/api/v1/invites`, { data: { emails: [invitee] }, headers });
    expect(created.status()).toBe(201);
    const [row] = (await created.json()).invites;
    expect(row).toMatchObject({ email: invitee.toLowerCase(), status: 'pending', acceptedAt: null });

    const mailToken = inviteTokenFrom(await waitForMail(invitee));
    const del = await request.delete(`${BASE_URL}/api/v1/invites/${row.id}`, { headers });
    expect(del.status()).toBe(204);

    const res = await request.post(`${BASE_URL}/api/v1/invites/validate`, {
      data: { token: mailToken },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(410);
    expect((await res.json()).error.code).toBe('INVITE_REVOKED');
  });
});
