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

export interface TableBlockProps {
  block: Block;
  onTableChange: (patch: Partial<Block>) => void;
  onDeleteTable: () => void;
  allNotes: import('@/lib/api').NoteMetaResponse[];
  onLinkClick: (id: string) => void;
}

export interface BlockRowProps {
  block: Block;
  blockIndex: number;
  allBlocks: Block[];
  isFirst: boolean;
  focusRequest: FocusRequest | null;
  onFocusHandled: () => void;
  onContentChange: (id: string, content: string) => void;
  onTypeChange: (id: string, type: BlockType) => void;
  onBlockPatch: (id: string, patch: Partial<Block>) => void;
  onToggleCheck: (id: string) => void;
  onSplitBlock: (id: string, before: string, after: string) => void;
  onDeleteBlock: (id: string) => void;
  allNotes: import('@/lib/api').NoteMetaResponse[];
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
  allNotes: import('@/lib/api').NoteMetaResponse[];
  currentNoteId: string;
  onLinkClick: (noteId: string) => void;
}
