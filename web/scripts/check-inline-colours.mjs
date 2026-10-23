#!/usr/bin/env node
/**
 * No literal colours in inline styles in the shared packages (UI roadmap stage 6).
 *
 * The web app enforces this with ESLint (`apps/web/.eslintrc.json`); the packages have no ESLint
 * of their own, so this checks the same two places by text: a JSX `style={{…}}` attribute and an
 * object literal declared as `CSSProperties`. A colour anywhere else is data (a palette offered to
 * the user, a default stored in a file) and is left alone.
 *
 * Usage: node scripts/check-inline-colours.mjs [dir …]   (default: packages)
 */
import fs from 'node:fs';
import path from 'node:path';

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['packages'];
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const STR = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '__tests__', 'stories', '.next'].includes(entry.name)) continue;
      yield* files(p);
    } else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.stories.tsx') && !entry.name.endsWith('.test.tsx')) {
      yield p;
    }
  }
}

function closing(text, open) {
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return j;
  }
  return text.length - 1;
}

const problems = [];
for (const root of roots) {
  for (const file of files(root)) {
    const text = fs.readFileSync(file, 'utf8');
    const starts = [
      ...[...text.matchAll(/style=\{\{/g)].map((m) => m.index + 6),
      ...[...text.matchAll(/:\s*(?:React\.)?CSSProperties\s*=\s*\{/g)].map((m) => m.index + m[0].length - 1),
    ];
    for (const start of starts) {
      const block = text.slice(start, closing(text, start) + 1);
      for (const m of block.matchAll(STR)) {
        if (HEX.test(m[0])) {
          const line = text.slice(0, start + m.index).split('\n').length;
          problems.push(`${file}:${line}: literal colour ${m[0]} in a style — use a token from @neutrino/tokens`);
        }
      }
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} literal colour(s) in inline styles.`);
  process.exit(1);
}
console.log('No literal colours in inline styles.');
