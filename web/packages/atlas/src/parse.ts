import { convert, type TopLevelBlock } from './convert';
import { ExtensionPasses } from './passes';
import { Preprocessed } from './preprocess';
import type { MarkdownNode } from './tree';

/** The spec this package implements; it must match the corpus manifest. */
export const SPEC_VERSION = '1.0.0-draft.6';

/** Parses a page into its Atlas Markdown tree (SPEC §3, §4). */
export function parse(source: string): MarkdownNode {
  return { type: 'root', children: parseLayout(source).map((b) => b.node) };
}

/**
 * The top-level blocks of a page, in order, each with the 1-based source lines it occupies.
 * Frontmatter is the first block when present. Source preservation (§8.1) is built on this.
 */
export function parseLayout(source: string): TopLevelBlock[] {
  const prepared = new Preprocessed(source);
  const blocks = new ExtensionPasses(prepared.tokens).applyTopLevel(convert(prepared.parserSource).blocks);
  if (prepared.frontmatter !== null) {
    blocks.unshift({ node: { type: 'yaml', value: prepared.frontmatter }, lines: [1, prepared.frontmatterLineCount] });
  }
  return blocks;
}

/**
 * What in-place edits need about one block's text (§8.2): its tree, where its wiki links and
 * embeds are (UTF-16 ranges, in tree order), where its task items start (UTF-16 offsets of their
 * list markers, in tree order), and the text the parser treats as opaque (code spans, and every
 * wiki link, embed and inline math token). Never call it on frontmatter.
 */
export interface Anatomy {
  blocks: MarkdownNode[];
  links: [number, number][];
  tasks: { line: number; column: number }[];
  opaque: [number, number][];
}

export function anatomy(text: string): Anatomy {
  const prepared = new Preprocessed(text);
  const converted = convert(prepared.parserSource);
  const passes = new ExtensionPasses(prepared.tokens);
  const blocks = passes.applyTopLevel(converted.blocks).map((b) => b.node);
  const links = passes.materialized.map((i) => prepared.tokenSourceRanges.get(i)).filter((r): r is [number, number] => !!r);
  return {
    blocks, links, tasks: converted.tasks,
    opaque: [...prepared.codeSpanRanges, ...prepared.tokenSourceRanges.values()],
  };
}
