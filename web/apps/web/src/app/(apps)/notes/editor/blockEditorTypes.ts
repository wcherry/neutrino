export type BlockType = 'paragraph' | 'bullet' | 'numbered' | 'code' | 'task' | 'blockquote' | 'table';

export interface TableCell {
  id: string;
  content: string;
}

export interface TableRow {
  id: string;
  height?: number;
  cells: TableCell[];
}

export interface TableColumn {
  id: string;
  width: number;
}

export interface TableStyle {
  preset?: string;
  headerRow?: boolean;
  headerColumn?: boolean;
  summaryRow?: boolean;
  summaryColumn?: boolean;
  bandedRows?: boolean;
}

export interface TableData {
  columns: TableColumn[];
  rows: TableRow[];
  style?: TableStyle;
}

export interface Block {
  id: string;
  type: BlockType;
  content: string;
  checked?: boolean;
  tableData?: TableData;
}

export interface TablePreset {
  id: string;
  name: string;
  headerBg: string;
  headerColor: string;
  bandBg: string;
  summaryBg: string;
  summaryColor: string;
}

export interface FocusRequest {
  id: string;
  position: 'start' | 'end' | number;
}

/** One entry in the `/` menu. See `SLASH_COMMANDS`. */
export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  type: BlockType;
  /**
   * What the block's content becomes — a heading's `## `, a divider's `---`.
   * Markdown the editor renders from the content itself has no block type of
   * its own, so the command seeds the syntax and the caret lands after it.
   * Omitted for commands that only change the type.
   */
  content?: string;
  /** Extra lower-case terms the menu filters on, so `h1` finds Heading 1. */
  keywords?: string[];
}

/** What a markdown keyboard shortcut does to the block it fires in. */
export type MarkdownAction =
  /** Wrap (or unwrap) the selection in an inline marker — `**`, `` ` ``, … */
  | { kind: 'inline'; marker: string }
  /** Set the block's heading level; 0 strips the heading. */
  | { kind: 'heading'; level: number }
  /** Switch the block's type, or back to a paragraph if it is that type already. */
  | { kind: 'block'; type: BlockType }
  /** Wrap the selection in `[[…]]` and open the note autocomplete. */
  | { kind: 'wikiLink' };

/**
 * A Ctrl/Cmd shortcut for adding markdown. `key` and `code` are both matched
 * (either one hitting is enough): `code` is what survives Alt on macOS and
 * Shift on the digit row, where `e.key` is `¡` or `&` rather than `1` or `7`;
 * `key` is what survives a non-QWERTY layout, where `code` is a position.
 */
export interface MarkdownShortcut {
  /** Action name for the help modal. */
  label: string;
  /** Key names shown in the help modal, in order. */
  keys: string[];
  /** Lower-case `KeyboardEvent.key`. */
  key: string;
  /** `KeyboardEvent.code`. */
  code: string;
  shift?: boolean;
  alt?: boolean;
  action: MarkdownAction;
}

export interface TableBlockProps {
  block: Block;
  onTableChange: (patch: Partial<Block>) => void;
  onDeleteTable: () => void;
  allNotes: import('./blockEditorHelpers').NoteLinkTarget[];
  onLinkClick: (id: string) => void;
}

export interface BlockRowProps {
  block: Block;
  blockIndex: number;
  allBlocks: Block[];
  isFirst: boolean;
  focusRequest: FocusRequest | null;
  onFocusHandled: () => void;
  /** Bumped whenever the parent needs every block back in (non-editable) view
   * mode right now — e.g. before building a native selection that spans the
   * whole note, which can't include a block still rendered as a <textarea>. */
  exitEditSignal: number;
  onContentChange: (id: string, content: string) => void;
  onTypeChange: (id: string, type: BlockType) => void;
  onBlockPatch: (id: string, patch: Partial<Block>) => void;
  onToggleCheck: (id: string) => void;
  onSplitBlock: (id: string, before: string, after: string) => void;
  onDeleteBlock: (id: string) => void;
  onMoveFocus: (id: string, direction: 'up' | 'down', column: number) => void;
  allNotes: import('./blockEditorHelpers').NoteLinkTarget[];
  currentNoteId: string;
  onLinkClick: (noteId: string) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDrop: () => void;
  isDragOver: boolean;
}

export interface BlockEditorProps {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  allNotes: import('./blockEditorHelpers').NoteLinkTarget[];
  currentNoteId: string;
  onLinkClick: (noteId: string) => void;
}
