// Writes web/version.txt — the version and commit the web UI reports in the
// sidebar footer and under Settings → About.
//
// Run by the Dockerfile's web build stage, so every published image is stamped
// with the version and commit that produced it. The file is generated, never
// committed: outside a container there is no image to name, so a local build
// simply has no version.txt and `next.config.ts` falls back to the commit alone
// (see its `readVersion`), which is what "blank unless it can be gathered
// easily" means in practice.
//
// Values come from the environment, which is how the Dockerfile passes its
// build args through:
//   APP_VERSION   the version to report, e.g. 0.1.42. Blank if unknown.
//   BUILD_COMMIT  the commit being built. Blank falls back to git, then to ''.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

/** `web/version.txt` — the web workspace root, which is what Docker copies. */
export const VERSION_FILE = path.resolve(scriptDir, '../../../version.txt');

/**
 * Trims a full SHA to the 7 characters git itself abbreviates to, so a caller
 * can pass `github.sha` (40 chars) without the UI showing all of it.
 */
export function shortCommit(commit) {
  return commit.trim().slice(0, 7);
}

export function formatVersionFile({ version, commit }) {
  return `version=${version}\ncommit=${commit}\n`;
}

function commitFromGit() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: scriptDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    // No git here — the Dockerfile's web stage copies `web/` without `.git`,
    // which is exactly why BUILD_COMMIT is passed in.
    return '';
  }
}

export function main() {
  const version = (process.env.APP_VERSION ?? '').trim();
  const commit = shortCommit(process.env.BUILD_COMMIT || commitFromGit());

  writeFileSync(VERSION_FILE, formatVersionFile({ version, commit }), 'utf8');
  console.log(
    `[write-version] version=${version || '(none)'} commit=${commit || '(none)'}`,
  );
}

// Only when run as a script, so the helpers above stay importable from tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
