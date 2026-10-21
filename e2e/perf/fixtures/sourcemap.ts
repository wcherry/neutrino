/**
 * Turning `chunk-4f2a9c.js @ 182043` into `SheetGrid.tsx:412`.
 *
 * Step 1 of the attribution playbook only pays off if the frame it names is
 * readable. A production export ships hashed chunks, so a LoAF script entry
 * points at `/_next/static/chunks/4823-9b1c7f0e2d.js` and a character offset —
 * true, and useless in a CI artifact.
 *
 * This resolves that offset against the chunk's source map, when one is
 * reachable. Two things have to be true for it to be:
 *
 *  1. The build emitted browser source maps. Next does not by default;
 *     `NEUTRINO_BROWSER_SOURCEMAPS=1` turns on `productionBrowserSourceMaps`
 *     in `next.config.ts`, and `run-perf.sh` sets it for the image it builds.
 *     A run without them still reports the chunk and offset, it just cannot
 *     name the file.
 *  2. The map is served next to the chunk, which `actix-files` does for
 *     anything in the export output.
 *
 * Maps are fetched once per run and cached, because a scenario with a slow
 * frame usually has the same chunk in every repeat.
 */

import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import type { APIRequestContext } from '@playwright/test';
import type { LoafSample, ResolvedFrame, ScriptSample } from './types';

/** `null` marks "looked, found nothing" so a missing map is not re-fetched. */
const cache = new Map<string, TraceMap | null>();

/**
 * Line/column for a character offset into a generated file.
 *
 * `sourceCharPosition` is a byte offset into the chunk; source maps are keyed
 * by line and column. Converting needs the chunk text, which is fetched
 * alongside the map and thrown away — chunks are large and only one number
 * from each is wanted.
 */
function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: Math.max(0, offset - lineStart) };
}

interface ChunkInfo {
  map: TraceMap;
  text: string;
}

const chunkCache = new Map<string, ChunkInfo | null>();

async function loadChunk(
  request: APIRequestContext,
  url: string,
): Promise<ChunkInfo | null> {
  const cached = chunkCache.get(url);
  if (cached !== undefined) return cached;

  let info: ChunkInfo | null = null;
  try {
    const chunkRes = await request.get(url);
    if (chunkRes.ok()) {
      const text = await chunkRes.text();
      // Prefer the URL the chunk itself names; fall back to the convention.
      const declared = /\/\/[#@]\s*sourceMappingURL=(\S+)/.exec(text)?.[1];
      const mapUrl = declared ? new URL(declared, url).toString() : `${url}.map`;
      if (!mapUrl.startsWith('data:')) {
        const mapRes = await request.get(mapUrl);
        if (mapRes.ok()) {
          info = { map: new TraceMap(await mapRes.text()), text };
        }
      }
    }
  } catch {
    // A chunk that cannot be fetched is not a test failure — it costs the
    // report a file name, nothing more.
    info = null;
  }
  chunkCache.set(url, info);
  cache.set(url, info?.map ?? null);
  return info;
}

/** Strip the workspace-relative noise webpack puts in front of a source path. */
function tidySource(source: string): string {
  return source
    .replace(/^webpack:\/\/(_N_E)?\//, '')
    .replace(/^\.\//, '')
    .replace(/\?.*$/, '');
}

/** `node_modules/.pnpm/pdfmake@0.3.9/node_modules/pdfmake/build/…` → `pdfmake`; app code keeps its path. */
function packageOf(file: string): string {
  const parts = file.split('node_modules/');
  if (parts.length === 1) return file;
  const rest = parts[parts.length - 1].split('/');
  return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
}

/**
 * What a chunk is made of, by share of its source text, largest first.
 *
 * A LoAF script entry for *evaluating* a chunk — a dynamically imported
 * library running its top level for the first time — carries no character
 * position, so there is no line to resolve. Naming the packages inside it is
 * what makes a 700 ms "(anonymous) 6919.js" entry say "pdfmake" instead.
 */
function chunkContents(map: TraceMap, limit = 3): string[] {
  const sizes = new Map<string, number>();
  const contents = map.sourcesContent ?? [];
  map.sources.forEach((source, i) => {
    if (!source) return;
    const name = packageOf(tidySource(source));
    sizes.set(name, (sizes.get(name) ?? 0) + (contents[i]?.length ?? 0));
  });
  const total = [...sizes.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  return [...sizes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, size]) => `${name} ${Math.round((size / total) * 100)}%`);
}

/** Resolve one LoAF script entry to a source location, where possible. */
export async function resolveFrame(
  request: APIRequestContext,
  script: ScriptSample,
): Promise<ResolvedFrame> {
  const frame: ResolvedFrame = {
    chunk: script.sourceURL,
    functionName: script.sourceFunctionName || '(anonymous)',
    duration: script.duration,
    source: null,
  };

  if (!script.sourceURL) return frame;
  if (!/^https?:/.test(script.sourceURL)) return frame;

  const chunk = await loadChunk(request, script.sourceURL);
  if (!chunk) return frame;

  if (script.sourceCharPosition < 0) {
    const contents = chunkContents(chunk.map);
    if (contents.length > 0) {
      frame.functionName = '(evaluate chunk)';
      frame.contents = contents;
    }
    return frame;
  }

  const { line, column } = offsetToLineColumn(chunk.text, script.sourceCharPosition);
  const original = originalPositionFor(chunk.map, { line, column });
  if (original.source && original.line != null) {
    frame.source = {
      file: tidySource(original.source),
      line: original.line,
      column: original.column ?? 0,
    };
    if (original.name) frame.functionName = original.name;
  }
  return frame;
}

/**
 * The frames worth putting in the report: the longest scripts from the
 * longest-blocking animation frames, deduplicated by function.
 *
 * Capped because a slow scenario can produce hundreds of LoAF entries and a
 * report that lists them all names nothing.
 */
export async function resolveWorstFrames(
  request: APIRequestContext,
  loafs: LoafSample[],
  limit = 5,
): Promise<ResolvedFrame[]> {
  const scripts = loafs
    .flatMap((loaf) => loaf.scripts)
    .filter((s) => s.duration > 0)
    .sort((a, b) => b.duration - a.duration);

  const seen = new Set<string>();
  const picked: ScriptSample[] = [];
  for (const script of scripts) {
    const key = `${script.sourceURL}#${script.sourceCharPosition}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(script);
    if (picked.length >= limit) break;
  }

  return Promise.all(picked.map((s) => resolveFrame(request, s)));
}
