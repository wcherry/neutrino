import { test, expect } from '../../fixtures/base';
import { setUpEncryption } from '../../fixtures/e2ee';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * Task geofencing (#243): saved places as ciphertext only, task geo fields and their rules, and
 * the web's place picker and Smart Add `@place`, against the real server. The picker is driven
 * from the browser's own location rather than a live geocoder, so the test needs no outside
 * service. Arrival alerts are iOS's (wcherry/neutrino_calendar_ios_mobile#23).
 */

const BASE_URL = 'http://localhost:9880';
const LONDON = { latitude: 51.501364, longitude: -0.14189 };

test.use({ timezoneId: 'UTC', geolocation: LONDON, permissions: ['geolocation'] });

function uniqueEmail(): string {
  return `cal_geo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function register(request: APIRequestContext): Promise<{ email: string; password: string }> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Geo User', email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return { email, password };
}

async function login(request: APIRequestContext, email: string, password: string): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/v1/auth/login`, {
    data: { email, password },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { accessToken?: string; access_token?: string };
  return (body.accessToken ?? body.access_token)!;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<string> {
  const { email, password } = await register(request);
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/drive/, { timeout: 15_000 });
  await setUpEncryption(page);
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  if (!token) throw new Error('access_token not found in localStorage');
  return token;
}

const headers = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

interface Task {
  id: string;
  title: string;
  done: boolean;
  location: string | null;
  geoPlaceId: string | null;
  geoLat: number | null;
  geoLng: number | null;
  geoRadiusM: number | null;
  nextTask?: Task;
}

async function tasks(request: APIRequestContext, token: string): Promise<Task[]> {
  const res = await request.get(`${BASE_URL}/api/v1/calendar/tasks`, { headers: headers(token) });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Task[];
}

async function places(request: APIRequestContext, token: string): Promise<{ id: string; encryptedPayload: string }[]> {
  const res = await request.get(`${BASE_URL}/api/v1/calendar/task-places`, { headers: headers(token) });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { places: { id: string; encryptedPayload: string }[] }).places;
}

const ENVELOPE = JSON.stringify({ v: 1, keyVersion: 1, key: 'opaque', data: 'opaque' });

test.describe('Task places API', () => {
  test('stores places as given, and deleting one takes it off its tasks', async ({ request }) => {
    const { email, password } = await register(request);
    const token = await login(request, email, password);

    const made = await request.post(`${BASE_URL}/api/v1/calendar/task-places`, {
      headers: headers(token),
      data: { encryptedPayload: ENVELOPE },
    });
    expect(made.status()).toBe(201);
    const place = (await made.json()) as { id: string; encryptedPayload: string };
    expect(place.encryptedPayload).toBe(ENVELOPE);

    const task = await request.post(`${BASE_URL}/api/v1/calendar/tasks`, {
      headers: headers(token),
      data: { title: 'Water plants', geoPlaceId: place.id },
    });
    const taskId = ((await task.json()) as Task).id;
    expect((await tasks(request, token)).find((t) => t.id === taskId)?.geoPlaceId).toBe(place.id);

    const deleted = await request.delete(`${BASE_URL}/api/v1/calendar/task-places/${place.id}`, { headers: headers(token) });
    expect(deleted.status()).toBe(204);
    expect((await tasks(request, token)).find((t) => t.id === taskId)?.geoPlaceId).toBeNull();
  });

  test('refuses another user’s place, an oversize payload and an out-of-range point', async ({ request }) => {
    const a = await register(request);
    const b = await register(request);
    const tokenA = await login(request, a.email, a.password);
    const tokenB = await login(request, b.email, b.password);

    const theirs = (await (await request.post(`${BASE_URL}/api/v1/calendar/task-places`, {
      headers: headers(tokenA),
      data: { encryptedPayload: ENVELOPE },
    })).json()) as { id: string };
    expect((await request.patch(`${BASE_URL}/api/v1/calendar/task-places/${theirs.id}`, {
      headers: headers(tokenB), data: { encryptedPayload: ENVELOPE },
    })).status()).toBe(404);
    expect((await request.post(`${BASE_URL}/api/v1/calendar/tasks`, {
      headers: headers(tokenB), data: { title: 'x', geoPlaceId: theirs.id },
    })).status()).toBe(404);

    expect((await request.post(`${BASE_URL}/api/v1/calendar/task-places`, {
      headers: headers(tokenB), data: { encryptedPayload: 'x'.repeat(5000) },
    })).status()).toBe(400);
    expect((await request.post(`${BASE_URL}/api/v1/calendar/tasks`, {
      headers: headers(tokenB), data: { title: 'x', geoLat: 91, geoLng: 0 },
    })).status()).toBe(400);
  });

  test('an edit that sends no geo fields keeps the geofence, and the next occurrence carries it', async ({ request }) => {
    const { email, password } = await register(request);
    const token = await login(request, email, password);
    const created = (await (await request.post(`${BASE_URL}/api/v1/calendar/tasks`, {
      headers: headers(token),
      data: {
        title: 'Gym',
        dueDate: '2026-10-05T00:00:00Z',
        recurrenceRule: 'FREQ=WEEKLY',
        geoLat: 40.7128, geoLng: -74.006, geoRadiusM: 300,
      },
    })).json()) as Task;

    // What an older client sends: a rename, then a completion.
    await request.patch(`${BASE_URL}/api/v1/calendar/tasks/${created.id}`, { headers: headers(token), data: { title: 'Gym class' } });
    const done = (await (await request.patch(`${BASE_URL}/api/v1/calendar/tasks/${created.id}`, {
      headers: headers(token), data: { done: true },
    })).json()) as Task;

    expect(done).toMatchObject({ title: 'Gym class', geoLat: 40.7128, geoLng: -74.006, geoRadiusM: 300 });
    expect(done.nextTask).toMatchObject({ geoLat: 40.7128, geoLng: -74.006, geoRadiusM: 300 });
  });
});

test.describe('Task places on the web', () => {
  test('a place saved from the task editor is ciphertext on the server and attaches with @name', async ({ page, request }) => {
    const token = await registerAndLogin(request, page);
    const create = await request.post(`${BASE_URL}/api/v1/calendar/tasks`, {
      headers: headers(token), data: { title: 'Take out the bins' },
    });
    const taskId = ((await create.json()) as Task).id;

    await page.goto('/calendar');
    await page.getByRole('button', { name: 'Take out the bins', exact: true }).click();
    const editor = page.getByRole('dialog').filter({ hasText: 'Edit Task' });
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await editor.getByRole('button', { name: 'Choose a place…' }).click();

    const picker = page.getByRole('dialog').filter({ hasText: 'Remind me when I arrive' }).last();
    await picker.getByRole('button', { name: 'Use my current location' }).click();
    await expect(picker.getByTestId('place-spot')).toBeVisible({ timeout: 10_000 });
    await picker.getByLabel('Save as a place').check();
    await picker.getByLabel('Place name').fill('Home');
    await picker.getByRole('button', { name: 'Remind me here' }).click();

    await expect(editor.getByTestId('task-geofence')).toContainText('Home', { timeout: 10_000 });
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).not.toBeVisible({ timeout: 10_000 });

    // Ciphertext only: no name, no coordinates.
    const [stored] = await places(request, token);
    expect(stored).toBeTruthy();
    expect(stored.encryptedPayload).not.toContain('Home');
    expect(stored.encryptedPayload).not.toContain('51.50');
    expect(Object.keys(JSON.parse(stored.encryptedPayload)).sort()).toEqual(['data', 'key', 'keyVersion', 'v']);
    expect((await tasks(request, token)).find((t) => t.id === taskId)).toMatchObject({ geoPlaceId: stored.id, location: 'Home' });

    // Smart Add matches the saved place by name and attaches it on create.
    const composer = page.getByLabel('Add a task');
    await composer.fill('Water plants @home');
    await expect(page.getByText('Home · reminds on arrival')).toBeVisible({ timeout: 10_000 });
    await composer.press('Enter');
    await expect
      .poll(async () => (await tasks(request, token)).find((t) => t.title === 'Water plants')?.geoPlaceId, { timeout: 10_000 })
      .toBe(stored.id);

    // Settings reads it back with the account key.
    await page.goto('/settings?tab=calendar');
    const section = page.getByTestId('saved-places-section');
    await expect(section.getByTestId('saved-place-row')).toContainText('Home', { timeout: 15_000 });
    await expect(section.getByTestId('saved-place-row')).toContainText('51.5014, -0.1419');
  });
});
