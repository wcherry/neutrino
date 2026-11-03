import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { anchorLine, headingLinkText } from '../anchors';
import { MarkdownDocument } from '../document';
import { serializeCanonical } from '../serialize';
import { extract } from '../extract';
import { parse, SPEC_VERSION } from '../parse';
import { LinkResolver } from '../resolve';

/**
 * The Atlas Markdown conformance corpus (SPEC §9), read straight from `specs/atlas-markdown`
 * in this repository: no vendored copy to drift.
 */
const CORPUS = join(__dirname, '../../../../../specs/atlas-markdown/corpus');
const read = (...p: string[]) => readFileSync(join(CORPUS, ...p), 'utf8');
const manifest = JSON.parse(read('manifest.json')) as { specVersion: string; cases: { id: string; description: string }[]; resolve: string[]; anchors?: string[] };

describe('Atlas Markdown corpus', () => {
  it('is the spec version this package implements', () => {
    expect(manifest.specVersion).toBe(SPEC_VERSION);
  });

  describe.each(manifest.cases.map((c) => [c.id, c.description] as const))('%s', (id) => {
    it('P: parses to its tree', () => {
      expect(parse(read('cases', id, 'input.md'))).toEqual(JSON.parse(read('cases', id, 'ast.json')));
    });
    it('R: round-trips byte for byte', () => {
      const input = read('cases', id, 'input.md');
      expect(new MarkdownDocument(input).serialized()).toBe(input);
    });
    it('C: writes canonically, and that parses back', () => {
      const ast = JSON.parse(read('cases', id, 'ast.json'));
      const canonicalPath = join(CORPUS, 'cases', id, 'canonical.md');
      const expected = existsSync(canonicalPath) ? readFileSync(canonicalPath, 'utf8') : read('cases', id, 'input.md');
      const written = serializeCanonical(ast);
      expect(written).toBe(expected);
      expect(parse(written)).toEqual(ast);
    });
    it('E: extracts its record', () => {
      expect(extract(parse(read('cases', id, 'input.md')))).toEqual(JSON.parse(read('cases', id, 'extract.json')));
    });
  });

  describe.each(manifest.resolve)('resolve/%s', (name) => {
    const fx = JSON.parse(read('resolve', `${name}.json`)) as {
      files: string[]; resolve: { from: string; target: string; expect: string | null; why: string }[]; write: { file: string; expect: string }[];
    };
    const resolver = new LinkResolver(fx.files);
    it.each(fx.resolve.map((c) => [c.target, c.from, c.why, c] as const))('%s from %s (%s)', (_t, _f, _w, c) => {
      expect(resolver.resolve(c.target, c.from)).toBe(c.expect);
    });
    it.each(fx.write.map((c) => [c.file, c] as const))('writes a link to %s', (_f, c) => {
      expect(resolver.linkTarget(c.file)).toBe(c.expect);
    });
  });

  describe.each(manifest.anchors ?? [])('anchors/%s', (name) => {
    const fx = JSON.parse(read('anchors', `${name}.json`)) as {
      page: string; anchors: { heading?: string; blockId?: string; expect: string | null; why: string }[]; headingLinks: { text: string; expect: string }[];
    };
    const lines = fx.page.split('\n');
    const root = parse(fx.page);
    it.each(fx.anchors.map((c) => [c.heading ?? '^' + c.blockId, c.why, c] as const))('%s (%s)', (_l, _w, c) => {
      const line = anchorLine(root, c);
      expect(line === null ? null : lines[line - 1]).toBe(c.expect);
    });
    it.each(fx.headingLinks.map((c) => [c.text, c] as const))('writes a link to the heading %s', (_t, c) => {
      expect(headingLinkText(c.text)).toBe(c.expect);
    });
  });
});

export { existsSync };
