import type { MarkdownShortcut, SlashCommand, TablePreset, TableStyle } from './blockEditorTypes';

// Matches (in priority order): wiki links, inline code, bold, italic, strikethrough
export const INLINE_PATTERN =
  /(\[\[[^\]]+\]\])|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(?<![a-zA-Z0-9])(~~[^~\n]+~~)/g;

/** A line that is nothing but `---`, `***` or `___` renders as a horizontal rule. */
export const DIVIDER_PATTERN = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

/** The inline markers the shortcuts below wrap a selection in. */
export const BOLD_MARKER = '**';
export const ITALIC_MARKER = '*';
export const CODE_MARKER = '`';
export const STRIKE_MARKER = '~~';

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'paragraph', type: 'paragraph', label: 'Paragraph', description: 'Plain text', keywords: ['body'] },
  { id: 'heading1', type: 'paragraph', content: '# ', label: 'Heading 1', description: 'Large section heading', keywords: ['h1', 'title', '#'] },
  { id: 'heading2', type: 'paragraph', content: '## ', label: 'Heading 2', description: 'Medium section heading', keywords: ['h2', '##'] },
  { id: 'heading3', type: 'paragraph', content: '### ', label: 'Heading 3', description: 'Small section heading', keywords: ['h3', '###'] },
  { id: 'bullet', type: 'bullet', label: 'Bullet list', description: 'Unordered list item', keywords: ['ul', 'unordered', '-'] },
  { id: 'numbered', type: 'numbered', label: 'Numbered list', description: 'Ordered list item', keywords: ['ol', 'ordered', '1.'] },
  { id: 'task', type: 'task', label: 'Task', description: 'Checkbox to-do item', keywords: ['todo', 'checkbox', '[]'] },
  { id: 'blockquote', type: 'blockquote', label: 'Quote', description: 'Block quotation', keywords: ['quote', '>'] },
  { id: 'code', type: 'code', label: 'Code block', description: 'Monospace code', keywords: ['pre', '```'] },
  { id: 'divider', type: 'paragraph', content: '---', label: 'Divider', description: 'Horizontal rule', keywords: ['hr', 'rule', 'separator', '---'] },
  { id: 'table', type: 'table', label: 'Table', description: 'Resizable table', keywords: ['grid'] },
];

/**
 * Ctrl/Cmd shortcuts that add markdown without typing its syntax. Ordered as
 * the help modal lists them, which is also the order they are matched in.
 *
 * The letters are the ones every editor uses (B, I, K); the rest are grouped
 * so they are learnable rather than individually familiar — Alt for the ones
 * that set a block's own shape (headings, code, quote, back to plain), Shift
 * for the list kinds, on the digits that carry their punctuation (`&` 7 for
 * numbered, `*` 8 for a bullet).
 *
 * Ctrl+Shift+Q is deliberately not among them: it quits the browser on Linux,
 * and that is not something a page can take back with `preventDefault`.
 */
export const MARKDOWN_SHORTCUTS: MarkdownShortcut[] = [
  { label: 'Bold',           keys: ['Ctrl', 'B'],          key: 'b', code: 'KeyB',   action: { kind: 'inline', marker: BOLD_MARKER } },
  { label: 'Italic',         keys: ['Ctrl', 'I'],          key: 'i', code: 'KeyI',   action: { kind: 'inline', marker: ITALIC_MARKER } },
  { label: 'Inline code',    keys: ['Ctrl', 'E'],          key: 'e', code: 'KeyE',   action: { kind: 'inline', marker: CODE_MARKER } },
  { label: 'Strikethrough',  keys: ['Ctrl', 'Shift', 'X'], key: 'x', code: 'KeyX',   shift: true, action: { kind: 'inline', marker: STRIKE_MARKER } },
  { label: 'Link to a note', keys: ['Ctrl', 'K'],          key: 'k', code: 'KeyK',   action: { kind: 'wikiLink' } },
  { label: 'Heading 1',      keys: ['Ctrl', 'Alt', '1'],   key: '1', code: 'Digit1', alt: true, action: { kind: 'heading', level: 1 } },
  { label: 'Heading 2',      keys: ['Ctrl', 'Alt', '2'],   key: '2', code: 'Digit2', alt: true, action: { kind: 'heading', level: 2 } },
  { label: 'Heading 3',      keys: ['Ctrl', 'Alt', '3'],   key: '3', code: 'Digit3', alt: true, action: { kind: 'heading', level: 3 } },
  { label: 'Plain text',     keys: ['Ctrl', 'Alt', '0'],   key: '0', code: 'Digit0', alt: true, action: { kind: 'heading', level: 0 } },
  { label: 'Code block',     keys: ['Ctrl', 'Alt', 'C'],   key: 'c', code: 'KeyC',   alt: true, action: { kind: 'block', type: 'code' } },
  { label: 'Quote',          keys: ['Ctrl', 'Alt', 'Q'],   key: 'q', code: 'KeyQ',   alt: true, action: { kind: 'block', type: 'blockquote' } },
  { label: 'Numbered list',  keys: ['Ctrl', 'Shift', '7'], key: '7', code: 'Digit7', shift: true, action: { kind: 'block', type: 'numbered' } },
  { label: 'Bullet list',    keys: ['Ctrl', 'Shift', '8'], key: '8', code: 'Digit8', shift: true, action: { kind: 'block', type: 'bullet' } },
  { label: 'Task',           keys: ['Ctrl', 'Shift', '9'], key: '9', code: 'Digit9', shift: true, action: { kind: 'block', type: 'task' } },
];

export const TABLE_PRESETS: TablePreset[] = [
  { id: 'blue-light',    name: 'Blue Light',    headerBg: '#bfdbfe', headerColor: '#1e3a5f', bandBg: '#eff6ff', summaryBg: '#bfdbfe', summaryColor: '#1e3a5f' },
  { id: 'blue-dark',     name: 'Blue Dark',     headerBg: '#1d4ed8', headerColor: '#ffffff', bandBg: '#dbeafe', summaryBg: '#1e40af', summaryColor: '#ffffff' },
  { id: 'teal-light',    name: 'Teal Light',    headerBg: '#99f6e4', headerColor: '#134e4a', bandBg: '#f0fdfa', summaryBg: '#99f6e4', summaryColor: '#134e4a' },
  { id: 'teal-dark',     name: 'Teal Dark',     headerBg: '#0f766e', headerColor: '#ffffff', bandBg: '#ccfbf1', summaryBg: '#065f5a', summaryColor: '#ffffff' },
  { id: 'green-light',   name: 'Green Light',   headerBg: '#bbf7d0', headerColor: '#14532d', bandBg: '#f0fdf4', summaryBg: '#bbf7d0', summaryColor: '#14532d' },
  { id: 'green-dark',    name: 'Green Dark',    headerBg: '#16a34a', headerColor: '#ffffff', bandBg: '#dcfce7', summaryBg: '#15803d', summaryColor: '#ffffff' },
  { id: 'orange-light',  name: 'Orange Light',  headerBg: '#fed7aa', headerColor: '#7c2d12', bandBg: '#fff7ed', summaryBg: '#fed7aa', summaryColor: '#7c2d12' },
  { id: 'orange-dark',   name: 'Orange Dark',   headerBg: '#ea580c', headerColor: '#ffffff', bandBg: '#ffedd5', summaryBg: '#c2410c', summaryColor: '#ffffff' },
  { id: 'red-light',     name: 'Red Light',     headerBg: '#fecaca', headerColor: '#7f1d1d', bandBg: '#fef2f2', summaryBg: '#fecaca', summaryColor: '#7f1d1d' },
  { id: 'red-dark',      name: 'Red Dark',      headerBg: '#dc2626', headerColor: '#ffffff', bandBg: '#fee2e2', summaryBg: '#b91c1c', summaryColor: '#ffffff' },
  { id: 'purple-light',  name: 'Purple Light',  headerBg: '#ddd6fe', headerColor: '#3b0764', bandBg: '#f5f3ff', summaryBg: '#ddd6fe', summaryColor: '#3b0764' },
  { id: 'purple-dark',   name: 'Purple Dark',   headerBg: '#7c3aed', headerColor: '#ffffff', bandBg: '#ede9fe', summaryBg: '#6d28d9', summaryColor: '#ffffff' },
  { id: 'gray-light',    name: 'Gray Light',    headerBg: '#e2e8f0', headerColor: '#1e293b', bandBg: '#f8fafc', summaryBg: '#e2e8f0', summaryColor: '#1e293b' },
  { id: 'gray-dark',     name: 'Gray Dark',     headerBg: '#334155', headerColor: '#ffffff', bandBg: '#f1f5f9', summaryBg: '#1e293b', summaryColor: '#ffffff' },
];

export const TABLE_STRUCTURE_OPTIONS: Array<{ key: keyof TableStyle; label: string }> = [
  { key: 'headerRow',    label: 'Header Row' },
  { key: 'headerColumn', label: 'Header Col' },
  { key: 'bandedRows',   label: 'Banded Rows' },
  { key: 'summaryRow',   label: 'Summary Row' },
  { key: 'summaryColumn', label: 'Summary Col' },
];
