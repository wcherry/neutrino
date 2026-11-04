'use client';

import React, { useEffect, useRef, useState } from 'react';
import { EditorState, Prec, StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, insertNewline, insertTab } from '@codemirror/commands';
import {
  acceptCompletion,
  dragBlocks,
  moveBlock,
  type DragBlock,
  anchorLine,
  applySlashCommand,
  blockImage,
  fileLinkAt,
  imageFileExtension,
  indent,
  insertBlocks,
  insertEmbeds,
  linkCompletionContext,
  matchingSlashCommands,
  moveLines,
  newline,
  outdent,
  pageSyntax,
  parse,
  pasteLink,
  setPreview,
  shouldOpenLink,
  slashContext,
  styleRuns,
  toggleTask,
  toggleWrap,
  type EditorMode,
  type ImageSource,
  type LinkCompletion,
  type LinkCompletionContext,
  type LinkTarget,
  type PageSyntax,
  type SlashCommand,
  type SlashContext,
  type TextEdit,
  type TextStyle,
} from '@neutrino/atlas';
import type { EditorAnchor, ImageImport, Insertion } from './atlasModel';
import styles from './atlas.module.css';

/**
 * The page editor: CodeMirror 6 over the page's Markdown source, styled in place from the
 * page's syntax map (`pageSyntax`), as the Mac's editor is. The text is the file, always:
 * styling, hidden syntax, images and chips are decorations only, and every command makes an
 * edit a person could have typed (AtlasKit's `MarkdownEditing`).
 *
 * In Live Preview, syntax away from the cursor is hidden; an image alone in a paragraph shows
 * as the image, and a link to a Neutrino file as a chip. A click follows a link shown as a link
 * (⌘/Ctrl-click always does) and ticks a task's box. Typing `[[` suggests pages, then headings
 * after `#`; `/` opens the command menu.
 */
export interface AtlasEditorProps {
  /** The open page: a new one starts a fresh editor, with its own undo history. */
  path: string;
  text: string;
  /** Changes when `text` changed from outside the editor, for it to take the new text. */
  textVersion: number;
  mode: EditorMode;
  anchor: EditorAnchor | null;
  onChange(text: string): void;
  onOpenLink(target: LinkTarget): void;
  /** Suggestions for a wiki link being typed. */
  linkCompletions?(context: LinkCompletionContext): LinkCompletion[];
  /** The `/` menu's commands. */
  slashCommands?(): SlashCommand[];
  /** What to show for an image: a URL, or null to leave its Markdown showing (until `imagesVersion` changes). */
  imageURL?(source: ImageSource): string | null;
  imagesVersion?: number;
  /** Saves images pasted, dropped or picked into the vault; returns the link target for each. */
  importImages?(images: ImageImport[]): Promise<string[]>;
  /** The kind of Neutrino file a link opens, for it to show as a chip; null for other links. */
  linkChip?(url: string): string | null;
  /** Images or text picked elsewhere, for the editor to put at its cursor. */
  insertion?: Insertion | null;
}

// ── State ─────────────────────────────────────────────────────────────────────

/** What the decorations depend on besides the text and the selection. */
interface Env {
  mode: EditorMode;
  imageURL(source: ImageSource): string | null;
  linkChip(url: string): string | null;
  /** Bumped to look for images again. */
  imagesVersion: number;
}

const setEnv = StateEffect.define<Env>();
const envField = StateField.define<Env>({
  create: () => ({ mode: 'livePreview', imageURL: () => null, linkChip: () => null, imagesVersion: 0 }),
  update: (env, tr) => tr.effects.reduce((e, x) => (x.is(setEnv) ? x.value : e), env),
});

/** The page's syntax map, kept with the document. */
const syntaxField = StateField.define<PageSyntax>({
  create: (state) => pageSyntax(state.doc.toString()),
  update: (syntax, tr) => (tr.docChanged ? pageSyntax(tr.state.doc.toString()) : syntax),
});

// ── Decorations ───────────────────────────────────────────────────────────────

/** The classes a run's style draws with (atlas.module.css). */
function classesFor(style: TextStyle): string {
  const c: string[] = [];
  if (style.font === 'heading') c.push(styles[`h${Math.min(style.level, 6)}`]);
  if (style.font === 'monospace') c.push(styles.mono);
  if (style.bold) c.push(styles.bold);
  if (style.italic) c.push(styles.italic);
  if (style.strikethrough) c.push(styles.strike);
  if (style.highlight) c.push(styles.highlight);
  if (style.codeBackground) c.push(styles.codeBackground);
  if (style.color !== 'text') c.push(styles[`color-${style.color}`]);
  return c.join(' ');
}

const hidden = Decoration.replace({});
const marks = new Map<string, Decoration>();
const mark = (cls: string) => {
  let d = marks.get(cls);
  if (!d) marks.set(cls, (d = Decoration.mark({ class: cls })));
  return d;
};

/** An image in place of its Markdown. A click on it shows the Markdown, to edit; it doesn't follow the embed. */
class ImageWidget extends WidgetType {
  constructor(readonly url: string, readonly width: number | null, readonly end: number) {
    super();
  }
  eq(other: ImageWidget): boolean {
    return other.url === this.url && other.width === this.width && other.end === this.end;
  }
  toDOM(): HTMLElement {
    const img = document.createElement('img');
    img.src = this.url;
    img.alt = '';
    img.className = styles.image;
    img.dataset.end = String(this.end);
    if (this.width) img.style.width = `${this.width}px`;
    return img;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** A Neutrino file link's icon, in its chip. */
class ChipWidget extends WidgetType {
  constructor(readonly kind: string) {
    super();
  }
  eq(other: ChipWidget): boolean {
    return other.kind === this.kind;
  }
  toDOM(): HTMLElement {
    const icon = document.createElement('span');
    icon.className = `${styles.chipIcon} ${styles[`chip-${this.kind}`] ?? ''}`;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }
}

const touches = (sel: { from: number; to: number }, from: number, to: number) => sel.from <= to && sel.to >= from;

function decorate(state: EditorState): DecorationSet {
  const syntax = state.field(syntaxField);
  const env = state.field(envField);
  const text = state.doc.toString();
  const sel = { from: state.selection.main.from, to: state.selection.main.to };
  const live = env.mode === 'livePreview';
  const isFileLink = (url: string) => env.linkChip(url) !== null;
  const ranges: Range<Decoration>[] = [];
  for (const block of syntax.blocks) {
    if (block.to > state.doc.length) continue;
    // An image alone in its paragraph, while the cursor is elsewhere.
    if (live && !touches(sel, block.from, block.to) && !text.slice(block.from, block.to).includes('\n')) {
      const image = blockImage(block, text, isFileLink);
      const url = image && env.imageURL(image.source);
      if (image && url) {
        ranges.push(Decoration.replace({ widget: new ImageWidget(url, image.width, block.to) }).range(block.from, block.to));
        continue;
      }
    }
    for (const run of styleRuns(block, sel, env.mode)) {
      // Hidden syntax never spans a line break; a replace that did would join lines.
      if (run.style.hidden && !text.slice(run.from, run.to).includes('\n')) {
        ranges.push(hidden.range(run.from, run.to));
        continue;
      }
      const cls = classesFor(run.style);
      if (cls) ranges.push(mark(cls).range(run.from, run.to));
    }
    if (!live) continue;
    // Links to Neutrino files as chips; so are previews of files that have no picture.
    for (const span of block.spans) {
      if ((span.kind.type !== 'link' && span.kind.type !== 'image') || touches(sel, span.from, span.to)) continue;
      const kind = env.linkChip(span.kind.url);
      if (!kind) continue;
      ranges.push(mark(styles.chip).range(span.from, span.to));
      ranges.push(Decoration.widget({ widget: new ChipWidget(kind), side: -1 }).range(span.from));
    }
  }
  return Decoration.set(ranges, true);
}

const decorations = StateField.define<DecorationSet>({
  create: decorate,
  update: (set, tr) => (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(setEnv)) ? decorate(tr.state) : set),
  provide: (f) => EditorView.decorations.from(f),
});

// ── Edits ─────────────────────────────────────────────────────────────────────

/** Makes an edit through CodeMirror, so it's undoable like typing. */
function perform(view: EditorView, edit: TextEdit | null, userEvent = 'input'): boolean {
  if (!edit) return false;
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: { anchor: edit.selection.from, head: edit.selection.to },
    scrollIntoView: true,
    userEvent,
  });
  return true;
}

const selection = (view: EditorView) => ({ from: view.state.selection.main.from, to: view.state.selection.main.to });
const text = (view: EditorView) => view.state.doc.toString();
const syntaxOf = (view: EditorView) => view.state.field(syntaxField);

/** The editor's Markdown keys, as the Mac's has them. */
const markdownKeymap = keymap.of([
  { key: 'Enter', run: (v) => perform(v, newline(text(v), selection(v), syntaxOf(v))) || insertNewline(v) },
  { key: 'Tab', run: (v) => perform(v, indent(text(v), selection(v), syntaxOf(v))) || insertTab(v) },
  { key: 'Shift-Tab', run: (v) => perform(v, outdent(text(v), selection(v), syntaxOf(v))) || true },
  { key: 'Mod-b', run: (v) => perform(v, toggleWrap('**', text(v), selection(v))) },
  { key: 'Mod-i', run: (v) => perform(v, toggleWrap('_', text(v), selection(v))) },
  { key: 'Mod-e', run: (v) => perform(v, toggleWrap('`', text(v), selection(v))) },
  { key: 'Mod-Shift-x', run: (v) => perform(v, toggleWrap('~~', text(v), selection(v))) },
  { key: 'Mod-Shift-h', run: (v) => perform(v, toggleWrap('==', text(v), selection(v))) },
  {
    key: 'Mod-Enter',
    run: (v) => {
      const keep = v.state.selection;
      const edit = toggleTask(selection(v).from, text(v), syntaxOf(v), true);
      if (!edit) return false;
      v.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: keep, userEvent: 'input' });
      return true;
    },
  },
  { key: 'Alt-Mod-ArrowUp', run: (v) => perform(v, moveLines('up', text(v), selection(v), syntaxOf(v)), 'move.line') || true },
  { key: 'Alt-Mod-ArrowDown', run: (v) => perform(v, moveLines('down', text(v), selection(v), syntaxOf(v)), 'move.line') || true },
]);

// ── The suggestion menu ──────────────────────────────────────────────────────

type Menu =
  | { kind: 'link'; context: LinkCompletionContext; items: LinkCompletion[]; index: number; left: number; top: number }
  | { kind: 'slash'; context: SlashContext; items: SlashCommand[]; index: number; left: number; top: number };

const menuKey = (m: { kind: string; context: { from: number } }) => `${m.kind}:${m.context.from}`;

function acceptMenu(view: EditorView, menu: Menu, index: number): void {
  const t = text(view);
  if (menu.kind === 'link') perform(view, acceptCompletion(menu.items[index], menu.context, t), 'input.complete');
  else perform(view, applySlashCommand(menu.items[index], menu.context, t), 'input.complete');
  view.focus();
}

// ── Images on the clipboard and in drops ─────────────────────────────────────

async function imagesIn(files: Iterable<File>): Promise<ImageImport[]> {
  const out: ImageImport[] = [];
  for (const file of files) {
    const data = new Uint8Array(await file.arrayBuffer());
    if (imageFileExtension(data) === null) continue;
    // A pasted screenshot comes as `image.png`: named as Obsidian names it instead.
    out.push({ data, name: file.name && file.name !== 'image.png' ? file.name : null });
  }
  return out;
}

const imageFiles = (list: FileList | null | undefined) => [...(list ?? [])].filter((f) => f.type.startsWith('image/'));

/** The handle's grip: three short lines. */
function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <path d="M5 7h14M5 12h14M5 17h14" />
    </svg>
  );
}

// ── The component ────────────────────────────────────────────────────────────

export function AtlasEditor(props: AtlasEditorProps) {
  const { path, text: pageText, textVersion, mode, anchor, imagesVersion = 0, insertion } = props;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const shown = useRef({ path: '', version: -1 });
  const latest = useRef(props);
  latest.current = props;
  const silent = useRef(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRef = useRef<Menu | null>(null);
  menuRef.current = menu;
  const dismissed = useRef<string | null>(null);
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; pos: number; isPreview: boolean } | null>(null);
  const handledInsertion = useRef<number>(insertion?.id ?? 0);

  // ── The drag handle ─────────────────────────────────────────────────────────
  // A grip in the margin beside the block under the pointer (AtlasKit's BlockHandle). Dragging it
  // shows a line where the block will land; letting go moves it there, as one undoable edit.
  const [handle, setHandle] = useState<{ block: DragBlock; top: number } | null>(null);
  const [dragging, setDragging] = useState<{ block: DragBlock; target: number | null; y: number } | null>(null);

  /** Where the block starting at `offset` is drawn, relative to the editor: its first line's top and bottom. */
  const lineAt = (v: EditorView, offset: number) => {
    const c = v.coordsAtPos(offset, 1);
    if (!c) return null;
    const box = host.current!.getBoundingClientRect();
    return { top: c.top - box.top, bottom: c.bottom - box.top };
  };

  const showHandle = (event: React.MouseEvent) => {
    const v = view.current;
    if (!v || dragging) return;
    const content = v.contentDOM.getBoundingClientRect();
    const pos = v.posAtCoords({ x: content.left + 10, y: event.clientY });
    const block = pos === null ? undefined : dragBlocks(text(v), syntaxOf(v)).find((b) => b.from <= pos && pos <= b.to);
    const line = block && lineAt(v, block.from);
    setHandle(block && line ? { block, top: (line.top + line.bottom) / 2 - 9 } : null);
  };

  /** While dragging: before the first block whose first line's middle is below the pointer, else the end. */
  const dragTo = (event: React.PointerEvent) => {
    const v = view.current;
    if (!v || !dragging) return;
    const y = event.clientY - host.current!.getBoundingClientRect().top;
    const blocks = dragBlocks(text(v), syntaxOf(v));
    let target: number | null = null;
    let at = blocks.length ? (lineAt(v, blocks[blocks.length - 1].to)?.bottom ?? 0) : 0;
    for (const b of blocks) {
      const line = lineAt(v, b.from);
      if (line && (line.top + line.bottom) / 2 > y) {
        target = b.from;
        at = line.top - 2;
        break;
      }
    }
    setDragging({ ...dragging, target, y: at });
  };

  const drop = () => {
    const v = view.current;
    const d = dragging;
    setDragging(null);
    setHandle(null);
    if (!v || !d || d.y < 0) return;
    const block = dragBlocks(text(v), syntaxOf(v)).find((b) => b.from === d.block.from);
    if (block && perform(v, moveBlock(block, d.target, text(v)), 'move.block')) v.focus();
  };

  const env = (): Env => ({
    mode: latest.current.mode,
    imageURL: (s) => latest.current.imageURL?.(s) ?? null,
    linkChip: (u) => latest.current.linkChip?.(u) ?? null,
    imagesVersion: latest.current.imagesVersion ?? 0,
  });

  /** Opens, narrows or closes the suggestion menu for where the cursor is now. */
  const updateMenu = (v: EditorView) => {
    const sel = selection(v);
    let next: Menu | null = null;
    if (sel.from === sel.to && v.hasFocus) {
      const t = text(v);
      const syn = syntaxOf(v);
      const coords = () => {
        const c = v.coordsAtPos(sel.from);
        const box = host.current!.getBoundingClientRect();
        return c ? { left: c.left - box.left, top: c.bottom - box.top + 4 } : { left: 0, top: 0 };
      };
      const link = latest.current.linkCompletions && linkCompletionContext(t, sel.from, syn);
      if (link) {
        const items = latest.current.linkCompletions!(link);
        if (items.length) next = { kind: 'link', context: link, items, index: 0, ...coords() };
      } else if (latest.current.slashCommands) {
        const slash = slashContext(t, sel.from, syn);
        if (slash) {
          const items = matchingSlashCommands(latest.current.slashCommands(), slash.query).slice(0, 8);
          if (items.length) next = { kind: 'slash', context: slash, items, index: 0, ...coords() };
        }
      }
    }
    // Escape closes the menu until the cursor is in another `[[` or `/`.
    if (next) {
      if (menuKey(next) === dismissed.current) next = null;
      else dismissed.current = null;
    }
    // Keep the highlighted row while the same list narrows.
    const prev = menuRef.current;
    if (next && prev && prev.kind === next.kind && prev.context.from === next.context.from) next.index = Math.min(prev.index, next.items.length - 1);
    menuRef.current = next;
    setMenu(next);
  };

  const menuKeymap = Prec.highest(
    keymap.of([
      { key: 'ArrowDown', run: () => moveMenu(1) },
      { key: 'ArrowUp', run: () => moveMenu(-1) },
      { key: 'Enter', run: (v) => chooseMenu(v) },
      { key: 'Tab', run: (v) => chooseMenu(v) },
      {
        key: 'Escape',
        run: () => {
          const m = menuRef.current;
          if (!m) return false;
          dismissed.current = menuKey(m);
          menuRef.current = null;
          setMenu(null);
          return true;
        },
      },
    ]),
  );

  function moveMenu(delta: number): boolean {
    const m = menuRef.current;
    if (!m) return false;
    const next = { ...m, index: (m.index + delta + m.items.length) % m.items.length } as Menu;
    menuRef.current = next;
    setMenu(next);
    return true;
  }

  function chooseMenu(v: EditorView): boolean {
    const m = menuRef.current;
    if (!m) return false;
    menuRef.current = null;
    setMenu(null);
    acceptMenu(v, m, m.index);
    return true;
  }

  /** Saves images and embeds them at `at` (the selection by default), each a block of its own. */
  const addImages = async (images: ImageImport[], at?: { from: number; to: number }) => {
    const v = view.current;
    const importImages = latest.current.importImages;
    if (!v || !importImages || images.length === 0) return;
    const where = at ?? selection(v);
    const targets = await importImages(images);
    if (view.current !== v) return;
    const clamp = (n: number) => Math.min(n, v.state.doc.length);
    perform(v, insertEmbeds(targets, text(v), { from: clamp(where.from), to: clamp(where.to) }), 'input.paste');
  };

  const extensions = (): Extension[] => [
    syntaxField,
    envField.init(env),
    decorations,
    history(),
    menuKeymap,
    Prec.high(markdownKeymap),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences', 'aria-label': 'Page text' }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !silent.current) latest.current.onChange(u.state.doc.toString());
      if (u.docChanged || u.selectionSet || u.focusChanged) updateMenu(u.view);
    }),
    EditorView.domEventHandlers({
      mousedown(event, v) {
        setFileMenu(null);
        if (event.button !== 0) return false;
        const target = event.target as HTMLElement;
        // A click on an image shows its Markdown, to edit.
        if (target.tagName === 'IMG' && target.dataset.end) {
          event.preventDefault();
          v.dispatch({ selection: { anchor: Math.min(Number(target.dataset.end), v.state.doc.length) } });
          v.focus();
          return true;
        }
        const pos = v.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const plain = !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
        // A click on a checkbox ticks it, without moving the cursor.
        if (plain) {
          const edit = toggleTask(pos, text(v), syntaxOf(v));
          if (edit) {
            event.preventDefault();
            v.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, userEvent: 'input' });
            return true;
          }
        }
        const found = shouldOpenLink(pos, syntaxOf(v), selection(v), v.state.field(envField).mode, event.metaKey || event.ctrlKey);
        if (!found) return false;
        event.preventDefault();
        latest.current.onOpenLink(found);
        return true;
      },
      contextmenu(event, v) {
        const linkChip = latest.current.linkChip;
        const pos = v.posAtCoords({ x: event.clientX, y: event.clientY });
        if (!linkChip || pos === null) return false;
        const found = fileLinkAt(pos, syntaxOf(v), (u) => linkChip(u) !== null);
        if (!found) return false;
        event.preventDefault();
        const box = host.current!.getBoundingClientRect();
        setFileMenu({ x: event.clientX - box.left, y: event.clientY - box.top, pos, isPreview: found.isPreview });
        return true;
      },
      paste(event, v) {
        const data = event.clipboardData;
        if (!data) return false;
        const plain = data.getData('text/plain');
        // Image files, or an image with no text (a screenshot). An image that comes with text
        // (a copy from a document) pastes as the text.
        const files = imageFiles(data.files);
        if (files.length && plain === '' && latest.current.importImages) {
          event.preventDefault();
          const at = selection(v);
          void imagesIn(files).then((images) => addImages(images, at));
          return true;
        }
        if (plain && perform(v, pasteLink(plain, data.getData('text/html'), text(v), selection(v), syntaxOf(v)), 'input.paste')) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      drop(event, v) {
        const files = imageFiles(event.dataTransfer?.files);
        if (!files.length || !latest.current.importImages) return false;
        event.preventDefault();
        const pos = v.posAtCoords({ x: event.clientX, y: event.clientY }) ?? selection(v).from;
        void imagesIn(files).then((images) => addImages(images, { from: pos, to: pos }));
        return true;
      },
    }),
  ];

  // One view for the component's life; a page gets a fresh state.
  useEffect(() => {
    const v = new EditorView({ parent: host.current! });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
      shown.current = { path: '', version: -1 };
    };
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (shown.current.path !== path) {
      v.setState(EditorState.create({ doc: pageText, extensions: extensions() }));
      dismissed.current = null;
      setMenu(null);
      // A page just opened is for typing in, unless a field (its title, a search) has the focus.
      const active = document.activeElement;
      if (!active || active === document.body || v.dom.contains(active) || !active.matches('input, textarea, [contenteditable="true"]')) v.focus();
    } else if (shown.current.version !== textVersion && v.state.doc.toString() !== pageText) {
      // Synced from elsewhere: take the new text, keeping the cursor where it can be.
      const head = Math.min(v.state.selection.main.head, pageText.length);
      silent.current = true;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: pageText }, selection: { anchor: head } });
      silent.current = false;
    }
    shown.current = { path, version: textVersion };
    // `extensions` reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, pageText, textVersion]);

  // The mode, and images that have arrived.
  useEffect(() => {
    view.current?.dispatch({ effects: setEnv.of(env()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, path, imagesVersion]);

  // Shows the heading or block a followed link points at.
  useEffect(() => {
    const v = view.current;
    if (!v || !anchor) return;
    const line = anchorLine(parse(v.state.doc.toString()), anchor);
    if (line === null || line > v.state.doc.lines) return;
    const at = v.state.doc.line(line).from;
    v.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'start', yMargin: 24 }) });
    v.focus();
  }, [anchor]);

  // Images or links picked elsewhere go in at the cursor.
  useEffect(() => {
    const v = view.current;
    if (!v || !insertion || insertion.id === handledInsertion.current) return;
    handledInsertion.current = insertion.id;
    if (insertion.kind === 'images') {
      void addImages(insertion.images);
    } else if (insertion.asBlocks) {
      perform(v, insertBlocks(insertion.text.split('\n'), text(v), selection(v)), 'input');
    } else {
      const sel = selection(v);
      perform(v, { from: sel.from, to: sel.to, insert: insertion.text, selection: { from: sel.from + insertion.text.length, to: sel.from + insertion.text.length } }, 'input');
    }
    v.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertion]);

  return (
    <div className={styles.editorHost} onMouseMove={showHandle} onMouseLeave={() => !dragging && setHandle(null)}>
      <div ref={host} className={styles.editor} data-tour="atlas-editor" />
      {(handle || dragging) && (
        <button
          type="button"
          className={styles.blockHandle}
          style={{ top: handle?.top ?? 0 }}
          aria-label="Drag to move this block"
          title="Drag to move this block"
          onPointerDown={(e) => {
            if (!handle) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging({ block: handle.block, target: handle.block.from, y: -1 });
          }}
          onPointerMove={dragTo}
          onPointerUp={drop}
          onPointerCancel={() => {
            setDragging(null);
            setHandle(null);
          }}
        >
          <GripIcon />
        </button>
      )}
      {dragging && dragging.y >= 0 && <div className={styles.dropIndicator} style={{ top: dragging.y }} aria-hidden />}
      {menu && (
        <ul className={styles.suggestions} style={{ left: menu.left, top: menu.top }} role="listbox" aria-label={menu.kind === 'link' ? 'Pages' : 'Commands'}>
          {menu.items.map((item, k) => (
            <li key={menu.kind === 'link' ? `${(item as LinkCompletion).target}:${k}` : (item as SlashCommand).id}>
              <button
                type="button"
                role="option"
                aria-selected={k === menu.index}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (view.current) {
                    menuRef.current = null;
                    setMenu(null);
                    acceptMenu(view.current, menu, k);
                  }
                }}
              >
                {item.title}
                {menu.kind === 'link' && (item as LinkCompletion).detail && <small>{(item as LinkCompletion).detail}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {fileMenu && (
        <div className={styles.fileMenu} style={{ left: fileMenu.x, top: fileMenu.y }} role="menu">
          <button
            type="button"
            role="menuitem"
            onMouseDown={(e) => {
              e.preventDefault();
              const v = view.current;
              const linkChip = latest.current.linkChip;
              if (v && linkChip) perform(v, setPreview(!fileMenu.isPreview, fileMenu.pos, text(v), syntaxOf(v), (u) => linkChip(u) !== null));
              setFileMenu(null);
            }}
          >
            {fileMenu.isPreview ? 'Show as Chip' : 'Show as Preview'}
          </button>
        </div>
      )}
    </div>
  );
}
