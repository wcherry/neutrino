/**
 * The Atlas Markdown tree (SPEC §3–§4): mdast nodes plus the Atlas extensions, as plain
 * objects shaped exactly like the corpus's `ast.json` files. Optional fields are always
 * present, `null` when absent (§3.1), so a parsed tree compares equal to the corpus as is.
 */

export type CalloutFold = '+' | '-';
export type Align = 'left' | 'right' | 'center' | null;

export interface WikiLinkReference {
  target: string;
  heading: string | null;
  blockId: string | null;
  alias: string | null;
}

export type MarkdownNode =
  | { type: 'root'; children: MarkdownNode[] }
  | { type: 'paragraph'; blockId: string | null; children: MarkdownNode[] }
  | { type: 'heading'; depth: number; children: MarkdownNode[] }
  | { type: 'thematicBreak' }
  | { type: 'blockquote'; blockId: string | null; children: MarkdownNode[] }
  | { type: 'list'; ordered: boolean; start: number | null; spread: boolean; blockId: string | null; children: MarkdownNode[] }
  | { type: 'listItem'; checked: boolean | null; spread: boolean; children: MarkdownNode[] }
  | { type: 'code'; lang: string | null; meta: string | null; value: string; blockId: string | null }
  | { type: 'html'; value: string }
  | { type: 'table'; align: Align[]; blockId: string | null; children: MarkdownNode[] }
  | { type: 'tableRow'; children: MarkdownNode[] }
  | { type: 'tableCell'; children: MarkdownNode[] }
  | { type: 'footnoteDefinition'; identifier: string; label: string | null; children: MarkdownNode[] }
  | { type: 'yaml'; value: string }
  | { type: 'callout'; calloutType: string; fold: CalloutFold | null; title: MarkdownNode[] | null; blockId: string | null; children: MarkdownNode[] }
  | { type: 'math'; meta: null; value: string; blockId: string | null }
  | { type: 'text'; value: string }
  | { type: 'emphasis'; children: MarkdownNode[] }
  | { type: 'strong'; children: MarkdownNode[] }
  | { type: 'delete'; children: MarkdownNode[] }
  | { type: 'highlight'; children: MarkdownNode[] }
  | { type: 'inlineCode'; value: string }
  | { type: 'inlineMath'; value: string }
  | { type: 'break' }
  | { type: 'link'; url: string; title: string | null; children: MarkdownNode[] }
  | { type: 'image'; url: string; title: string | null; alt: string }
  | { type: 'footnoteReference'; identifier: string; label: string | null }
  | ({ type: 'wikiLink' } & WikiLinkReference)
  | ({ type: 'embed' } & WikiLinkReference)
  | { type: 'tag'; name: string };

export type NodeOf<T extends MarkdownNode['type']> = Extract<MarkdownNode, { type: T }>;

/** A node's block or inline children; none for leaves. */
export function childrenOf(node: MarkdownNode): MarkdownNode[] {
  return 'children' in node ? node.children : [];
}

/** The same node with different children. Leaves come back unchanged. */
export function withChildren<N extends MarkdownNode>(node: N, children: MarkdownNode[]): N {
  return 'children' in node ? { ...node, children } : node;
}

/** Plain text, untrimmed, as flanking and tag boundaries read it (§4.4, §4.5). */
export function flankingText(node: MarkdownNode): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
    case 'inlineMath':
      return node.value;
    case 'wikiLink':
    case 'embed':
      return node.alias ?? node.target;
    case 'tag':
      return '#' + node.name;
    case 'image':
      return node.alt;
    case 'break':
      return ' ';
    default:
      return childrenOf(node).map(flankingText).join('');
  }
}

/** Plain text of a node (SPEC §6): `flankingText`, trimmed. */
export function plainText(node: MarkdownNode): string {
  return flankingText(node).trim();
}

/** Blocks a standalone `^id` can name (§4.6). */
export function acceptsStandaloneBlockId(node: MarkdownNode): boolean {
  return ['table', 'code', 'blockquote', 'callout', 'list', 'math'].includes(node.type);
}

/** Containers whose children are blocks, where a standalone block id may appear. */
export function isBlockContainer(node: MarkdownNode): boolean {
  return ['root', 'blockquote', 'listItem', 'footnoteDefinition', 'callout'].includes(node.type);
}

export function withBlockId<N extends MarkdownNode>(node: N, blockId: string): N {
  return 'blockId' in node ? { ...node, blockId } : node;
}

/**
 * The 1-based source lines each block came from, first and last. Not part of the tree (§3.1):
 * a side table the parser fills and its passes carry onto the nodes they rebuild, for anchors.
 */
export const sourceLines = new WeakMap<object, [number, number]>();
/** For a block named by a standalone `^id` paragraph (§4.6): the line that paragraph was on. */
export const standaloneIdLine = new WeakMap<object, number>();

/** `to`, carrying `from`'s source lines. */
export function carry<N extends object>(from: object, to: N): N {
  const lines = sourceLines.get(from);
  if (lines && from !== to) sourceLines.set(to, lines);
  const id = standaloneIdLine.get(from);
  if (id !== undefined && from !== to) standaloneIdLine.set(to, id);
  return to;
}
