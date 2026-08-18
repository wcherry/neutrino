/**
 * DocFieldExtension — field codes in the body of a document.
 *
 * A field is an inline atom holding a code and a fallback (`docFields.ts` owns
 * what those mean), never a value. Typing `{{title}}` turns into one through an
 * input rule; the Insert menu puts one in directly. What it *shows* is produced
 * on every paint from a context the editor pushes in with `setDocFieldContext`,
 * so a rename, an edited property or a reflow is reflected without the document
 * being touched.
 *
 * Two consequences worth stating, because they are the whole design:
 *
 *  - **Nothing writes the value back into the node.** An attribute write would
 *    be serialised by the next autosave and sent to every collaborator through
 *    the Y.Doc, fossilising today's page number in a document read tomorrow —
 *    the same trap `DriveImageExtension` avoids with decorations and
 *    `PaginationExtension` with widgets. The only attribute a user action
 *    writes is `showCode`, which is a property of the field, not of its value.
 *
 *  - **`{{page}}` is measured, not counted.** Where a field lands is a function
 *    of the current paper size, margins, zoom and everything above it on the
 *    page; the only thing that knows is the layout. So the plugin measures each
 *    field's rendered position against the page stride the editor reports, in
 *    an animation frame after the pagination plugin has had its pass, and
 *    repaints the ones that moved.
 *
 * `renderHTML` resolves too, because that is what `editor.getHTML()` feeds to
 * export, print and the .docx builder — a field must leave the editor as its
 * value, not as braces. It cannot be handed a position, so it reads the page
 * from the last measurement: by node identity first, and failing that by the
 * field's code, which is exact for the ordinary document with one page field in
 * it. Exports are re-paginated by whatever opens them anyway, so a page number
 * baked into one is an approximation however it is obtained.
 */

import { InputRule, Node, mergeAttributes } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import type { Selection } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView, NodeView } from '@tiptap/pm/view';
import {
  applySuggestion,
  dispatchSuggestion,
  docFieldSuggestionPlugin,
  getFieldSuggestionState,
  isSuggestionOpen,
  type FieldSuggestionState,
} from '@/lib/extensions/DocFieldSuggestion';
import {
  FIELD_TOKEN_SOURCE,
  canonicalFieldCode,
  docFieldText,
  emptyDocProperties,
  fieldSpecFromMatch,
  formatFieldToken,
  resolveDocField,
  type DocFieldContext,
  type DocFieldSpec,
} from '@/lib/docFields';

export const docFieldPluginKey = new PluginKey('docField');

/** The node's name in the schema, and the key its storage lives under. */
export const DOC_FIELD_NAME = 'docField';

export interface DocFieldStorage {
  /** Everything but `page`, which is measured per field. */
  context: DocFieldContext;
  /**
   * Sheet height plus the gap that follows it, in CSS px — the distance from
   * one page's top to the next, which is what a measured offset is divided by.
   * Zero until the editor reports it, and while it is zero every field reads as
   * page 1 rather than guessing.
   */
  pageStride: number;
  /** Show every field as its code, without touching any field's own setting. */
  showAllCodes: boolean;
  /** The live node views, so a context change can repaint them all. */
  views: Set<FieldNodeView>;
  /** The page each field was last measured onto. */
  pages: WeakMap<ProseMirrorNode, number>;
  /** The same, keyed by code — the fallback `renderHTML` uses. */
  pagesByCode: Map<string, number>;
  /** Set by the plugin; asks for a measure on the next animation frame. */
  scheduleMeasure: () => void;
}

function defaultContext(): DocFieldContext {
  return { title: '', page: 1, pages: 1, properties: emptyDocProperties() };
}

function specOf(node: ProseMirrorNode): DocFieldSpec {
  return {
    code: canonicalFieldCode(String(node.attrs.code ?? '')),
    arg: typeof node.attrs.arg === 'string' && node.attrs.arg ? node.attrs.arg : null,
  };
}

/**
 * The 1-based page an element sits on.
 *
 * `view.dom`'s top is the top of page 1's content area, which is the origin
 * `PaginationExtension` breaks against — so page k spans `[k*stride,…]` in the
 * same coordinates. The editor scales the whole page with a CSS transform for
 * zoom, which scales every rect with it; `offsetWidth` is the unscaled width, so
 * their ratio recovers the factor without this having to know the zoom level.
 */
export function pageForElement(view: EditorView, el: HTMLElement, stride: number): number {
  if (!(stride > 0)) return 1;
  const rootRect = view.dom.getBoundingClientRect();
  const width = (view.dom as HTMLElement).offsetWidth;
  const scale = width > 0 && rootRect.width > 0 ? rootRect.width / width : 1;
  const top = (el.getBoundingClientRect().top - rootRect.top) / scale;
  if (!Number.isFinite(top)) return 1;
  return Math.max(1, Math.floor(top / stride) + 1);
}

// ── Node view ───────────────────────────────────────────────────────────────

class FieldNodeView implements NodeView {
  dom: HTMLSpanElement;
  private node: ProseMirrorNode;
  private readonly editor: Editor;
  private readonly getPos: () => number | undefined;
  private readonly storage: DocFieldStorage;

  constructor(
    node: ProseMirrorNode,
    editor: Editor,
    getPos: () => number | undefined,
    storage: DocFieldStorage,
  ) {
    this.node = node;
    this.editor = editor;
    this.getPos = getPos;
    this.storage = storage;

    this.dom = document.createElement('span');
    this.dom.className = 'doc-field';
    this.dom.setAttribute('contenteditable', 'false');
    // A field is one thing, so it announces itself as one rather than as loose
    // text a screen reader would read straight through.
    this.dom.setAttribute('role', 'note');
    this.dom.addEventListener('dblclick', this.handleDoubleClick);

    storage.views.add(this);
    this.paint();
  }

  /** Toggling on double-click, because that is the gesture that already means
   *  "act on this one thing" and a single click has to stay selection. */
  private handleDoubleClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const pos = this.getPos();
    if (typeof pos === 'number') toggleFieldAt(this.editor, pos);
  };

  private showingCode(): boolean {
    return this.node.attrs.showCode === true || this.storage.showAllCodes;
  }

  paint(): void {
    const spec = specOf(this.node);
    const showCode = this.showingCode();
    const page = this.storage.pages.get(this.node) ?? this.storage.pagesByCode.get(spec.code) ?? 1;
    const resolved = resolveDocField(spec, { ...this.storage.context, page });

    this.dom.textContent = showCode ? formatFieldToken(spec) : resolved.text;
    this.dom.dataset.docField = spec.code;
    this.dom.dataset.state = showCode ? 'code' : resolved.state;
    this.dom.title = showCode
      ? `Field ${formatFieldToken(spec)} — double-click to show its value`
      : `${formatFieldToken(spec)} — double-click to show the field code`;
  }

  /**
   * Measure which page this field is on. Returns whether it moved, so the
   * caller can repaint only the fields that need it.
   */
  measure(view: EditorView, stride: number): boolean {
    if (!(stride > 0) || !this.dom.isConnected) return false;
    const page = pageForElement(view, this.dom, stride);
    this.storage.pagesByCode.set(specOf(this.node).code, page);
    if (this.storage.pages.get(this.node) === page) return false;
    this.storage.pages.set(this.node, page);
    return true;
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    // Carry the measurement across, or the field reads as page 1 for the frame
    // between this update and the next measure — a visible flicker on every
    // keystroke in a document with a page field in it.
    const page = this.storage.pages.get(this.node);
    this.node = node;
    if (page !== undefined) this.storage.pages.set(node, page);
    this.paint();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('doc-field-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('doc-field-selected');
  }

  /** The view owns its own text; a repaint is not a document edit. */
  ignoreMutation(): boolean {
    return true;
  }

  /** Let the double-click handler above run before ProseMirror acts on it. */
  stopEvent(event: Event): boolean {
    return event.type === 'dblclick';
  }

  destroy(): void {
    this.dom.removeEventListener('dblclick', this.handleDoubleClick);
    this.storage.views.delete(this);
  }
}

// ── Acting on a single field ────────────────────────────────────────────────

function storageOf(editor: Editor): DocFieldStorage | null {
  return (editor.storage as Record<string, unknown>)[DOC_FIELD_NAME] as DocFieldStorage ?? null;
}

/** Flip one field between its code and its value. */
function toggleFieldAt(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== DOC_FIELD_NAME) return false;
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, showCode: !node.attrs.showCode }),
  );
  return true;
}

/**
 * The field the user means: the selected one, else the one the caret is sitting
 * against — before it first, since that is where the caret lands when a field is
 * inserted and is what "the field I just made" means.
 */
export function fieldPosNear(doc: ProseMirrorNode, selection: Selection): number | null {
  if (selection instanceof NodeSelection && selection.node.type.name === DOC_FIELD_NAME) {
    return selection.from;
  }
  const { from } = selection;
  for (const pos of [from - 1, from]) {
    if (pos < 0 || pos >= doc.content.size) continue;
    if (doc.nodeAt(pos)?.type.name === DOC_FIELD_NAME) return pos;
  }
  return null;
}

export function fieldPosNearSelection(editor: Editor): number | null {
  return fieldPosNear(editor.state.doc, editor.state.selection);
}

// ── Editor-facing helpers ───────────────────────────────────────────────────

/**
 * Tell the extension what the fields resolve against. Called by the editor
 * whenever the title, the properties, the page count or the page geometry
 * changes; until it is, every field resolves against an empty context and so
 * shows its fallback, which is the right thing for an editor that has not
 * finished loading.
 */
export function setDocFieldContext(
  editor: Editor,
  patch: Partial<Omit<DocFieldContext, 'page'>> & { pageStride?: number },
): void {
  if (editor.isDestroyed) return;
  const storage = storageOf(editor);
  if (!storage) return;
  const { pageStride, ...context } = patch;
  storage.context = { ...storage.context, ...context };
  if (typeof pageStride === 'number' && Number.isFinite(pageStride)) {
    storage.pageStride = pageStride;
  }
  storage.views.forEach(view => view.paint());
  storage.scheduleMeasure();
}

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    docField: {
      /** Put a field at the caret. */
      insertDocField: (spec: { code: string; arg?: string | null }) => ReturnType;
      /** Flip the field at (or beside) the caret between its code and its value. */
      toggleDocFieldCode: () => ReturnType;
      /** Show every field as its code, or as its value. */
      setAllDocFieldCodes: (show: boolean) => ReturnType;
      /** Re-resolve and re-measure every field in the document. */
      refreshDocFields: () => ReturnType;
    };
  }
}

export const DocFieldExtension = Node.create({
  name: DOC_FIELD_NAME,

  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addStorage(): DocFieldStorage {
    return {
      context: defaultContext(),
      pageStride: 0,
      showAllCodes: false,
      views: new Set(),
      pages: new WeakMap(),
      pagesByCode: new Map(),
      scheduleMeasure: () => {},
    };
  },

  addAttributes() {
    return {
      code: {
        default: 'title',
        parseHTML: (el: HTMLElement) => canonicalFieldCode(el.getAttribute('data-doc-field') ?? ''),
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-doc-field': String(attrs.code) }),
      },
      arg: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-doc-field-arg') || null,
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.arg ? { 'data-doc-field-arg': String(attrs.arg) } : {},
      },
      showCode: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-doc-field-show-code') === 'true',
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.showCode ? { 'data-doc-field-show-code': 'true' } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-doc-field]' }];
  },

  renderHTML({ node, HTMLAttributes }: { node: ProseMirrorNode; HTMLAttributes: Record<string, unknown> }) {
    const storage = this.storage as DocFieldStorage;
    const spec = specOf(node);
    const page = storage.pages.get(node) ?? storage.pagesByCode.get(spec.code) ?? 1;
    const text = docFieldText(spec, { ...storage.context, page }, node.attrs.showCode === true);
    return [
      'span',
      mergeAttributes(HTMLAttributes as Record<string, string>, { class: 'doc-field' }),
      text,
    ];
  },

  /** What `editor.getText()` — and so the plain-text export — sees. */
  renderText({ node }: { node: ProseMirrorNode }) {
    const storage = this.storage as DocFieldStorage;
    const spec = specOf(node);
    const page = storage.pages.get(node) ?? storage.pagesByCode.get(spec.code) ?? 1;
    return docFieldText(spec, { ...storage.context, page }, node.attrs.showCode === true);
  },

  addInputRules() {
    const type = this.type;
    return [
      // Hand-written rather than `nodeInputRule`, which is built for rules whose
      // first capture group is the node's *content* (`![alt](src)`): it replaces
      // only that group and re-inserts the last typed character, which here
      // swaps `title` for the node and leaves `{{` and `}}` sitting either side
      // of it. The whole matched range is the field.
      new InputRule({
        find: new RegExp(`${FIELD_TOKEN_SOURCE}$`),
        handler: ({ state, range, match }) => {
          const spec = fieldSpecFromMatch(match);
          state.tr.replaceWith(
            range.from,
            range.to,
            type.create({ code: spec.code, arg: spec.arg, showCode: false }),
          );
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertDocField:
        ({ code, arg }) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { code: canonicalFieldCode(code), arg: arg || null, showCode: false },
          }),

      toggleDocFieldCode:
        () =>
        ({ tr, dispatch }) => {
          // Through the command's own transaction, not a second dispatch of our
          // own: a command that dispatches while the command manager is still
          // building its transaction leaves the manager applying one built
          // against a document that has already moved on.
          const pos = fieldPosNear(tr.doc, tr.selection);
          if (pos === null) return false;
          const node = tr.doc.nodeAt(pos);
          if (!node || node.type.name !== DOC_FIELD_NAME) return false;
          if (dispatch) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, showCode: !node.attrs.showCode });
          }
          return true;
        },

      setAllDocFieldCodes:
        (show: boolean) =>
        ({ editor }) => {
          const storage = storageOf(editor as Editor);
          if (!storage) return false;
          storage.showAllCodes = show;
          storage.views.forEach(view => view.paint());
          return true;
        },

      refreshDocFields:
        () =>
        ({ editor }) => {
          const storage = storageOf(editor as Editor);
          if (!storage) return false;
          const view = (editor as Editor).view;
          storage.views.forEach(v => v.measure(view, storage.pageStride));
          storage.views.forEach(v => v.paint());
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    /**
     * Answer a key only while the autocomplete is open. Tiptap runs the last
     * registered extension's keymap first, so these get at Enter, Tab and the
     * arrows before StarterKit does — and hand them straight back by returning
     * false whenever no menu is showing.
     */
    const whileSuggesting =
      (handle: (view: EditorView, state: FieldSuggestionState) => boolean) => () => {
        const view = this.editor.view;
        const state = getFieldSuggestionState(view.state);
        if (!isSuggestionOpen(state)) return false;
        return handle(view, state!);
      };

    return {
      ArrowDown: whileSuggesting(view => {
        dispatchSuggestion(view, { move: 1 });
        return true;
      }),
      ArrowUp: whileSuggesting(view => {
        dispatchSuggestion(view, { move: -1 });
        return true;
      }),
      Enter: whileSuggesting((view, state) =>
        applySuggestion(view, this.type, state.items[state.index]),
      ),
      Tab: whileSuggesting((view, state) =>
        applySuggestion(view, this.type, state.items[state.index]),
      ),
      Escape: whileSuggesting(view => {
        dispatchSuggestion(view, { dismiss: true });
        return true;
      }),

      // The word-processor bindings: update, toggle this one, toggle all.
      F9: () => this.editor.commands.refreshDocFields(),
      'Shift-F9': () => this.editor.commands.toggleDocFieldCode(),
      'Alt-F9': () => {
        const storage = storageOf(this.editor);
        return this.editor.commands.setAllDocFieldCodes(!storage?.showAllCodes);
      },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) =>
      new FieldNodeView(
        node,
        editor as Editor,
        getPos as () => number | undefined,
        this.storage as DocFieldStorage,
      );
  },

  addProseMirrorPlugins() {
    const storage = this.storage as DocFieldStorage;

    return [
      // The autocomplete that opens on `{{`. It reads the document's own
      // property names out of the same context the fields resolve against, so a
      // document with a `client` property offers `{{client}}` alongside the
      // built-in codes.
      docFieldSuggestionPlugin(() => Object.keys(storage.context.properties.custom)),

      new Plugin({
        key: docFieldPluginKey,

        view(view) {
          let frame = 0;

          const measure = () => {
            frame = 0;
            if (view.isDestroyed) return;
            const moved: FieldNodeView[] = [];
            storage.views.forEach(v => {
              if (v.measure(view, storage.pageStride)) moved.push(v);
            });
            moved.forEach(v => v.paint());
          };

          const schedule = () => {
            if (frame || typeof requestAnimationFrame === 'undefined') return;
            // In a frame callback so layout has run — and so the pagination
            // plugin's spacers, which decide which page anything is on, are
            // already in the DOM.
            frame = requestAnimationFrame(measure);
          };

          storage.scheduleMeasure = schedule;

          // Images decoding and webfonts swapping in move fields down a page
          // with no transaction to hang a re-measure off.
          const observer =
            typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
          observer?.observe(view.dom);

          schedule();

          return {
            update: () => schedule(),
            destroy: () => {
              if (frame) cancelAnimationFrame(frame);
              observer?.disconnect();
              storage.scheduleMeasure = () => {};
            },
          };
        },
      }),
    ];
  },
});
