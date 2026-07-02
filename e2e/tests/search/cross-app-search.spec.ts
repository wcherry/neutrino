import { test, expect } from '../../fixtures/base';
import type { APIRequestContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:9880';

function uniqueEmail(): string {
  return `search_ui_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(request: APIRequestContext, page: Page): Promise<void> {
  const email = uniqueEmail();
  const password = 'Password123!';
  const res = await request.post(`${BASE_URL}/api/v1/auth/register`, {
    data: { name: 'Search UI Test User', email, password },
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
 * Wait for ensureE2EKeys to store the Curve25519 keypair, then return the user ID.
 * The engine in the search page only initializes if a keypair exists in localStorage.
 */
async function waitForKeypairAndGetUserId(page: Page): Promise<string> {
  await page.waitForFunction(
    () => {
      for (let i = 0; i < localStorage.length; i++) {
        if (localStorage.key(i)?.startsWith('neutrino_e2e_')) return true;
      }
      return false;
    },
    { timeout: 15_000 },
  );
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('neutrino_e2e_')) return k.slice('neutrino_e2e_'.length);
    }
    return '';
  });
}

type SeedDoc = {
  id: string;
  type: 'document' | 'note' | 'spreadsheet' | 'slide' | 'event' | 'reminder';
  title: string;
  content?: string;
};

/**
 * Seeds the real neutrino_search IndexedDB with the given documents.
 * Uses (or creates) the user's HMAC search key from localStorage so that
 * the search page queries against the same key.
 */
async function seedSearchDb(page: Page, userId: string, docs: SeedDoc[]): Promise<void> {
  await page.evaluate(
    async ({ userId, docs }: { userId: string; docs: SeedDoc[] }) => {
      const PUNCT_RE = /[^\p{L}\p{N}\s]/gu;
      function normalizeText(text: string): string[] {
        const normalized = text.normalize('NFC').toLowerCase().replace(PUNCT_RE, ' ');
        return [...new Set(normalized.split(/\s+/).filter(Boolean))];
      }
      async function hashToken(token: string, key: CryptoKey): Promise<string> {
        const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
        return Array.from(new Uint8Array(sig))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      }

      // Get or create the search key so it matches what the search page will use.
      const storageKey = `search_key_v1_${userId}`;
      let stored = localStorage.getItem(storageKey);
      if (!stored) {
        const raw = crypto.getRandomValues(new Uint8Array(32));
        stored = btoa(String.fromCharCode(...raw));
        localStorage.setItem(storageKey, stored);
      }
      const rawKey = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        rawKey,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('neutrino_search', 1);
        req.onupgradeneeded = (e) => {
          const d = (e.target as IDBOpenDBRequest).result;
          if (!d.objectStoreNames.contains('tokens')) {
            const ts = d.createObjectStore('tokens', {
              keyPath: ['tokenHash', 'documentId', 'field'],
            });
            ts.createIndex('byTokenHash', 'tokenHash', { unique: false });
            ts.createIndex('byDocumentId', 'documentId', { unique: false });
          }
          if (!d.objectStoreNames.contains('docs')) {
            d.createObjectStore('docs', { keyPath: 'documentId' });
          }
        };
        req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
        req.onerror = () => reject(req.error);
      });

      function idbPut(storeName: string, record: object): Promise<void> {
        return new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).put(record);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }

      for (const doc of docs) {
        for (const [field, text] of [
          ['title', doc.title],
          ['content', doc.content ?? ''],
        ] as [string, string][]) {
          if (!text.trim()) continue;
          const tokens = normalizeText(text);
          for (const token of tokens) {
            const hash = await hashToken(token, cryptoKey);
            await idbPut('tokens', {
              tokenHash: hash,
              documentId: doc.id,
              field,
              frequency: 1,
              positions: new Uint8Array(4),
            });
          }
        }
        await idbPut('docs', {
          documentId: doc.id,
          type: doc.type,
          titleHashes: [],
          contentHashes: [],
          updatedAt: Date.now(),
        });
      }

      db.close();
    },
    { userId, docs } as { userId: string; docs: SeedDoc[] },
  );
}

test.describe('Search page rendering', () => {
  test('page loads with heading and search input', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/search');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Search');
    await expect(page.locator('main').getByRole('searchbox', { name: 'Search' })).toBeVisible();
  });

  test('empty input does not show the no-results message', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await page.goto('/search');
    await expect(page.locator('main').getByRole('searchbox', { name: 'Search' })).toBeVisible();
    await expect(page.getByText(/No results for/)).not.toBeVisible();
  });
});

test.describe('Search page: no-results state', () => {
  test('typing a query with nothing indexed shows "No results for" message', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await page.goto('/search');
    await page.locator('main').getByRole('searchbox', { name: 'Search' }).fill('xylophoneaardvark');
    await expect(page.getByText(/No results for/)).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Search page: results from indexed content', () => {
  test('document type shows Document badge', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const userId = await waitForKeypairAndGetUserId(page);
    await seedSearchDb(page, userId, [
      { id: 'e2e-quasar-doc', type: 'document', title: 'quasar finance report' },
    ]);
    await page.goto('/search');
    await page.locator('main').getByRole('searchbox', { name: 'Search' }).fill('quasar');
    await expect(page.locator('[data-testid="search-result"]')).toHaveCount(1, { timeout: 5_000 });
    await expect(page.locator('[data-testid="search-result"]').first()).toContainText('Document');
  });

  test('note type shows Note badge', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const userId = await waitForKeypairAndGetUserId(page);
    await seedSearchDb(page, userId, [
      { id: 'e2e-pulsar-note', type: 'note', title: 'pulsar meeting notes' },
    ]);
    await page.goto('/search');
    await page.locator('main').getByRole('searchbox', { name: 'Search' }).fill('pulsar');
    await expect(page.locator('[data-testid="search-result"]')).toHaveCount(1, { timeout: 5_000 });
    await expect(page.locator('[data-testid="search-result"]').first()).toContainText('Note');
  });

  test('spreadsheet type shows Sheet badge', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const userId = await waitForKeypairAndGetUserId(page);
    await seedSearchDb(page, userId, [
      { id: 'e2e-parsec-sheet', type: 'spreadsheet', title: 'parsec budget tracker' },
    ]);
    await page.goto('/search');
    await page.locator('main').getByRole('searchbox', { name: 'Search' }).fill('parsec');
    await expect(page.locator('[data-testid="search-result"]')).toHaveCount(1, { timeout: 5_000 });
    await expect(page.locator('[data-testid="search-result"]').first()).toContainText('Sheet');
  });

  test('slide type shows Slide badge', async ({ page, request }) => {
    await registerAndLogin(request, page);
    const userId = await waitForKeypairAndGetUserId(page);
    await seedSearchDb(page, userId, [
      { id: 'e2e-nebula-slide', type: 'slide', title: 'nebula presentation deck' },
    ]);
    await page.goto('/search');
    await page.locator('main').getByRole('searchbox', { name: 'Search' }).fill('nebula');
    await expect(page.locator('[data-testid="search-result"]')).toHaveCount(1, { timeout: 5_000 });
    await expect(page.locator('[data-testid="search-result"]').first()).toContainText('Slide');
  });

  test('all four content types seeded with a shared term return one result each', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const userId = await waitForKeypairAndGetUserId(page);
    await seedSearchDb(page, userId, [
      { id: 'e2e-multi-doc', type: 'document', title: 'neutrinotest overview document' },
      { id: 'e2e-multi-note', type: 'note', title: 'neutrinotest meeting note' },
      { id: 'e2e-multi-sheet', type: 'spreadsheet', title: 'neutrinotest budget sheet' },
      { id: 'e2e-multi-slide', type: 'slide', title: 'neutrinotest pitch slide' },
    ]);
    await page.goto('/search');
    await page.locator('main').getByRole('searchbox', { name: 'Search' }).fill('neutrinotest');
    const results = page.locator('[data-testid="search-result"]');
    await expect(results).toHaveCount(4, { timeout: 5_000 });
    await expect(results.filter({ hasText: 'Document' })).toHaveCount(1);
    await expect(results.filter({ hasText: 'Note' })).toHaveCount(1);
    await expect(results.filter({ hasText: 'Sheet' })).toHaveCount(1);
    await expect(results.filter({ hasText: 'Slide' })).toHaveCount(1);
  });

  test('multi-word AND: only returns docs matching all query terms', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const userId = await waitForKeypairAndGetUserId(page);
    await seedSearchDb(page, userId, [
      { id: 'e2e-and-match', type: 'note', title: 'flamingo budget planning' },
      { id: 'e2e-and-nomatch', type: 'note', title: 'flamingo general overview' },
    ]);
    await page.goto('/search');
    const input = page.locator('main').getByRole('searchbox', { name: 'Search' });

    await input.fill('flamingo budget');
    await expect(page.locator('[data-testid="search-result"]')).toHaveCount(1, { timeout: 5_000 });

    await input.fill('flamingo');
    await expect(page.locator('[data-testid="search-result"]')).toHaveCount(2, { timeout: 5_000 });
  });

  test('clearing the query removes all results and hides the no-results message', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    const userId = await waitForKeypairAndGetUserId(page);
    await seedSearchDb(page, userId, [
      { id: 'e2e-clear-doc', type: 'document', title: 'zephyr cleartest report' },
    ]);
    await page.goto('/search');
    const input = page.locator('main').getByRole('searchbox', { name: 'Search' });

    await input.fill('zephyr');
    await expect(page.locator('[data-testid="search-result"]')).toHaveCount(1, { timeout: 5_000 });

    await input.fill('');
    await expect(page.locator('[data-testid="search-result"]')).toHaveCount(0, { timeout: 3_000 });
    await expect(page.getByText(/No results for/)).not.toBeVisible();
  });
});
