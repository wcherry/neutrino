// Postbuild step: stamps a real build id into the service worker's cache
// name so every deploy invalidates the previous app shell automatically.
//
// `next build` (static export mode, see next.config.ts's `output: 'export'`)
// copies public/sw.js verbatim into out/sw.js. We rewrite the __BUILD_ID__
// placeholder in the *output* file only — never the source under public/ —
// so the placeholder survives for the next build.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const swPath = path.resolve(scriptDir, '../out/sw.js');

if (!existsSync(swPath)) {
  console.warn(`[stamp-sw-build-id] ${swPath} not found — skipping (not a static export build?)`);
  process.exit(0);
}

function resolveBuildId() {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    // Fall back to a timestamp so the build never hard-fails on this step
    // (e.g. a shallow clone in some CI context with no git history).
    return `ts-${Date.now()}`;
  }
}

const buildId = resolveBuildId();
const contents = readFileSync(swPath, 'utf8');
writeFileSync(swPath, contents.replaceAll('__BUILD_ID__', buildId), 'utf8');

console.log(`[stamp-sw-build-id] stamped sw.js with build id "${buildId}"`);
