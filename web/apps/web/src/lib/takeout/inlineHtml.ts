/**
 * Google Keep HTML → Neutrino note markdown.
 *
 * Keep exports every piece of text twice: `text` (plain) and `textHtml` (the
 * same text wrapped in Docs-style markup). The plain field is always safe but
 * drops bold/italic/strikethrough, so we read the HTML and re-emit the
 * formatting in the inline syntax the block editor understands — the five
 * forms in `INLINE_PATTERN` (blockEditorConstants.ts): `[[wiki]]`, `` `code` ``,
 * `**bold**`, `*italic*`, `~~strike~~`.
 *
 * Keep does not use `<b>`/`<i>` tags. It emits `<span>`s carrying an inline
 * `style` with `font-weight`, `font-style` and `text-decoration`, so those are
 * what actually drive the conversion; the semantic tags are handled too for
 * the older exports that used them.
 */

const BOLD_STYLE = /font-weight\s*:\s*(bold(er)?|[6-9]00)\b/i;
const ITALIC_STYLE = /font-style\s*:\s*italic\b/i;
const STRIKE_STYLE = /text-decoration[^:]*:[^;]*line-through/i;

const BOLD_TAGS = new Set(['B', 'STRONG']);
const ITALIC_TAGS = new Set(['I', 'EM']);
const STRIKE_TAGS = new Set(['S', 'STRIKE', 'DEL']);
const CODE_TAGS = new Set(['CODE', 'TT', 'KBD', 'SAMP']);
/** Elements that end the current line of text. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TR', 'TABLE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
]);

/**
 * Wrap `inner` in a markdown marker, leaving surrounding whitespace outside it.
 *
 * `** bold **` does not match `INLINE_PATTERN`, and `****` from an empty span
 * would render as literal asterisks, so both cases have to be avoided.
 */
function wrap(inner: string, marker: string): string {
  if (!inner.trim()) return inner;
  const leading = inner.slice(0, inner.length - inner.trimStart().length);
  const trailing = inner.slice(inner.trimEnd().length);
  return `${leading}${marker}${inner.trim()}${marker}${trailing}`;
}

function childrenToMarkdown(node: Node): string {
  let out = '';
  node.childNodes.forEach((child) => {
    out += nodeToMarkdown(child);
  });
  return out;
}

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === 3 /* Node.TEXT_NODE */) {
    // Keep's markup carries no meaningful whitespace of its own: it indents
    // the HTML source, so newlines and runs of spaces inside a text node are
    // formatting, not content.
    return (node.nodeValue ?? '').replace(/\s+/g, ' ');
  }
  if (node.nodeType !== 1 /* Node.ELEMENT_NODE */) return '';

  const el = node as Element;
  const tag = el.tagName.toUpperCase();

  if (tag === 'BR') return '\n';
  if (tag === 'SCRIPT' || tag === 'STYLE') return '';

  if (tag === 'A') {
    const href = el.getAttribute('href')?.trim() ?? '';
    const text = childrenToMarkdown(el).trim();
    if (!href) return text;
    // The block editor has no link syntax, so the URL goes in as plain text
    // rather than a `[text](url)` that would render with its punctuation.
    if (!text || text === href) return href;
    return `${text} (${href})`;
  }

  let inner = childrenToMarkdown(el);

  if (CODE_TAGS.has(tag)) {
    inner = wrap(inner, '`');
  } else {
    const style = el.getAttribute('style') ?? '';
    if (BOLD_TAGS.has(tag) || BOLD_STYLE.test(style)) inner = wrap(inner, '**');
    if (ITALIC_TAGS.has(tag) || ITALIC_STYLE.test(style)) inner = wrap(inner, '*');
    if (STRIKE_TAGS.has(tag) || STRIKE_STYLE.test(style)) inner = wrap(inner, '~~');
  }

  if (tag === 'LI') return `- ${inner.trim()}\n`;
  if (BLOCK_TAGS.has(tag)) return inner.endsWith('\n') ? inner : `${inner}\n`;
  return inner;
}

/**
 * Convert a fragment of Keep HTML into note markdown.
 *
 * Returns `''` for markup that holds no text, and never throws — a Keep export
 * that this cannot parse falls back to the plain-text field.
 */
export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return '';
  }
  return htmlToMarkdownFromBody(doc.body);
}

function htmlToMarkdownFromBody(body: HTMLElement | null): string {
  if (!body) return '';
  return childrenToMarkdown(body)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, '').replace(/^[ \t]+/, ''))
    .join('\n')
    // Keep wraps each line in its own <p>, so a genuine blank line arrives as
    // two consecutive block ends. More than one blank line is never meaningful.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Strip the inline markdown emitted above, for comparing against plain text. */
export function stripInlineMarkdown(markdown: string): string {
  return markdown
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The best markdown for a piece of Keep text: the HTML rendition when it is
 * faithful, otherwise the plain-text field.
 *
 * Keep's HTML is generated markup we do not control, so the conversion is
 * checked rather than trusted — strip the markers back out and the result must
 * be the same words as `text`. Anything else (a tag this doesn't handle, an
 * entity that decoded differently, an unbalanced fragment) means the HTML path
 * lost or invented content, and the plain field is used instead.
 *
 * When `text` is absent the HTML is all there is, so it is returned unchecked.
 */
export function keepTextToMarkdown(text: string | undefined, html: string | undefined): string {
  const plain = text ?? '';
  if (!html?.trim()) return plain;

  const markdown = htmlToMarkdown(html);
  if (!markdown) return plain;
  if (!plain.trim()) return markdown;

  return normalise(stripInlineMarkdown(markdown)) === normalise(plain) ? markdown : plain;
}
