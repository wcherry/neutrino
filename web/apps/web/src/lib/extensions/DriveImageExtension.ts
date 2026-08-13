/**
 * DriveImageExtension — displays images that the document only references.
 *
 * Image nodes store `neutrino-drive:<fileId>` as their src (see
 * `@/lib/driveImages`), which no browser can load. Resolving one is
 * asynchronous — a metadata read, sometimes a download and a decryption —
 * while rendering is synchronous, so the two are bridged with **node
 * decorations**: the document keeps the reference, and the decoration paints a
 * resolved src onto the rendered `<img>`.
 *
 * Decorations rather than a node view, deliberately. A node view would replace
 * the image extension's own `renderHTML`, and with it the width / alignment /
 * border / shadow / filter attributes `AdvancedImage` renders — or wrap the
 * `<img>` in an element the editor's CSS doesn't expect. A decoration adds an
 * attribute to whatever the extension already rendered and touches nothing
 * else. Critically it also never writes to the document: the resolved URL is a
 * display detail, and if it were an attribute instead, the next autosave would
 * serialise it and put the bytes (or a dead blob URL) back in the file.
 */

import { Extension } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  BLANK_IMAGE,
  parseDriveImageRef,
  peekDriveImageUrl,
  resolveDriveImageUrl,
} from '@/lib/driveImages';

const driveImagePluginKey = new PluginKey('driveImages');

/** Every image node in the doc whose src is a Drive reference. */
function referencedImages(doc: ProseMirrorNode): { pos: number; node: ProseMirrorNode; fileId: string }[] {
  const found: { pos: number; node: ProseMirrorNode; fileId: string }[] = [];
  doc.descendants((node, pos) => {
    const fileId = parseDriveImageRef(node.attrs?.src as string | undefined);
    if (fileId) found.push({ pos, node, fileId });
  });
  return found;
}

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations = referencedImages(doc).map(({ pos, node, fileId }) => {
    const resolved = peekDriveImageUrl(fileId);
    // Until it resolves, show a blank rather than the reference: pointing an
    // <img> at an unloadable src paints a broken-image icon on first render.
    return Decoration.node(pos, pos + node.nodeSize, {
      src: resolved ?? BLANK_IMAGE,
      ...(resolved ? {} : { 'data-loading': 'true' }),
    });
  });
  return DecorationSet.create(doc, decorations);
}

export const DriveImageExtension = Extension.create({
  name: 'driveImages',

  addProseMirrorPlugins() {
    // Ids already being fetched, so a re-render mid-flight doesn't queue the
    // same download again.
    const inFlight = new Set<string>();

    function requestMissing(view: EditorView) {
      for (const { fileId } of referencedImages(view.state.doc)) {
        if (peekDriveImageUrl(fileId) || inFlight.has(fileId)) continue;
        inFlight.add(fileId);
        resolveDriveImageUrl(fileId)
          .then(() => {
            inFlight.delete(fileId);
            if (view.isDestroyed) return;
            // An empty transaction carrying our meta: it changes no content, so
            // it can't dirty the document or trigger a save — it just asks the
            // plugin to rebuild its decorations now the src is known.
            view.dispatch(view.state.tr.setMeta(driveImagePluginKey, true));
          })
          .catch(() => {
            inFlight.delete(fileId);
            // Leaves the blank in place. The image is missing or the session is
            // locked; nothing here can fix either, and retrying on every
            // keystroke would hammer the API.
          });
      }
    }

    return [
      new Plugin({
        key: driveImagePluginKey,

        state: {
          init: (_config, state) => buildDecorations(state.doc),
          apply: (tr, current, _oldState, newState) =>
            tr.docChanged || tr.getMeta(driveImagePluginKey)
              ? buildDecorations(newState.doc)
              : current,
        },

        props: {
          decorations(state) {
            return this.getState(state);
          },
        },

        view(view) {
          requestMissing(view);
          return { update: (updated) => requestMissing(updated) };
        },
      }),
    ];
  },
});
