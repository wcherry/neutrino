import type { PageSyntax, SyntaxBlock, SyntaxKind, SyntaxRole, SyntaxSpan } from './pageSyntax';
import type { WikiLinkReference } from '../tree';

/**
 * How a run of text looks, independent of the editor. AtlasKit's `TextStyle`; the web's
 * editor turns it into CSS classes.
 */
export interface TextStyle {
  font: 'body' | 'heading' | 'monospace';
  /** The heading's level, with `font: 'heading'`. */
  level: number;
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  highlight: boolean;
  codeBackground: boolean;
  color: 'text' | 'syntax' | 'link' | 'tag' | 'quote' | 'secondary';
  /** Live Preview hides this syntax: the cursor isn't in the construct it belongs to. */
  hidden: boolean;
}

export interface StyleRun {
  /** UTF-16 offsets into the page. */
  from: number;
  to: number;
  style: TextStyle;
}

/**
 * `livePreview`: Markdown styled in place, with syntax hidden away from the cursor (Obsidian's
 * Live Preview). `source`: every character shown, still styled.
 */
export type EditorMode = 'livePreview' | 'source';

const plain = (): TextStyle => ({
  font: 'body', level: 0, bold: false, italic: false, strikethrough: false, highlight: false,
  codeBackground: false, color: 'text', hidden: false,
});

function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return a.font === b.font && a.level === b.level && a.bold === b.bold && a.italic === b.italic && a.strikethrough === b.strikethrough
    && a.highlight === b.highlight && a.codeBackground === b.codeBackground && a.color === b.color && a.hidden === b.hidden;
}

/**
 * The runs for one block, covering its whole range: AtlasKit's `MarkdownStyler`. `selection`
 * is in UTF-16 offsets; a construct is revealed when the selection touches it, ends included, so
 * the cursor never moves through hidden characters: they show as soon as it reaches them.
 */
export function styleRuns(block: SyntaxBlock, selection: { from: number; to: number }, mode: EditorMode): StyleRun[] {
  const spans = block.spans;
  if (block.from >= block.to) return [];

  // Each syntax span belongs to the innermost construct around it: `**` to its strong,
  // `## ` to its heading. With none, the block is its construct.
  const constructs = spans.filter((s) => s.kind.type !== 'syntax');
  const owner = (s: SyntaxSpan): { from: number; to: number } => {
    let best = { from: block.from, to: block.to };
    for (const c of constructs) {
      if (c.from <= s.from && s.to <= c.to && c.to - c.from <= best.to - best.from) best = c;
    }
    return best;
  };
  const revealed = (r: { from: number; to: number }) => mode === 'source' || (selection.from <= r.to && selection.to >= r.from);
  const hidden = spans.map((span) => span.kind.type === 'syntax' && isConcealable(span.kind.role) && !revealed(owner(span)));

  const cuts = new Set([block.from, block.to]);
  for (const s of spans) {
    cuts.add(Math.max(s.from, block.from));
    cuts.add(Math.min(s.to, block.to));
  }
  const points = [...cuts].sort((a, b) => a - b);

  const runs: StyleRun[] = [];
  for (let p = 0; p + 1 < points.length; p++) {
    const a = points[p];
    const b = points[p + 1];
    if (a >= b) continue;
    const style = plain();
    // Outer spans first, so inner ones refine them.
    spans.forEach((s, k) => {
      if (s.from <= a && b <= s.to) {
        apply(s.kind, style);
        if (hidden[k]) style.hidden = true;
      }
    });
    const last = runs[runs.length - 1];
    if (last && sameStyle(last.style, style) && last.to === a) last.to = b;
    else runs.push({ from: a, to: b, style });
  }
  return runs;
}

function apply(kind: SyntaxKind, style: TextStyle): void {
  switch (kind.type) {
    case 'heading': style.font = 'heading'; style.level = kind.level; style.bold = true; break;
    case 'strong': style.bold = true; break;
    case 'emphasis': style.italic = true; break;
    case 'strikethrough': style.strikethrough = true; break;
    case 'highlight': style.highlight = true; break;
    case 'inlineCode': case 'codeBlock': case 'mathBlock': style.font = 'monospace'; style.level = 0; style.codeBackground = true; break;
    case 'inlineMath': case 'table': style.font = 'monospace'; style.level = 0; break;
    case 'frontmatter': style.font = 'monospace'; style.level = 0; style.color = 'secondary'; break;
    case 'htmlBlock': case 'inlineHTML': style.color = 'secondary'; break;
    case 'link': case 'image': case 'wikiLink': case 'embed': case 'footnoteReference': style.color = 'link'; break;
    case 'tag': style.color = 'tag'; break;
    case 'blockquote': case 'callout': style.color = 'quote'; break;
    case 'thematicBreak': style.color = 'syntax'; break;
    case 'listItem': case 'footnoteDefinition': break;
    case 'syntax': style.color = 'syntax'; break;
  }
}

/**
 * Syntax that Live Preview hides. List and task markers, quote bars, fences, pipes and callout
 * markers stay: they are what the reader sees as the structure.
 */
export function isConcealable(role: SyntaxRole): boolean {
  switch (role) {
    case 'headingMarker': case 'delimiter': case 'linkBracket': case 'linkDestination': case 'wikiBracket': case 'wikiTarget':
    case 'escape': case 'blockId': case 'hardBreak':
      return true;
    default:
      return false;
  }
}

// ── Links ─────────────────────────────────────────────────────────────────────

/** What a link in the page points at, for the app to open: a wiki link or embed, or a Markdown link or autolink. */
export type LinkTarget = { type: 'wiki'; ref: WikiLinkReference } | { type: 'url'; url: string };

/** The link or wiki link at `offset`, and its range. The innermost one, so a link inside a link's text is the one clicked. */
export function linkAt(offset: number, syntax: PageSyntax): { target: LinkTarget; from: number; to: number } | null {
  let best: { target: LinkTarget; from: number; to: number } | null = null;
  for (const block of syntax.blocks) {
    if (!(block.from <= offset && offset < block.to)) continue;
    for (const span of block.spans) {
      if (!(span.from <= offset && offset < span.to)) continue;
      let target: LinkTarget;
      if (span.kind.type === 'wikiLink' || span.kind.type === 'embed') target = { type: 'wiki', ref: span.kind.ref };
      else if (span.kind.type === 'link') target = { type: 'url', url: span.kind.url };
      else continue;
      if (best === null || span.to - span.from <= best.to - best.from) best = { target, from: span.from, to: span.to };
    }
  }
  return best;
}

/**
 * Whether a click at `offset` opens the link there: always with ⌘ (Ctrl elsewhere), and in Live
 * Preview when the link shows as a link, because the selection isn't in it (then a click is
 * the only way to follow it, and editing it starts with the arrow keys or a modifier-less selection).
 */
export function shouldOpenLink(offset: number, syntax: PageSyntax, selection: { from: number; to: number }, mode: EditorMode, commandKey: boolean): LinkTarget | null {
  const found = linkAt(offset, syntax);
  if (!found) return null;
  if (commandKey) return found.target;
  const touched = selection.from <= found.to && selection.to >= found.from;
  return mode === 'livePreview' && !touched ? found.target : null;
}
