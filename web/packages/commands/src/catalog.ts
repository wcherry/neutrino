/**
 * Every keyboard command in the app, whether or not the screen that runs it is loaded.
 *
 * This list is what Settings › Keyboard shows and what a user's bindings are checked against; a
 * screen supplies the behaviour with `useCommand(id, run)` while it is mounted. Keeping the list
 * here rather than beside each handler means Settings (and later the command palette) can name
 * every shortcut without importing any editor. A test fails when code registers an id that is
 * not listed here.
 *
 * `whileTyping: 'run'` lets a command fire while focus is in a text field or a contenteditable
 * (the editors' own text is one). A binding without Ctrl, ⌘ or ⌥ never fires there, whatever
 * this says, so remapping a command to a bare letter cannot eat keystrokes.
 *
 * `yields: true` marks a global command that gives a key up to an app's own command for it, should
 * the user bind one to the same chord: the dispatcher runs the most recently mounted handler first,
 * which is the app's, and `yields` is what tells conflict detection that this is intended. By
 * default nothing shares the palette's ⌘K — it opens the palette everywhere, the editors included,
 * so Docs' "insert link" is ⌘⇧K rather than the ⌘K of Google Docs and Word.
 *
 * `palette: false` keeps a command out of the command palette: the palette runs a command by
 * calling its handler, and these only make sense as a key press (clipboard events, presenting).
 */

export type CommandApp =
  | 'global' | 'editors' | 'drive' | 'docs' | 'sheets' | 'slides' | 'notes' | 'photos'
  | 'drawing' | 'diagrams';

export const COMMAND_APPS: { id: CommandApp; label: string }[] = [
  { id: 'global', label: 'Everywhere' },
  { id: 'editors', label: 'All editors' },
  { id: 'drive', label: 'Drive' },
  { id: 'docs', label: 'Docs' },
  { id: 'sheets', label: 'Sheets' },
  { id: 'slides', label: 'Slides' },
  { id: 'notes', label: 'Notes' },
  { id: 'photos', label: 'Photos' },
  { id: 'drawing', label: 'Drawing' },
  { id: 'diagrams', label: 'Diagrams' },
];

export interface CommandSpec {
  id: string;
  title: string;
  app: CommandApp;
  defaultKeys: readonly string[];
  whileTyping?: 'run' | 'skip';
  yields?: boolean;
  palette?: boolean;
}

const UNDO = ['Mod+Z'];
const REDO = ['Mod+Shift+Z', 'Mod+Y'];
const DELETE = ['Delete', 'Backspace'];

export const COMMANDS = [
  // ── Everywhere ────────────────────────────────────────────────────────────
  { id: 'shell.commandPalette', title: 'Search and run a command', app: 'global', defaultKeys: ['Mod+K', 'Mod+/'], whileTyping: 'run', yields: true, palette: false },
  { id: 'shell.toggleSidebar', title: 'Collapse or expand the sidebar', app: 'global', defaultKeys: [] },
  { id: 'shell.goto.drive', title: 'Go to My Drive', app: 'global', defaultKeys: [] },
  { id: 'shell.goto.recent', title: 'Go to Recent', app: 'global', defaultKeys: [] },
  { id: 'shell.goto.shared', title: 'Go to Shared with me', app: 'global', defaultKeys: [] },
  { id: 'shell.goto.docs', title: 'Go to Docs', app: 'global', defaultKeys: [] },
  { id: 'shell.goto.sheets', title: 'Go to Sheets', app: 'global', defaultKeys: [] },
  { id: 'shell.goto.slides', title: 'Go to Slides', app: 'global', defaultKeys: [] },
  { id: 'shell.goto.notes', title: 'Go to Notes', app: 'global', defaultKeys: [] },
  { id: 'shell.goto.diagrams', title: 'Go to Diagrams', app: 'global', defaultKeys: [] },
  { id: 'shell.goto.drawing', title: 'Go to Drawings', app: 'global', defaultKeys: [] },
  { id: 'shell.goto.photos', title: 'Go to Photos', app: 'global', defaultKeys: [] },
  { id: 'shell.goto.calendar', title: 'Go to Calendar', app: 'global', defaultKeys: [] },
  { id: 'shell.goto.settings', title: 'Open Settings', app: 'global', defaultKeys: [] },
  { id: 'shell.goto.keyboard', title: 'Open keyboard shortcuts', app: 'global', defaultKeys: [] },

  // ── All editors ───────────────────────────────────────────────────────────
  { id: 'editors.spellCheck.toggle', title: 'Turn spell check on or off', app: 'editors', defaultKeys: ['Mod+Shift+;'], whileTyping: 'run' },

  // ── Docs ──────────────────────────────────────────────────────────────────
  { id: 'docs.save', title: 'Save a version', app: 'docs', defaultKeys: ['Mod+S'], whileTyping: 'run' },
  { id: 'docs.find', title: 'Find and replace', app: 'docs', defaultKeys: ['Mod+F'], whileTyping: 'run' },
  { id: 'docs.focusMode', title: 'Distraction-free writing', app: 'docs', defaultKeys: ['Mod+Shift+F'], whileTyping: 'run' },
  { id: 'docs.insertLink', title: 'Insert or edit link', app: 'docs', defaultKeys: ['Mod+Shift+K'], whileTyping: 'run' },
  { id: 'docs.clearFormatting', title: 'Clear formatting', app: 'docs', defaultKeys: ['Mod+\\'], whileTyping: 'run' },

  // ── Sheets ────────────────────────────────────────────────────────────────
  { id: 'sheets.save', title: 'Save', app: 'sheets', defaultKeys: ['Mod+S'], whileTyping: 'run' },
  { id: 'sheets.find', title: 'Find', app: 'sheets', defaultKeys: ['Mod+F'], whileTyping: 'run' },
  { id: 'sheets.replace', title: 'Find and replace', app: 'sheets', defaultKeys: ['Mod+H'], whileTyping: 'run' },
  { id: 'sheets.bold', title: 'Bold', app: 'sheets', defaultKeys: ['Mod+B'], whileTyping: 'run' },
  { id: 'sheets.italic', title: 'Italic', app: 'sheets', defaultKeys: ['Mod+I'], whileTyping: 'run' },
  { id: 'sheets.undo', title: 'Undo', app: 'sheets', defaultKeys: UNDO },
  { id: 'sheets.redo', title: 'Redo', app: 'sheets', defaultKeys: REDO },
  { id: 'sheets.selectAll', title: 'Select all cells', app: 'sheets', defaultKeys: ['Mod+A'] },
  { id: 'sheets.copy', title: 'Copy cells', app: 'sheets', defaultKeys: ['Mod+C'], whileTyping: 'run', palette: false },
  { id: 'sheets.cut', title: 'Cut cells', app: 'sheets', defaultKeys: ['Mod+X'], whileTyping: 'run', palette: false },
  { id: 'sheets.paste', title: 'Paste cells', app: 'sheets', defaultKeys: ['Mod+V'], whileTyping: 'run', palette: false },
  { id: 'sheets.chart.delete', title: 'Delete the selected chart', app: 'sheets', defaultKeys: DELETE },

  // ── Slides ────────────────────────────────────────────────────────────────
  { id: 'slides.save', title: 'Save', app: 'slides', defaultKeys: ['Mod+S'], whileTyping: 'run' },
  { id: 'slides.element.delete', title: 'Delete the selected element', app: 'slides', defaultKeys: DELETE },
  { id: 'slides.present.next', title: 'Next slide (presenting)', app: 'slides', defaultKeys: ['ArrowRight', 'ArrowDown', 'Space'], palette: false },
  { id: 'slides.present.previous', title: 'Previous slide (presenting)', app: 'slides', defaultKeys: ['ArrowLeft', 'ArrowUp'], palette: false },

  // ── Notes ─────────────────────────────────────────────────────────────────
  { id: 'notes.save', title: 'Save', app: 'notes', defaultKeys: ['Mod+S'], whileTyping: 'run' },
  { id: 'notes.print', title: 'Print', app: 'notes', defaultKeys: ['Mod+P'], whileTyping: 'run' },
  { id: 'notes.selectAll', title: 'Select all blocks', app: 'notes', defaultKeys: ['Mod+A'], whileTyping: 'run' },

  // ── Photos ────────────────────────────────────────────────────────────────
  { id: 'photos.deleteSelected', title: 'Delete the selected markup', app: 'photos', defaultKeys: DELETE },

  // ── Drawing ───────────────────────────────────────────────────────────────
  { id: 'drawing.tool.select', title: 'Select tool', app: 'drawing', defaultKeys: ['S'] },
  { id: 'drawing.tool.node', title: 'Node tool', app: 'drawing', defaultKeys: ['A'] },
  { id: 'drawing.tool.transform', title: 'Transform tool', app: 'drawing', defaultKeys: ['V'] },
  { id: 'drawing.tool.pen', title: 'Pen tool', app: 'drawing', defaultKeys: ['P'] },
  { id: 'drawing.tool.line', title: 'Line tool', app: 'drawing', defaultKeys: ['L'] },
  { id: 'drawing.tool.rectangle', title: 'Rectangle tool', app: 'drawing', defaultKeys: ['R'] },
  { id: 'drawing.tool.ellipse', title: 'Ellipse tool', app: 'drawing', defaultKeys: ['E'] },
  { id: 'drawing.tool.text', title: 'Text tool', app: 'drawing', defaultKeys: ['T'] },
  { id: 'drawing.tool.brush', title: 'Brush', app: 'drawing', defaultKeys: ['B'] },
  { id: 'drawing.tool.pencil', title: 'Pencil', app: 'drawing', defaultKeys: ['N'] },
  { id: 'drawing.tool.eraser', title: 'Eraser', app: 'drawing', defaultKeys: ['X'] },
  { id: 'drawing.tool.selectRect', title: 'Rectangular marquee', app: 'drawing', defaultKeys: ['M'] },
  { id: 'drawing.tool.lasso', title: 'Lasso', app: 'drawing', defaultKeys: ['Q'] },
  { id: 'drawing.delete', title: 'Delete selection', app: 'drawing', defaultKeys: DELETE },
  { id: 'drawing.undo', title: 'Undo', app: 'drawing', defaultKeys: UNDO },
  { id: 'drawing.redo', title: 'Redo', app: 'drawing', defaultKeys: REDO },
  { id: 'drawing.selectAll', title: 'Select all', app: 'drawing', defaultKeys: ['Mod+A'] },
  { id: 'drawing.copy', title: 'Copy', app: 'drawing', defaultKeys: ['Mod+C'], palette: false },
  { id: 'drawing.cut', title: 'Cut', app: 'drawing', defaultKeys: ['Mod+X'], palette: false },
  { id: 'drawing.paste', title: 'Paste', app: 'drawing', defaultKeys: ['Mod+V'], palette: false },
  { id: 'drawing.duplicate', title: 'Duplicate', app: 'drawing', defaultKeys: ['Mod+D'] },
  { id: 'drawing.invertSelection', title: 'Invert pixel selection', app: 'drawing', defaultKeys: ['Mod+Shift+I'] },
  { id: 'drawing.deselectPixels', title: 'Deselect pixels', app: 'drawing', defaultKeys: ['Mod+Shift+D'] },
  { id: 'drawing.group', title: 'Group', app: 'drawing', defaultKeys: ['Mod+G'] },
  { id: 'drawing.ungroup', title: 'Ungroup', app: 'drawing', defaultKeys: ['Mod+Shift+G'] },
  { id: 'drawing.bringForward', title: 'Bring forward', app: 'drawing', defaultKeys: ['Mod+]'] },
  { id: 'drawing.sendBackward', title: 'Send backward', app: 'drawing', defaultKeys: ['Mod+['] },
  { id: 'drawing.toggleGrid', title: 'Show or hide the grid', app: 'drawing', defaultKeys: ["Mod+'"] },
  { id: 'drawing.toggleRulers', title: 'Show or hide rulers', app: 'drawing', defaultKeys: ['Mod+R'] },
  { id: 'drawing.toggleGuides', title: 'Show or hide guides', app: 'drawing', defaultKeys: ['Mod+;'] },

  // ── Diagrams ──────────────────────────────────────────────────────────────
  { id: 'diagrams.undo', title: 'Undo', app: 'diagrams', defaultKeys: UNDO },
  { id: 'diagrams.redo', title: 'Redo', app: 'diagrams', defaultKeys: REDO },
  { id: 'diagrams.delete', title: 'Delete selection', app: 'diagrams', defaultKeys: DELETE },
  { id: 'diagrams.duplicate', title: 'Duplicate', app: 'diagrams', defaultKeys: ['Mod+D'] },
  { id: 'diagrams.selectAll', title: 'Select all', app: 'diagrams', defaultKeys: ['Mod+A'] },
  { id: 'diagrams.tool.select', title: 'Select tool', app: 'diagrams', defaultKeys: ['V'] },
  { id: 'diagrams.tool.pan', title: 'Pan tool', app: 'diagrams', defaultKeys: ['H'] },
  { id: 'diagrams.tool.text', title: 'Text tool', app: 'diagrams', defaultKeys: ['T'] },
] as const satisfies readonly CommandSpec[];

export type CommandId = (typeof COMMANDS)[number]['id'];

const BY_ID = new Map<string, CommandSpec>(COMMANDS.map((c) => [c.id, c]));

export function commandSpec(id: string): CommandSpec | undefined {
  return BY_ID.get(id);
}

/** Which apps' commands can be live at the same time as `app`'s — the scope a conflict is checked in. */
export function sharesScope(a: CommandApp, b: CommandApp): boolean {
  if (a === b || a === 'global' || b === 'global') return true;
  // `editors` commands run inside Docs, Sheets and Slides.
  const shared = (x: CommandApp) => x === 'docs' || x === 'sheets' || x === 'slides';
  return (a === 'editors' && shared(b)) || (b === 'editors' && shared(a));
}
