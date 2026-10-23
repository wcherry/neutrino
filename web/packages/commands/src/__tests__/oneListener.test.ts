/**
 * Holds the web app to one keyboard dispatcher: no source file outside this package may add its
 * own key listener, and every command id the code registers must be in the catalog (or Settings ›
 * Keyboard cannot show it and its keys are never looked up).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { COMMANDS } from '../catalog';

const WEB = path.resolve(__dirname, '../../../..');
const ROOTS = [path.join(WEB, 'apps/web/src'), path.join(WEB, 'packages')];

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((r) => sources(r)).filter((f) => !f.includes(`${path.sep}packages${path.sep}commands${path.sep}`));

describe('one keyboard dispatcher', () => {
  it('found the source tree', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it('is the only thing listening for keys outside an element’s own handler', () => {
    const offenders = files.filter((f) => /addEventListener\(\s*['"]key(down|up|press)['"]/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(WEB, f)), 'use useCommand, useDismiss or useKeyHandler from @neutrino/commands').toEqual([]);
  });

  it('only hears registrations of commands that are in the catalog', () => {
    const known = new Set<string>(COMMANDS.map((c) => c.id));
    const unknown: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      if (!text.includes('@neutrino/commands')) continue;
      // `useCommand` and `useCommands` are typed by the catalog; `registerCommand` takes any string.
      for (const m of text.matchAll(/registerCommand\(\s*'([\w.]+)'/g)) {
        if (!known.has(m[1])) unknown.push(`${path.relative(WEB, f)}: ${m[1]}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
