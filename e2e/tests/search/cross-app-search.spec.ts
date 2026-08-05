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
 * Get the page ready to hold seeded index entries.
 *
 * Waits for `ensureE2EKeys` to store the keypair, since the search page only
 * builds its engine when one exists. Then turns off the background index sync
 * through the same localStorage flag Settings → Advanced writes: the sync
 * reconciles the index against the server's listing and drops entries for
 * anything it does not find, which is every document these tests seed.
 */
async function prepareForSeeding(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      for (let i = 0; i < localStorage.length; i++) {
        if (localStorage.key(i)?.startsWith('neutrino_e2e_')) return true;
      }
      return false;
    },
    { timeout: 15_000 },
  );
  await page.evaluate(() => localStorage.setItem('neutrino:search:syncDisabled', 'true'));
}

type SeedDoc = {
  id: string;
  type: 'document' | 'note' | 'spreadsheet' | 'slide' | 'event' | 'reminder';
  title: string;
  content?: string;
};

/**
 * Seeds the real neutrino_search IndexedDB with the given documents.
 *
 * Mirrors what `IndexEngine.indexDocument` writes (see
 * `web/packages/search/src/db.ts`): schema v2, one `tokens` row per distinct
 * term keyed by `[term, documentId, field]`, and a `docs` row carrying the
 * title the results list renders. Terms are stored as plain text — v1's HMACs
 * were dropped because hashing destroys the prefixes range queries need — so
 * no search key is involved any more.
 */
async function seedSearchDb(page: Page, docs: SeedDoc[]): Promise<void> {
  await page.evaluate(async (docs: SeedDoc[]) => {
    const PUNCT_RE = /[^\p{L}\p{N}\s]/gu;
    /** Word offsets per distinct term, matching `tokenizeWithPositions`. */
    function termPositions(text: string): Map<string, number[]> {
      const words = text.normalize('NFC').toLowerCase().replace(PUNCT_RE, ' ').split(/\s+/).filter(Boolean);
      const map = new Map<string, number[]>();
      words.forEach((word, i) => {
        const existing = map.get(word);
        if (existing) existing.push(i);
        else map.set(word, [i]);
      });
      return map;
    }
    /** Positions are stored packed little-endian, four bytes each. */
    function positionsToBytes(positions: number[]): Uint8Array {
      const buf = new Uint8Array(positions.length * 4);
      const view = new DataView(buf.buffer);
      positions.forEach((p, i) => view.setUint32(i * 4, p, true));
      return buf;
    }

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('neutrino_search', 2);
      req.onupgradeneeded = (e) => {
        const d = (e.target as IDBOpenDBRequest).result;
        if (d.objectStoreNames.contains('tokens')) d.deleteObjectStore('tokens');
        if (d.objectStoreNames.contains('docs')) d.deleteObjectStore('docs');
        const ts = d.createObjectStore('tokens', { keyPath: ['term', 'documentId', 'field'] });
        ts.createIndex('byTerm', 'term', { unique: false });
        ts.createIndex('byDocumentId', 'documentId', { unique: false });
        d.createObjectStore('docs', { keyPath: 'documentId' });
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
      const fields: [string, Map<string, number[]>][] = [
        ['title', termPositions(doc.title)],
        ['content', termPositions(doc.content ?? '')],
      ];
      for (const [field, terms] of fields) {
        for (const [term, positions] of terms) {
          await idbPut('tokens', {
            term,
            documentId: doc.id,
            field,
            frequency: positions.length,
            positions: positionsToBytes(positions),
          });
        }
      }
      await idbPut('docs', {
        documentId: doc.id,
        type: doc.type,
        title: doc.title,
        titleTerms: [...fields[0][1].keys()],
        contentTerms: [...fields[1][1].keys()],
        updatedAt: Date.now(),
      });
    }

    db.close();
  }, docs);
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
    await prepareForSeeding(page);
    await seedSearchDb(page, [
      { id: 'e2e-quasar-doc', type: 'document', title: 'quasar finance report' },
    ]);
    await page.goto('/search');
    await page.locator('main').getByRole('searchbox', { name: 'Search' }).fill('quasar');
    await expect(page.locator('[data-testid="search-result"]')).toHaveCount(1, { timeout: 5_000 });
    await expect(page.locator('[data-testid="search-result"]').first()).toContainText('Document');
  });

  test('note type shows Note badge', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await prepareForSeeding(page);
    await seedSearchDb(page, [
      { id: 'e2e-pulsar-note', type: 'note', title: 'pulsar meeting notes' },
    ]);
    await page.goto('/search');
    await page.locator('main').getByRole('searchbox', { name: 'Search' }).fill('pulsar');
    await expect(page.locator('[data-testid="search-result"]')).toHaveCount(1, { timeout: 5_000 });
    await expect(page.locator('[data-testid="search-result"]').first()).toContainText('Note');
  });

  test('spreadsheet type shows Sheet badge', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await prepareForSeeding(page);
    await seedSearchDb(page, [
      { id: 'e2e-parsec-sheet', type: 'spreadsheet', title: 'parsec budget tracker' },
    ]);
    await page.goto('/search');
    await page.locator('main').getByRole('searchbox', { name: 'Search' }).fill('parsec');
    await expect(page.locator('[data-testid="search-result"]')).toHaveCount(1, { timeout: 5_000 });
    await expect(page.locator('[data-testid="search-result"]').first()).toContainText('Sheet');
  });

  test('slide type shows Slide badge', async ({ page, request }) => {
    await registerAndLogin(request, page);
    await prepareForSeeding(page);
    await seedSearchDb(page, [
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
    await prepareForSeeding(page);
    await seedSearchDb(page, [
      { id: 'e2e-multi-doc', type: 'document', title: 'neutrinotest overview document' },
      { id: 'e2e-multi-note', type: 'note', title: 'neutrinotest meeting note' },
      { id: 'e2e-multi-sheet', type: 'spreadsheet', title: 'neutrinotest budget sheet' },
      { id: 'e2e-multi-slide', type: 'slide', title: 'neutrinotest pitch slide' },
    ]);
    await page.goto('/search');
    await page.locator('main').getByRole('searchbox', { name: 'Search' }).fill('neutrinotest');
    const results = page.locator('[data-testid="search-result"]');
    await expect(results).toHaveCount(4, { timeout: 5_000 });
    // Match the badge element exactly rather than the row's text: a row also
    // renders its title, and "neutrinotest" happens to contain "note", so a
    // substring filter over the whole row matches every result.
    for (const label of ['Document', 'Note', 'Sheet', 'Slide']) {
      await expect(
        results.filter({ has: page.getByText(label, { exact: true }) }),
      ).toHaveCount(1);
    }
  });

  test('multi-word AND: only returns docs matching all query terms', async ({
    page,
    request,
  }) => {
    await registerAndLogin(request, page);
    await prepareForSeeding(page);
    await seedSearchDb(page, [
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
    await prepareForSeeding(page);
    await seedSearchDb(page, [
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
