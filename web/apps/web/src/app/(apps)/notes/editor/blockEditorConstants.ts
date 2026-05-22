import type { BlockType, TablePreset, TableStyle } from './blockEditorTypes';

// Matches (in priority order): wiki links, inline code, bold, italic, strikethrough
export const INLINE_PATTERN =
  /(\[\[[^\]]+\]\])|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(?<![a-zA-Z0-9])(~~[^~\n]+~~)/g;

export const SLASH_COMMANDS: Array<{ type: BlockType; label: string; description: string }> = [
  { type: 'paragraph', label: 'Paragraph', description: 'Plain text' },
  { type: 'bullet', label: 'Bullet list', description: 'Unordered list item' },
  { type: 'numbered', label: 'Numbered list', description: 'Ordered list item' },
  { type: 'task', label: 'Task', description: 'Checkbox to-do item' },
  { type: 'blockquote', label: 'Quote', description: 'Block quotation' },
  { type: 'code', label: 'Code block', description: 'Monospace code' },
  { type: 'table', label: 'Table', description: 'Resizable table' },
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
