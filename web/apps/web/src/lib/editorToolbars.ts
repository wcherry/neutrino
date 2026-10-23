'use client';

import { usePreference } from '@neutrino/preferences';

/**
 * The editors' toolbars as data (customization roadmap U10, layout-as-data §3.5): each editor's
 * toolbar is an ordered list of tool groups, and the user's `editor.toolbars` preference reorders
 * them, moves some into the "More tools" menu, and turns on a caption under each.
 *
 * The catalog lists every editor's tools whether or not that editor is loaded, so Settings can
 * show them; the editor supplies how each one draws (`ToolbarItems`). A tool id the stored layout
 * no longer knows is dropped, and a tool added since the layout was saved lands where the default
 * order puts it — never a hole, never a lost tool.
 */

export type EditorToolbarId = 'docs' | 'sheets' | 'slides' | 'diagrams' | 'drawing';

export interface ToolbarTool {
  id: string;
  /** What Settings and the Customize dialog call it. */
  label: string;
  /** The caption under it when labels are on. */
  caption: string;
  /** Where in a split toolbar it sits (Diagrams has tools either side of the title). */
  region?: 'start' | 'end';
}

export const EDITOR_TOOLBARS: Record<EditorToolbarId, { label: string; tools: ToolbarTool[] }> = {
  docs: {
    label: 'Docs',
    tools: [
      { id: 'history', label: 'Undo and redo', caption: 'History' },
      { id: 'styles', label: 'Paragraph styles palette', caption: 'Styles' },
      { id: 'paragraphStyle', label: 'Paragraph style', caption: 'Style' },
      { id: 'font', label: 'Font and size', caption: 'Font' },
      { id: 'marks', label: 'Bold, italic, underline and more', caption: 'Format' },
      { id: 'colors', label: 'Text and highlight colour', caption: 'Colour' },
      { id: 'case', label: 'Text case', caption: 'Case' },
      { id: 'spacing', label: 'Line and paragraph spacing', caption: 'Spacing' },
      { id: 'align', label: 'Alignment', caption: 'Align' },
      { id: 'lists', label: 'Lists, quote and code', caption: 'Lists' },
      { id: 'indent', label: 'Indent and outdent', caption: 'Indent' },
      { id: 'insert', label: 'Link, image, table and diagram', caption: 'Insert' },
      { id: 'table', label: 'Table tools (inside a table)', caption: 'Table' },
      { id: 'tools', label: 'Grammar, find and AI writing', caption: 'Tools' },
    ],
  },
  sheets: {
    label: 'Sheets',
    tools: [
      { id: 'history', label: 'Undo, redo and format painter', caption: 'History' },
      { id: 'font', label: 'Font and size', caption: 'Font' },
      { id: 'marks', label: 'Bold, italic and strikethrough', caption: 'Format' },
      { id: 'colors', label: 'Text and fill colour', caption: 'Colour' },
      { id: 'align', label: 'Horizontal alignment', caption: 'Align' },
      { id: 'valign', label: 'Vertical alignment', caption: 'Vertical' },
      { id: 'borders', label: 'Borders', caption: 'Borders' },
      { id: 'tableStyles', label: 'Table styles', caption: 'Table' },
      { id: 'wrap', label: 'Text wrapping', caption: 'Wrap' },
      { id: 'numberFormat', label: 'Number formats', caption: 'Number' },
      { id: 'merge', label: 'Merge cells', caption: 'Merge' },
      { id: 'decimals', label: 'Decimal places', caption: 'Decimals' },
      { id: 'chart', label: 'Insert chart', caption: 'Chart' },
      { id: 'find', label: 'Find and replace', caption: 'Find' },
      { id: 'conditional', label: 'Conditional formatting', caption: 'Rules' },
    ],
  },
  slides: {
    label: 'Slides',
    tools: [
      { id: 'lines', label: 'Lines and arrows', caption: 'Lines' },
      { id: 'video', label: 'Video options (a video selected)', caption: 'Video' },
      { id: 'textFont', label: 'Font and size (text selected)', caption: 'Font' },
      { id: 'textMarks', label: 'Bold, italic, underline (text selected)', caption: 'Format' },
      { id: 'textColors', label: 'Text colours (text selected)', caption: 'Colour' },
      { id: 'textShadow', label: 'Text shadow (text selected)', caption: 'Shadow' },
      { id: 'textAlign', label: 'Alignment (text selected)', caption: 'Align' },
      { id: 'textLists', label: 'Spacing and lists (text selected)', caption: 'Lists' },
      { id: 'textDelete', label: 'Delete (text selected)', caption: 'Delete' },
      { id: 'image', label: 'Image options (an image selected)', caption: 'Image' },
      { id: 'shape', label: 'Fill and outline (a shape selected)', caption: 'Shape' },
      { id: 'line', label: 'Line options (a line selected)', caption: 'Line' },
      { id: 'arrange', label: 'Layer order (anything selected)', caption: 'Arrange' },
      { id: 'animation', label: 'Animation (anything selected)', caption: 'Animate' },
      { id: 'background', label: 'Slide background', caption: 'Background' },
      { id: 'transition', label: 'Slide transition', caption: 'Transition' },
    ],
  },
  diagrams: {
    label: 'Diagrams',
    tools: [
      { id: 'modes', label: 'Select, pan, connect and text', caption: 'Tools', region: 'start' },
      { id: 'whiteboard', label: 'Pen, highlighter and eraser', caption: 'Draw', region: 'start' },
      { id: 'history', label: 'Undo and redo', caption: 'History', region: 'start' },
      { id: 'align', label: 'Align (several shapes selected)', caption: 'Align', region: 'end' },
      { id: 'arrange', label: 'Layer order (a shape selected)', caption: 'Arrange', region: 'end' },
      { id: 'layout', label: 'Auto layout', caption: 'Layout', region: 'end' },
      { id: 'panels', label: 'Data, developer, AI and comments panels', caption: 'Panels', region: 'end' },
      { id: 'present', label: 'Presentation mode', caption: 'Present', region: 'end' },
      { id: 'importExport', label: 'Import and export', caption: 'File', region: 'end' },
    ],
  },
  drawing: {
    label: 'Drawing',
    tools: [
      { id: 'select', label: 'Select, edit points and transform', caption: 'Select' },
      { id: 'shapes', label: 'Pen, lines, shapes and text', caption: 'Shapes' },
      { id: 'paint', label: 'Brushes and pixel eraser', caption: 'Paint' },
      { id: 'pixelSelect', label: 'Pixel selections', caption: 'Areas' },
      { id: 'insert', label: 'Insert image and delete objects', caption: 'Insert' },
    ],
  },
};

/** What one editor's entry in `editor.toolbars` holds. */
export interface StoredToolbar {
  order?: string[];
  hidden?: string[];
  labels?: boolean;
}

export interface ResolvedToolbar {
  /** Every tool id, in the user's order. */
  order: string[];
  hidden: Set<string>;
  labels: boolean;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** `stored` applied to `tools`: unknown ids dropped, new tools in their default place. */
export function resolveToolbar(tools: readonly ToolbarTool[], stored: StoredToolbar | null | undefined): ResolvedToolbar {
  const known = new Set(tools.map(t => t.id));
  const saved = strings(stored?.order).filter((id, i, all) => known.has(id) && all.indexOf(id) === i);
  const order = [...saved];
  // A tool missing from the saved order goes after the tool it follows by default.
  tools.forEach((tool, index) => {
    if (order.includes(tool.id)) return;
    const before = tools.slice(0, index).reverse().find(t => order.includes(t.id));
    order.splice(before ? order.indexOf(before.id) + 1 : 0, 0, tool.id);
  });
  return {
    order,
    hidden: new Set(strings(stored?.hidden).filter(id => known.has(id))),
    labels: stored?.labels === true,
  };
}

export interface ToolbarLayout extends ResolvedToolbar {
  setHidden(id: string, hidden: boolean): void;
  /** Moves `id` by `delta` places among the tools of its region. */
  move(id: string, delta: number): void;
  setLabels(labels: boolean): void;
  reset(): void;
  /** Whether anything differs from the default. */
  customized: boolean;
}

/** One editor's toolbar layout, read from and written to `editor.toolbars`. */
export function useToolbarLayout(editor: EditorToolbarId): ToolbarLayout {
  const [all, setAll] = usePreference('editor.toolbars');
  const tools = EDITOR_TOOLBARS[editor].tools;
  const stored = (all ?? {})[editor] as StoredToolbar | undefined;
  const resolved = resolveToolbar(tools, stored);

  const write = (next: StoredToolbar | null) => {
    const rest = { ...(all ?? {}) };
    if (next) rest[editor] = next;
    else delete rest[editor];
    setAll(Object.keys(rest).length > 0 ? rest : null);
  };
  const current = (): StoredToolbar => ({ order: resolved.order, hidden: [...resolved.hidden], labels: resolved.labels });

  return {
    ...resolved,
    customized: !!stored,
    setHidden: (id, hidden) => {
      const set = new Set(resolved.hidden);
      if (hidden) set.add(id);
      else set.delete(id);
      write({ ...current(), hidden: [...set] });
    },
    move: (id, delta) => {
      const region = tools.find(t => t.id === id)?.region;
      const peers = resolved.order.filter(other => tools.find(t => t.id === other)?.region === region);
      const at = peers.indexOf(id);
      const target = peers[at + delta];
      if (at < 0 || target === undefined) return;
      const order = [...resolved.order];
      const i = order.indexOf(id);
      const j = order.indexOf(target);
      [order[i], order[j]] = [order[j], order[i]];
      write({ ...current(), order });
    },
    setLabels: labels => write({ ...current(), labels }),
    reset: () => write(null),
  };
}
