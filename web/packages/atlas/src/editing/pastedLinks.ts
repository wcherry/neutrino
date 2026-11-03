import type { PageSyntax } from '../syntax/pageSyntax';
import { isInCode, isInVerbatimBlock, type TextEdit } from './markdownEditing';

// `<a … href="url" …>text</a>`, with the href quoted either way.
const ANCHOR = /<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>(.*?)<\/a\s*>/gis;

/**
 * What pasting a copied link inserts: `[Title](url)` when the clipboard holds a single http(s)
 * URL as text and, as HTML, nothing but one link to that URL with its title, the way a browser's
 * or Neutrino Notes' "Copy link" puts it there. Null otherwise, and the paste is plain text.
 * AtlasKit's `pastedLink`.
 */
export function pastedLink(plain: string, html: string | null | undefined): string | null {
  const url = plain.trim();
  if (!html || url === '' || /\s/u.test(url) || !/^https?:/i.test(url)) return null;
  try {
    new URL(url);
  } catch {
    return null;
  }
  const anchors = [...html.matchAll(ANCHOR)];
  if (anchors.length !== 1) return null;
  const anchor = anchors[0];
  if (decodeEntities(anchor[2]) !== url) return null;
  // Nothing to show besides the link: a copied paragraph that merely contains it is text.
  const outside = html.slice(0, anchor.index) + html.slice(anchor.index! + anchor[0].length);
  if (plainText(outside) !== '') return null;
  const title = plainText(anchor[3]);
  if (title === '' || title === url) return null;
  // Escaped so the title shows as written: not a nested link, emphasis or code.
  const label = [...title].map((c) => ('\\[]*`'.includes(c) ? '\\' + c : c)).join('');
  const destination = /[()<>]/.test(url) ? `<${url.replaceAll('>', '%3E')}>` : url;
  return `[${label}](${destination})`;
}

/** Pasting a copied link at `selection`: the edit, or null for an ordinary paste. Code, math and frontmatter take text as it is. */
export function pasteLink(plain: string, html: string | null | undefined, text: string, selection: { from: number; to: number }, syntax: PageSyntax): TextEdit | null {
  if (isInCode(selection.from, syntax) || isInVerbatimBlock(selection.from, syntax)) return null;
  const markdown = pastedLink(plain, html);
  if (markdown === null) return null;
  const end = selection.from + markdown.length;
  return { from: selection.from, to: selection.to, insert: markdown, selection: { from: end, to: end } };
}

/** HTML's visible text: tags, comments and `<style>` dropped, entities decoded, whitespace collapsed. */
function plainText(html: string): string {
  let s = html.replace(/<!--.*?-->|<style\b.*?<\/style\s*>/gis, '');
  s = s.replace(/<[^>]*>/g, '');
  return decodeEntities(s).split(/\s+/u).filter(Boolean).join(' ');
}

function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  let out = s;
  for (const [entity, char] of [['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&#39;', "'"], ['&apos;', "'"], ['&nbsp;', ' ']]) {
    out = out.replaceAll(entity, char);
  }
  // Numeric references, then `&amp;` last so `&amp;lt;` stays `&lt;`.
  out = out.replace(/&#(x[0-9a-fA-F]+|[0-9]+);/g, (whole, code: string) => {
    const value = code.startsWith('x') ? parseInt(code.slice(1), 16) : parseInt(code, 10);
    return value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : whole;
  });
  return out.replaceAll('&amp;', '&');
}
