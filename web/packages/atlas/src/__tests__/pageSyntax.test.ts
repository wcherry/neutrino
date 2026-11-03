// @vitest-environment node
// AtlasKit's PageSyntaxTests, MarkdownStylerTests, WikiLinkTests (the parts outside the editor)
// and MentionLinkerTests, ported.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from '../parse';
import { allSpans, pageSyntax, type SyntaxKind } from '../syntax/pageSyntax';
import { linkingMentions } from '../syntax/mentionLinker';
import { linkAt, shouldOpenLink, styleRuns, type EditorMode, type TextStyle } from '../syntax/styler';
import { childrenOf, type MarkdownNode } from '../tree';
import { SplitMix } from './splitMix';

/** A span's kind as Swift prints it, so cases read as they do in AtlasKit. */
export function kindName(kind: SyntaxKind): string {
  const opt = (v: string | boolean | null) => (v === null ? 'nil' : `Optional(${typeof v === 'string' ? JSON.stringify(v) : v})`);
  const ref = (r: { target: string; heading: string | null; blockId: string | null; alias: string | null }) =>
    `AtlasCore.WikiLinkReference(target: ${JSON.stringify(r.target)}, heading: ${opt(r.heading)}, blockId: ${opt(r.blockId)}, alias: ${opt(r.alias)})`;
  switch (kind.type) {
    case 'syntax': return kind.role === 'taskMarker' ? `taskMarker(checked: ${kind.checked})` : kind.role;
    case 'heading': return `heading(level: ${kind.level})`;
    case 'callout': return `callout(type: ${JSON.stringify(kind.calloutType)})`;
    case 'listItem': return `listItem(ordered: ${kind.ordered}, checked: ${opt(kind.checked)})`;
    case 'codeBlock': return `codeBlock(language: ${opt(kind.language)})`;
    case 'footnoteDefinition': return `footnoteDefinition(identifier: ${JSON.stringify(kind.identifier)})`;
    case 'link': return `link(url: ${JSON.stringify(kind.url)})`;
    case 'image': return `image(url: ${JSON.stringify(kind.url)})`;
    case 'wikiLink': return `wikiLink(${ref(kind.ref)})`;
    case 'embed': return `embed(${ref(kind.ref)})`;
    case 'tag': return `tag(name: ${JSON.stringify(kind.name)})`;
    case 'footnoteReference': return `footnoteReference(identifier: ${JSON.stringify(kind.identifier)})`;
    default: return kind.type;
  }
}

/** Each span as `kind "text"`, in order. */
const spans = (source: string) => allSpans(pageSyntax(source)).map((s) => `${kindName(s.kind)} ${JSON.stringify(source.slice(s.from, s.to))}`);

function syntax(source: string, roles: string[]) {
  expect(pageSyntax(source).blocks.every((b) => b.isComplete), `incomplete: ${JSON.stringify(source)}`).toBe(true);
  expect(spans(source)).toEqual(roles);
}

describe('PageSyntax', () => {
  it('maps headings and emphasis', () => {
    syntax('## A **b** _c_ ##', [
      'heading(level: 2) "## A **b** _c_ ##"',
      'headingMarker "## "',
      'strong "**b**"', 'delimiter "**"', 'delimiter "**"',
      'emphasis "_c_"', 'delimiter "_"', 'delimiter "_"',
      'headingMarker " ##"',
    ]);
    syntax('Title\n===', ['heading(level: 1) "Title\\n==="', 'headingMarker "==="']);
  });

  it('maps inline constructs', () => {
    syntax('a `x` $y$ ==z== ~~w~~ \\* &amp; #tag [[P|alias]] ![[E]] [l](u "t") <http://a.b>', [
      'inlineCode "`x`"', 'delimiter "`"', 'delimiter "`"',
      'inlineMath "$y$"', 'delimiter "$"', 'delimiter "$"',
      'highlight "==z=="', 'delimiter "=="', 'delimiter "=="',
      'strikethrough "~~w~~"', 'delimiter "~~"', 'delimiter "~~"',
      'escape "\\\\"',
      'tag(name: "tag") "#tag"',
      'wikiLink(AtlasCore.WikiLinkReference(target: "P", heading: nil, blockId: nil, alias: Optional("alias"))) "[[P|alias]]"',
      'wikiBracket "[["', 'wikiTarget "P|"', 'wikiBracket "]]"',
      'embed(AtlasCore.WikiLinkReference(target: "E", heading: nil, blockId: nil, alias: nil)) "![[E]]"',
      'wikiBracket "![["', 'wikiBracket "]]"',
      'link(url: "u") "[l](u \\"t\\")"', 'linkBracket "["', 'linkBracket "]"', 'linkDestination "(u \\"t\\")"',
      'link(url: "http://a.b") "<http://a.b>"', 'linkBracket "<"', 'linkBracket ">"',
    ]);
  });

  it('maps containers', () => {
    syntax('> quote\n> more', ['blockquote "> quote\\n> more"', 'quoteMarker "> "', 'quoteMarker "> "']);
    syntax('- [ ] task\n  - [x] done\n1. one', [
      'listItem(ordered: false, checked: Optional(false)) "- [ ] task\\n  - [x] done"',
      'listMarker "-"', 'taskMarker(checked: false) "[ ]"',
      'listItem(ordered: false, checked: Optional(true)) "- [x] done"',
      'listMarker "-"', 'taskMarker(checked: true) "[x]"',
      'listItem(ordered: true, checked: nil) "1. one"', 'listMarker "1."',
    ]);
    syntax('> [!tip]+ Title\n> body ^b1', [
      'callout(type: "tip") "> [!tip]+ Title\\n> body ^b1"',
      'quoteMarker "> "', 'calloutMarker "[!tip]+"', 'quoteMarker "> "', 'blockId "^b1"',
    ]);
  });

  it('maps code, math, tables and frontmatter', () => {
    syntax('---\ntitle: x\n---\n\n```swift\nlet a = 1\n```\n\n$$\nx^2\n$$\n^m\n\n| a | b |\n|---|---|\n| 1 | **2** |', [
      'frontmatter "---\\ntitle: x\\n---"', 'frontmatterFence "---"', 'frontmatterFence "---"',
      'codeBlock(language: Optional("swift")) "```swift\\nlet a = 1\\n```"', 'codeFence "```swift"', 'codeFence "```"',
      'mathBlock "$$\\nx^2\\n$$"', 'mathFence "$$"', 'mathFence "$$"', 'blockId "^m"',
      'table "| a | b |\\n|---|---|\\n| 1 | **2** |"',
      'tablePipe "|"', 'tablePipe "|"', 'tablePipe "|"', 'tableDelimiterRow "|---|---|"',
      'tablePipe "|"', 'tablePipe "|"', 'strong "**2**"', 'delimiter "**"', 'delimiter "**"', 'tablePipe "|"',
    ]);
  });

  it('counts offsets in UTF-16', () => {
    const span = allSpans(pageSyntax('😀 **é**')).find((s) => s.kind.type === 'strong')!;
    expect([span.from, span.to]).toEqual([3, 8]);
  });

  it('treats \\r\\n as one line ending', () => {
    syntax('> a\r\n> b', ['blockquote "> a\\r\\n> b"', 'quoteMarker "> "', 'quoteMarker "> "']);
  });

  it('skips reference definitions and follows lazy lines', () => {
    syntax('> [r]: /u\n> see [r]\nlazy', [
      'blockquote "> [r]: /u\\n> see [r]\\nlazy"', 'quoteMarker "> "', 'quoteMarker "> "',
      'link(url: "/u") "[r]"', 'linkBracket "["', 'linkBracket "]"',
    ]);
  });

  it('maps a long page quickly', () => {
    const section = `## Section with **bold**, _emphasis_ and a [[Wiki link|alias]]

A paragraph with \`code\`, $math$, ==highlight==, #tag and [a link](https://example.com "t").
It continues on a second line, with an escaped \\* and an &amp; entity.

- [ ] a task with [[Another page]]
- [x] done
  - nested item
1. ordered

> [!note] Callout
> with a body

| a | b |
|---|---|
| 1 | **2** |

\`\`\`swift
let x = 1
\`\`\`


`;
    const page = section.repeat(400);
    const start = performance.now();
    const map = pageSyntax(page);
    const elapsed = performance.now() - start;
    expect(map.blocks.every((b) => b.isComplete)).toBe(true);
    // The parser dominates; vitest runs micromark's development build, about 3× slower.
    expect(elapsed).toBeLessThan(6000);
  });
});

// ── Against the parser ──────────────────────────────────────────────────────────

/** What a complete block's spans must contain: one per construct in its tree. */
function expectedKinds(node: MarkdownNode, ordered = false, inline = false): string[] {
  const kids = (k: MarkdownNode[], inl = true) => k.flatMap((n) => expectedKinds(n, false, inl));
  const name = (kind: SyntaxKind) => kindName(kind);
  switch (node.type) {
    case 'yaml': return ['frontmatter'];
    case 'heading': return [name({ type: 'heading', level: node.depth }), ...kids(node.children)];
    case 'blockquote': return ['blockquote', ...kids(node.children, false)];
    case 'callout': return [name({ type: 'callout', calloutType: node.calloutType }), ...kids(node.title ?? []), ...kids(node.children, false)];
    case 'list': return node.children.flatMap((item) => expectedKinds(item, node.ordered));
    case 'listItem': return [name({ type: 'listItem', ordered, checked: node.checked }), ...kids(node.children, false)];
    case 'code': return [name({ type: 'codeBlock', language: node.lang })];
    case 'math': return ['mathBlock'];
    case 'table': return ['table', ...node.children.flatMap((row) => childrenOf(row).flatMap((cell) => kids(childrenOf(cell))))];
    case 'thematicBreak': return ['thematicBreak'];
    case 'html': return [inline ? 'inlineHTML' : 'htmlBlock'];
    case 'footnoteDefinition': return [name({ type: 'footnoteDefinition', identifier: node.identifier }), ...kids(node.children, false)];
    case 'strong': return ['strong', ...kids(node.children)];
    case 'emphasis': return ['emphasis', ...kids(node.children)];
    case 'delete': return ['strikethrough', ...kids(node.children)];
    case 'highlight': return ['highlight', ...kids(node.children)];
    case 'inlineCode': return ['inlineCode'];
    case 'inlineMath': return ['inlineMath'];
    case 'link': return [name({ type: 'link', url: node.url }), ...kids(node.children)];
    case 'image': return [name({ type: 'image', url: node.url })];
    case 'wikiLink': case 'embed': {
      const ref = { target: node.target, heading: node.heading, blockId: node.blockId, alias: node.alias };
      return [name(node.type === 'wikiLink' ? { type: 'wikiLink', ref } : { type: 'embed', ref })];
    }
    case 'tag': return [name({ type: 'tag', name: node.name })];
    case 'footnoteReference': return [name({ type: 'footnoteReference', identifier: node.identifier })];
    case 'root': return kids(node.children, false);
    case 'paragraph': return kids(node.children, true);
    default: return childrenOf(node).flatMap((n) => expectedKinds(n, false, true));
  }
}

/** For every complete block, its constructs are exactly the tree's, and every span is in the block and inside the page. */
function checkAgainstTree(source: string): { complete: number; total: number } {
  const map = pageSyntax(source);
  expect(map.blocks.map((b) => b.node)).toEqual(childrenOf(parse(source)));
  let complete = 0;
  for (const block of map.blocks) {
    for (const span of block.spans) {
      if (span.from < block.from || span.to > block.to || span.from < 0 || span.to > source.length) {
        throw new Error(`span leaves its block in ${JSON.stringify(source)}`);
      }
    }
    if (!block.isComplete) continue;
    complete++;
    const found = block.spans.filter((s) => s.kind.type !== 'syntax').map((s) => kindName(s.kind));
    expect(found.sort(), `constructs differ in ${JSON.stringify(source)}`).toEqual(expectedKinds(block.node).sort());
  }
  return { complete, total: map.blocks.length };
}

describe('PageSyntax against the parser', () => {
  it('aligns the whole corpus completely', () => {
    const corpus = join(__dirname, '../../../../../specs/atlas-markdown/corpus');
    const manifest = JSON.parse(readFileSync(join(corpus, 'manifest.json'), 'utf8')) as { cases: { id: string }[] };
    const incomplete: string[] = [];
    for (const c of manifest.cases) {
      const { complete, total } = checkAgainstTree(readFileSync(join(corpus, 'cases', c.id, 'input.md'), 'utf8'));
      if (complete < total) incomplete.push(c.id);
    }
    expect(incomplete).toEqual([]);
  });

  it('agrees with the tree on random pages', () => {
    const rng = new SplitMix(0x51a7n);
    const next = (bound: number) => rng.next(bound);
    const pieces = [
      ...'[]!#=^$|\\`*_~<>-+.:() \t\n',
      'a', 'x', 'é', '😀', '- ', '1. ', '> ', '- [ ] ', '[[P]]', '[[P|a]]', '![[E]]', '#t', '==h==', '**b**', '_e_',
      '`c`', '$m$', '[l](u)', '[r]', '[r]: /u\n', '<http://a.b>', 'www.x.com', '&amp;', '&copy;', '\\*', '```\n',
      '$$\n', '---\n', '| a | b |\n|---|---|\n', '> [!note] T\n', '[^1]', '[^1]: n\n', ' ^id', '\n\n', '    ', '<b>', '\r\n',
    ];
    let complete = 0;
    let total = 0;
    for (let n = 0; n < 1500; n++) {
      const source = Array.from({ length: next(40) }, () => pieces[next(pieces.length)]).join('');
      const r = checkAgainstTree(source);
      complete += r.complete;
      total += r.total;
    }
    expect(complete).toBeGreaterThan(0.995 * total);
  });
});

// ── Styling ─────────────────────────────────────────────────────────────────────

describe('styleRuns', () => {
  /** The text of every hidden run on the page, for a cursor at `cursor`. */
  const hidden = (source: string, cursor: number, mode: EditorMode = 'livePreview') =>
    pageSyntax(source).blocks
      .flatMap((b) => styleRuns(b, { from: cursor, to: cursor }, mode))
      .filter((r) => r.style.hidden)
      .map((r) => source.slice(r.from, r.to));

  const style = (source: string, offset: number): TextStyle => {
    const block = pageSyntax(source).blocks.find((b) => b.from <= offset && offset < b.to)!;
    return styleRuns(block, { from: 0, to: 0 }, 'livePreview').find((r) => r.from <= offset && offset < r.to)!.style;
  };

  it('hides syntax away from the cursor and shows it inside its construct', () => {
    const page = '# Title\n\nSome **bold** and [[Page|alias]].\n';
    expect(hidden(page, page.length)).toEqual(['# ', '**', '**', '[[Page|', ']]']);
    expect(hidden(page, page.indexOf('bold') + 1)).toEqual(['# ', '[[Page|', ']]']);
    // Touching the construct's edge counts, so the cursor never walks through hidden text.
    expect(hidden(page, page.indexOf(']].') + 2)).toEqual(['# ', '**', '**']);
    expect(hidden(page, page.length, 'source')).toEqual([]);
  });

  it('keeps structure visible', () => {
    const page = '- [ ] task\n> quote\n\n```\ncode\n```\n';
    expect(hidden(page, page.length)).toEqual([]);
  });

  it('styles each construct', () => {
    const page = '## Head\n\n**b** _i_ `c` ==h== #tag [l](u)\n';
    const at = (s: string) => style(page, page.indexOf(s));
    expect([at('Head').font, at('Head').level, at('Head').bold]).toEqual(['heading', 2, true]);
    expect(at('b*').bold).toBe(true);
    expect(at('i_').italic).toBe(true);
    expect(at('c`').font).toBe('monospace');
    expect(at('h=').highlight).toBe(true);
    expect(at('#tag').color).toBe('tag');
    expect(at('l]').color).toBe('link');
  });

  it('covers the block without gaps', () => {
    const block = pageSyntax('A **b _c_ d** e [x](y) `z`\n').blocks[0];
    const runs = styleRuns(block, { from: 0, to: 0 }, 'livePreview');
    expect(runs[0].from).toBe(block.from);
    expect(runs[runs.length - 1].to).toBe(block.to);
    for (let k = 1; k < runs.length; k++) expect(runs[k].from).toBe(runs[k - 1].to);
  });
});

describe('links', () => {
  const page = 'See [[Plan|the plan]], ![[Chart.png]] and [docs](https://x.y).\n';
  const offset = (s: string) => page.indexOf(s);

  it('finds the link at an offset', () => {
    const map = pageSyntax(page);
    expect(linkAt(offset('the plan'), map)?.target).toEqual({ type: 'wiki', ref: { target: 'Plan', heading: null, blockId: null, alias: 'the plan' } });
    expect(linkAt(offset('Chart'), map)?.target).toEqual({ type: 'wiki', ref: { target: 'Chart.png', heading: null, blockId: null, alias: null } });
    expect(linkAt(offset('docs'), map)?.target).toEqual({ type: 'url', url: 'https://x.y' });
    expect(linkAt(1, map)).toBeNull();
  });

  it('opens a link shown as a link with a click', () => {
    const map = pageSyntax(page);
    const at = offset('the plan');
    const elsewhere = { from: 0, to: 0 };
    const inside = { from: at + 2, to: at + 2 };
    expect(shouldOpenLink(at, map, elsewhere, 'livePreview', false)).not.toBeNull();
    expect(shouldOpenLink(at, map, inside, 'livePreview', false), 'editing it, a click places the cursor').toBeNull();
    expect(shouldOpenLink(at, map, elsewhere, 'source', false)).toBeNull();
    expect(shouldOpenLink(at, map, inside, 'source', true), '⌘-click always follows').not.toBeNull();
  });
});

describe('linkingMentions', () => {
  const link = (source: string, name = 'Plan', target = 'Plan') => linkingMentions(name, target, source)?.text ?? null;

  it('turns mentions into links, keeping their words', () => {
    expect(link('We went over the plan today. Plan B next.\n')).toBe('We went over the [[plan]] today. [[Plan]] B next.\n');
    expect(linkingMentions('Plan', 'Plan', 'plan and plan\n')?.linked).toBe(2);
    expect(link('- the plan\n> **plan** here\n# Plan\n')).toBe('- the [[plan]]\n> **[[plan]]** here\n# [[Plan]]\n');
  });

  it('keeps the words as the alias when the target is different', () => {
    expect(link('see the plan\n', 'Plan', 'Projects/Plan')).toBe('see the [[Projects/Plan|plan]]\n');
    expect(link('a cafe nearby\n', 'Café', 'Café')).toBe('a [[Café|cafe]] nearby\n');
  });

  it('links only plain text', () => {
    expect(link('planning and planned\n'), 'whole words only').toBeNull();
    expect(link('`plan` and $plan$ and [plan](u) and [[Plan]] and #plan\n')).toBeNull();
    expect(link('```\nplan\n```\n')).toBeNull();
    expect(link('---\ntitle: plan\n---\n')).toBeNull();
    expect(link('Pl**an** split by syntax\n')).toBeNull();
    expect(link('nothing here\n')).toBeNull();
    expect(link('`plan` but also plan\n')).toBe('`plan` but also [[plan]]\n');
  });

  it('links a name with spaces', () => {
    expect(link('the Q4 plan is due\n', 'Q4 plan', 'Q4 plan')).toBe('the [[Q4 plan]] is due\n');
  });

  it('never gets random pages wrong', () => {
    const rng = new SplitMix(0x4e17n);
    const next = (bound: number) => rng.next(bound);
    const pieces = ['plan', 'Plan', ' ', '\n', '**', '_', '`', '[[', ']]', '[', '](u)', '#', '> ', '- ', 'plans', 'é', '|', '\\', '$', '---\n', '```\n', '==', '~'];
    for (let n = 0; n < 1500; n++) {
      const source = Array.from({ length: next(30) }, () => pieces[next(pieces.length)]).join('');
      const result = linkingMentions('plan', 'Plan', source);
      if (result) {
        expect(result.linked).toBeGreaterThan(0);
        expect(result.text.length).toBeGreaterThan(source.length);
      }
    }
  });
});
