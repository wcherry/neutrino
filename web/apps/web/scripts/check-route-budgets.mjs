#!/usr/bin/env node
/**
 * Fails the build when a route's first-load JavaScript grows past its budget.
 *
 * Reads the static export (`out/`): for each route in `route-budgets.json`, the scripts its HTML
 * loads or preloads, summed raw (uncompressed, which is what the browser parses). The same
 * measure as the perf suite's F2, but with no server, so it runs on every `pnpm build` — the
 * Docker image included — and the next import of a heavy library into the shell stops the build
 * instead of being found months later (agent_docs/ui-performance-roadmap.md, P4).
 *
 * A budget that has to go up is a decision: raise it in `route-budgets.json` in the same change
 * and say why in the commit. `NEUTRINO_SKIP_SIZE_BUDGETS=1` skips the check for a one-off build.
 *
 *   node scripts/check-route-budgets.mjs            # check
 *   node scripts/check-route-budgets.mjs --report   # print sizes, never fail
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const outDir = path.join(appDir, 'out');
const report = process.argv.includes('--report');

if (process.env.NEUTRINO_SKIP_SIZE_BUDGETS === '1' && !report) {
  console.log('[route-budgets] skipped (NEUTRINO_SKIP_SIZE_BUDGETS=1)');
  process.exit(0);
}
if (!fs.existsSync(outDir)) {
  // `next build` in development mode produces no export; nothing to measure.
  console.log('[route-budgets] no out/ directory — nothing to check');
  process.exit(0);
}

const { routes } = JSON.parse(fs.readFileSync(path.join(appDir, 'route-budgets.json'), 'utf8'));

const sizes = new Map();
function sizeOf(url) {
  if (!sizes.has(url)) {
    const file = path.join(outDir, url.split('?')[0]);
    sizes.set(url, fs.existsSync(file) ? fs.statSync(file).size : 0);
  }
  return sizes.get(url);
}

function firstLoadScripts(html) {
  const urls = new Set();
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) urls.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+rel="preload"[^>]+as="script"[^>]+href="([^"]+)"/g)) urls.add(m[1]);
  return [...urls].filter((u) => u.startsWith('/_next/'));
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
let failed = 0;
const rows = [];
for (const [route, budgetKb] of Object.entries(routes)) {
  const file = path.join(outDir, route === '/' ? '' : route, 'index.html');
  if (!fs.existsSync(file)) {
    console.error(`[route-budgets] ${route}: no ${path.relative(appDir, file)} — remove it from route-budgets.json if the route is gone`);
    failed++;
    continue;
  }
  const bytes = firstLoadScripts(fs.readFileSync(file, 'utf8')).reduce((sum, u) => sum + sizeOf(u), 0);
  const over = bytes > budgetKb * 1024;
  if (over) failed++;
  rows.push(`${over ? '✗' : '✓'} ${route.padEnd(18)} ${kb(bytes).padStart(8)} of ${String(budgetKb).padStart(5)} KB`);
}

console.log(`[route-budgets] first-load JS per route, raw:\n  ${rows.join('\n  ')}`);
if (failed && !report) {
  console.error(
    `[route-budgets] ${failed} route(s) over budget. Find what grew with \`pnpm analyze\`; if the growth is ` +
      'intended, raise the budget in apps/web/route-budgets.json and say why in the commit.',
  );
  process.exit(1);
}
