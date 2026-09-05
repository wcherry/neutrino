/**
 * F1–F2. The delivery lane: how the bytes are served, and how many there are.
 *
 * No interaction, no throttling that matters, and the fastest feedback in the
 * suite — which is the point. A regression that lands here ("someone imported
 * `xlsx` into the shell") is caught in seconds without a browser test ever
 * having to notice the page got slower.
 *
 * Both scenarios are expected to fail on the first run, and that is the design
 * doc's §8 findings 1 and 2 being confirmed rather than a broken test: the
 * server registers `Logger` and `NormalizePath` but no `Compress` middleware,
 * and `actix_files::Files` sets `use_etag`/`use_last_modified` and no
 * `Cache-Control`. The suite runs advisory by default (see `ENFORCE` in
 * `env.ts`), so a confirmed finding reports rather than blocks — the point of
 * measuring first is to have the before number when the one-line fix lands.
 */

import { expect, test } from '../fixtures/perf';
import { signIn } from '../fixtures/session';
import { seedFiles } from '../fixtures/seed';
import { BASE_URL } from '../fixtures/env';
import { waitForFirstRow, waitForIdle } from '../fixtures/actions';

interface AssetRecord {
  url: string;
  status: number;
  contentType: string;
  encoding: string | null;
  cacheControl: string | null;
  bytes: number;
}

/** Every route with its own export entry, for the per-route bundle budget. */
const ROUTES = [
  '/sign-in',
  '/drive',
  '/docs',
  '/docs/editor',
  '/sheets',
  '/sheets/editor',
  '/slides',
  '/slides/editor',
  '/photos',
  '/notes',
  '/diagrams',
  '/calendar',
];

test.describe('F — delivery and payload', () => {
  test('F1 asset delivery audit @smoke', async ({ perf, page, request }) => {
    const session = await signIn(request, page, 'f1');
    await seedFiles(session, 'S');

    await perf.scenario(
      {
        id: 'F1',
        title: 'Delivery audit — encoding and cache headers on every /drive asset',
        repeats: 1,
        manualMetricsOnly: true,
        budgets: { uncompressedTextAssets: 0, staticAssetsWithoutImmutable: 0 },
      },
      async (s) => {
        const assets: AssetRecord[] = [];
        const seen = new Set<string>();

        const onResponse = async (res: import('@playwright/test').Response): Promise<void> => {
          const url = res.url();
          if (seen.has(url)) return;
          seen.add(url);
          const headers = res.headers();
          let bytes = 0;
          try {
            bytes = (await res.request().sizes()).responseBodySize;
          } catch {
            // Aborted or cache-served; zero is the right answer for the report.
          }
          assets.push({
            url,
            status: res.status(),
            contentType: headers['content-type'] ?? '',
            encoding: headers['content-encoding'] ?? null,
            cacheControl: headers['cache-control'] ?? null,
            bytes,
          });
        };
        page.on('response', onResponse);

        await s.coldStart();
        await page.goto('/drive');
        await waitForFirstRow(page);
        await waitForIdle(page);
        page.off('response', onResponse);

        const isText = (a: AssetRecord): boolean =>
          /javascript|text\/css|text\/html|application\/json/.test(a.contentType);
        const isHashedStatic = (a: AssetRecord): boolean =>
          a.url.includes('/_next/static/');

        const textAssets = assets.filter(isText);
        const uncompressed = textAssets.filter((a) => a.encoding === null);
        const staticAssets = assets.filter(isHashedStatic);
        const withoutImmutable = staticAssets.filter(
          (a) => !(a.cacheControl ?? '').includes('immutable'),
        );

        s.record('assetCount', assets.length, 'count');
        s.record('textAssetCount', textAssets.length, 'count');
        s.record('uncompressedTextAssets', uncompressed.length, 'count');
        s.record('staticAssetCount', staticAssets.length, 'count');
        s.record('staticAssetsWithoutImmutable', withoutImmutable.length, 'count');
        s.record(
          'uncompressedTextBytes',
          uncompressed.reduce((sum, a) => sum + a.bytes, 0),
          'bytes',
        );

        // The detail belongs in the artifact, not in five hundred console
        // lines — the counts above are what the budget judges.
        test.info().attach('F1-assets.json', {
          body: JSON.stringify(
            {
              uncompressed: uncompressed.map((a) => ({ url: a.url, bytes: a.bytes })),
              withoutImmutable: withoutImmutable.map((a) => ({
                url: a.url,
                cacheControl: a.cacheControl,
              })),
              all: assets,
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
      },
    );
  });

  test('F2 per-route bundle budget @smoke', async ({ perf, request }) => {
    await perf.scenario(
      {
        id: 'F2',
        title: 'Bundle budget — first-load JS per route entry',
        repeats: 1,
        manualMetricsOnly: true,
        // No seed budget: "how big should a route be" has no defensible
        // universal answer, so this one is pure ratchet from the first
        // `--write-baselines` onwards.
      },
      async (s) => {
        // Read from the served export rather than from a build directory, so
        // the numbers describe the artifact that is actually deployed — and so
        // the scenario needs nothing but a running stack.
        const sizes = new Map<string, number>();
        const sizeOf = async (url: string): Promise<number> => {
          const cached = sizes.get(url);
          if (cached !== undefined) return cached;
          const res = await request.get(url);
          const bytes = res.ok() ? (await res.body()).byteLength : 0;
          sizes.set(url, bytes);
          return bytes;
        };

        const perRoute: Record<string, { bytes: number; chunks: number }> = {};
        let worstRoute = '';
        let worstBytes = 0;

        for (const route of ROUTES) {
          // `trailingSlash: true` in next.config.ts, so this is the export's
          // own file name for the route.
          const res = await request.get(`${BASE_URL}${route}/`);
          if (!res.ok()) continue;
          const html = await res.text();

          // Scripts the document loads, plus what it preloads as script —
          // together, the JS a first visit to this route pays for.
          const urls = new Set<string>();
          for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
            urls.add(new URL(match[1], BASE_URL).toString());
          }
          for (const match of html.matchAll(
            /<link[^>]+rel="preload"[^>]+as="script"[^>]+href="([^"]+)"/g,
          )) {
            urls.add(new URL(match[1], BASE_URL).toString());
          }

          let bytes = 0;
          for (const url of urls) bytes += await sizeOf(url);

          const key = route === '/' ? 'root' : route.replace(/^\//, '').replace(/\//g, '_');
          perRoute[key] = { bytes, chunks: urls.size };
          s.record(`route_${key}`, bytes, 'bytes');
          if (bytes > worstBytes) {
            worstBytes = bytes;
            worstRoute = route;
          }
        }

        expect(
          Object.keys(perRoute).length,
          'no route HTML could be fetched — is the stack serving the export?',
        ).toBeGreaterThan(0);

        s.record('heaviestRouteBytes', worstBytes, 'bytes');
        s.record(
          'sharedChunkBytes',
          [...sizes.values()].reduce((a, b) => a + b, 0),
          'bytes',
        );

        const largest = [...sizes.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([url, bytes]) => ({ url, bytes }));
        test.info().attach('F2-bundles.json', {
          body: JSON.stringify({ heaviest: worstRoute, perRoute, largest }, null, 2),
          contentType: 'application/json',
        });
      },
    );
  });
});
