/**
 * The guard for issue #95: nothing in the web app may write user content to
 * Drive unencrypted.
 *
 * Every other test in this directory checks one call site. This one checks the
 * property those call sites depend on — that there is no plaintext write to
 * call — because a per-call-site test only covers the code that exists today,
 * and the bug was never one bad call site. It was a dozen of them, each written
 * independently, each adding `else { …write plaintext… }` because a plaintext
 * helper was sitting in `@neutrino/api-drive` looking like a reasonable
 * fallback. Delete the helpers and the next person cannot repeat it.
 *
 * If this test fails, do not add a name to the allowlist to make it pass. The
 * point is that the allowlist stays empty. Write through
 * `uploadDriveFile` / `autosaveEncrypted` / `createEncryptedVersion`, or take
 * the DEK explicitly with one of the `*Encrypted*` helpers.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as driveApi from '@neutrino/api-drive';
import { drawingApi } from '@neutrino/api-drawing';
import { diagramsApi } from '@neutrino/api-diagrams';
import { photosApi } from '@neutrino/api-photos';

/** Repo root of the web workspace, from this file's location. */
const WEB_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const SCAN_ROOTS = [join(WEB_ROOT, 'apps', 'web', 'src'), join(WEB_ROOT, 'packages')];

/**
 * Names that used to write user content to Drive in the clear.
 *
 * They are gone. Naming them here is what turns "someone reintroduces one" from
 * a silent regression into a failing test — a fresh `driveAutosaveContent` in
 * `client.ts` would otherwise look like a helpful addition.
 */
const BANNED_WRITERS = [
  'driveWriteContent',
  'driveAutosaveContent',
  'driveCreateVersion',
  'driveAutosaveBytes',
  'driveCreateVersionBytes',
];

/**
 * `storageApi.uploadFile` and the per-app plaintext autosaves, matched as whole
 * member expressions so an unrelated local named `uploadFile` does not trip it.
 */
const BANNED_MEMBER_CALLS = [
  /\bstorageApi\s*\.\s*uploadFile\b/,
  /\bdrawingApi\s*\.\s*autosaveContent\b/,
  /\bdiagramsApi\s*\.\s*autosaveContent\b/,
  /\bphotosApi\s*\.\s*uploadPhoto\b/,
];

/**
 * Comments out, so the ban is on calling a plaintext writer rather than on
 * naming one. Explaining why a helper was removed is exactly what should be
 * written next to the code that replaced it, and a scanner that forbids saying
 * the name pushes those explanations out of the files that need them.
 *
 * Crude on purpose — a `//` inside a string literal takes the rest of the line
 * with it. That can only ever hide a reference, never invent one, and no
 * caller of a Drive helper writes it inside a string.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Source files, minus tests.
 *
 * Tests are excluded because a test that pins the ban down has to name the
 * banned thing — including this file, which would otherwise fail on its own
 * allowlist. Test files cannot write to a real Drive in any case.
 */
const FILES = SCAN_ROOTS.flatMap(sourceFiles).filter(
  (p) => !/__tests__|\.test\.tsx?$/.test(p),
);

describe('issue #95 — no plaintext content writes exist', () => {
  it('scans a meaningful number of source files', () => {
    // A path mistake would make every assertion below pass vacuously.
    expect(FILES.length).toBeGreaterThan(200);
  });

  it.each(BANNED_WRITERS)('%s is not exported by @neutrino/api-drive', (name) => {
    expect(driveApi).not.toHaveProperty(name);
  });

  it('storageApi has no plaintext uploadFile', () => {
    expect(driveApi.storageApi).not.toHaveProperty('uploadFile');
  });

  it('the per-app clients have no plaintext content writers', () => {
    expect(drawingApi).not.toHaveProperty('autosaveContent');
    expect(diagramsApi).not.toHaveProperty('autosaveContent');
    expect(photosApi).not.toHaveProperty('uploadPhoto');
  });

  it('no source file references a plaintext writer', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const name of BANNED_WRITERS) {
        // Word-boundary match, so a hit on `driveCreateVersionBytes` is not
        // reported as `driveCreateVersion` — both are banned, but the message
        // should name the right one.
        if (new RegExp(`\\b${name}\\b`).test(code)) {
          offenders.push(`${relative(WEB_ROOT, file)} → ${name}`);
        }
      }
      for (const pattern of BANNED_MEMBER_CALLS) {
        if (pattern.test(code)) {
          offenders.push(`${relative(WEB_ROOT, file)} → ${pattern.source}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('exposes the encrypted replacements every caller is meant to use', () => {
    expect(typeof driveApi.uploadDriveFile).toBe('function');
    expect(typeof driveApi.autosaveEncrypted).toBe('function');
    expect(typeof driveApi.createEncryptedVersion).toBe('function');
    expect(typeof driveApi.mintFileKey).toBe('function');
    expect(typeof driveApi.requireFileKey).toBe('function');
    expect(typeof driveApi.canEncryptFor).toBe('function');
  });
});
