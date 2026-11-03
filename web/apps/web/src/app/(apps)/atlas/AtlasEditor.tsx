'use client';

import React, { useEffect, useRef } from 'react';
import { Compartment, EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  anchorLine,
  pageSyntax,
  parse,
  shouldOpenLink,
  styleRuns,
  type EditorMode,
  type LinkTarget,
  type PageSyntax,
  type TextStyle,
} from '@neutrino/atlas';
import type { EditorAnchor } from './atlasModel';
import styles from './atlas.module.css';

/**
 * The page editor: CodeMirror 6 over the page's Markdown source, styled in place from the
 * page's syntax map (`pageSyntax`), as the Mac's editor is. In Live Preview, syntax away from the
 * cursor is hidden (`styleRuns`); a click on a link shown as a link follows it, and ⌘-click
 * (Ctrl-click elsewhere) always does. The text is never touched by styling.
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
}

/** The page's syntax map, kept with the document. */
const syntaxField = StateField.define<PageSyntax>({
  create: (state) => pageSyntax(state.doc.toString()),
  update: (syntax, tr) => (tr.docChanged ? pageSyntax(tr.state.doc.toString()) : syntax),
});

const setMode = StateEffect.define<EditorMode>();
const modeField = StateField.define<EditorMode>({
  create: () => 'livePreview',
  update: (mode, tr) => tr.effects.reduce((m, e) => (e.is(setMode) ? e.value : m), mode),
});

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

function decorate(state: EditorState): DecorationSet {
  const syntax = state.field(syntaxField);
  const mode = state.field(modeField);
  const { from, to } = state.selection.main;
  const ranges: Range<Decoration>[] = [];
  for (const block of syntax.blocks) {
    for (const run of styleRuns(block, { from, to }, mode)) {
      if (run.to > state.doc.length) continue;
      // Hidden syntax never spans a line break; a replace that did would join lines.
      if (run.style.hidden && !state.doc.sliceString(run.from, run.to).includes('\n')) {
        ranges.push(hidden.range(run.from, run.to));
        continue;
      }
      const cls = classesFor(run.style);
      if (cls) ranges.push(mark(cls).range(run.from, run.to));
    }
  }
  return Decoration.set(ranges, true);
}

const decorations = StateField.define<DecorationSet>({
  create: decorate,
  update: (set, tr) => (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(setMode)) ? decorate(tr.state) : set),
  provide: (f) => EditorView.decorations.from(f),
});

export function AtlasEditor({ path, text, textVersion, mode, anchor, onChange, onOpenLink }: AtlasEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const shown = useRef({ path: '', version: -1 });
  const callbacks = useRef({ onChange, onOpenLink });
  callbacks.current = { onChange, onOpenLink };
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const silent = useRef(false);

  const extensions = (): Extension[] => [
    syntaxField,
    modeField.init(() => modeRef.current),
    decorations,
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences', 'aria-label': 'Page text' }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && !silent.current) callbacks.current.onChange(u.state.doc.toString());
    }),
    EditorView.domEventHandlers({
      mousedown(event, v) {
        if (event.button !== 0) return false;
        const pos = v.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const { from, to } = v.state.selection.main;
        const target = shouldOpenLink(pos, v.state.field(syntaxField), { from, to }, v.state.field(modeField), event.metaKey || event.ctrlKey);
        if (!target) return false;
        event.preventDefault();
        callbacks.current.onOpenLink(target);
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
      v.setState(EditorState.create({ doc: text, extensions: extensions() }));
    } else if (shown.current.version !== textVersion && v.state.doc.toString() !== text) {
      // Synced from elsewhere: take the new text, keeping the cursor where it can be.
      const head = Math.min(v.state.selection.main.head, text.length);
      silent.current = true;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, selection: { anchor: head } });
      silent.current = false;
    }
    shown.current = { path, version: textVersion };
    // `extensions` reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, text, textVersion]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.field(modeField, false) !== undefined && v.state.field(modeField) !== mode) v.dispatch({ effects: setMode.of(mode) });
  }, [mode, path]);

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

  return <div ref={host} className={styles.editor} data-tour="atlas-editor" />;
}
