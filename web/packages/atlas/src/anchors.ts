import { matchKey } from './tags';
import { childrenOf, plainText, sourceLines, standaloneIdLine, type MarkdownNode } from './tree';

/**
 * A heading as it's written after `#` in a wiki link (SPEC §7, "Writing heading links"): its
 * plain text without `[`, `]`, `|` and `^`, each run of whitespace as one space.
 */
export function headingLinkText(heading: string): string {
  return heading.replace(/[[\]|^]/g, '').split(/\s+/u).filter(Boolean).join(' ');
}

/** The key a heading link is matched by: `headingLinkText`, then NFC and case folding. */
export function headingKey(s: string): string {
  return matchKey(headingLinkText(s));
}

/**
 * The 1-based source line where a heading link or block reference points in a page (§7,
 * "Headings and block ids"): the first heading whose key matches, or the list item (its first
 * line) or line that carries `^id`. Null when the page has no such heading or id.
 */
export function anchorLine(root: MarkdownNode, target: { heading?: string | null; blockId?: string | null }): number | null {
  if (target.blockId) return blockIdLine(root, target.blockId);
  if (!target.heading) return null;
  const key = headingKey(target.heading);
  let found: number | null = null;
  const walk = (node: MarkdownNode): void => {
    if (found !== null) return;
    if (node.type === 'heading' && headingKey(plainText(node)) === key) { found = sourceLines.get(node)?.[0] ?? null; return; }
    childrenOf(node).forEach(walk);
  };
  walk(root);
  return found;
}

function blockIdLine(root: MarkdownNode, id: string): number | null {
  let found: number | null = null;
  const walk = (node: MarkdownNode, item: MarkdownNode | null): void => {
    if (found !== null) return;
    if ('blockId' in node && node.blockId === id) {
      const standalone = standaloneIdLine.get(node);
      if (standalone !== undefined) found = standalone;
      // An id on a list item's text names the item (§4.6).
      else if (item) found = sourceLines.get(item)?.[0] ?? null;
      // Otherwise the line the marker ends: a paragraph's last.
      else found = sourceLines.get(node)?.[1] ?? null;
      return;
    }
    for (const c of childrenOf(node)) walk(c, node.type === 'listItem' ? node : item);
  };
  walk(root, null);
  return found;
}
