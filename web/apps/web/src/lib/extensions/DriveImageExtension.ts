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
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  BLANK_IMAGE,
  parseDriveImageRef,
  peekDriveImageUrl,
  resolveDriveImageUrl,
} from '@/lib/driveImages';
import { transactionDiff, type TransactionDiff } from './incrementalDecorations';

const driveImagePluginKey = new PluginKey<DriveImageState>('driveImages');

/** Every image node in the doc whose src is a Drive reference. */
function referencedImages(doc: ProseMirrorNode): { pos: number; node: ProseMirrorNode; fileId: string }[] {
  const found: { pos: number; node: ProseMirrorNode; fileId: string }[] = [];
  doc.descendants((node, pos) => {
    const fileId = parseDriveImageRef(node.attrs?.src as string | undefined);
    if (fileId) found.push({ pos, node, fileId });
  });
  return found;
}

interface DriveImageState {
  decorations: DecorationSet;
  /** The Drive files the document references, as of the last full scan. */
  fileIds: string[];
}

function buildState(doc: ProseMirrorNode): DriveImageState {
  const found = referencedImages(doc);
  const decorations = found.map(({ pos, node, fileId }) => {
    const resolved = peekDriveImageUrl(fileId);
    // Until it resolves, show a blank rather than the reference: pointing an
    // <img> at an unloadable src paints a broken-image icon on first render.
    return Decoration.node(pos, pos + node.nodeSize, {
      src: resolved ?? BLANK_IMAGE,
      ...(resolved ? {} : { 'data-loading': 'true' }),
    });
  });
  return { decorations: DecorationSet.create(doc, decorations), fileIds: found.map(f => f.fileId) };
}

/** Whether the changed range holds a Drive image, which a mapped set would not know about. */
function addsDriveImage(tr: Transaction, diff: TransactionDiff): boolean {
  let found = false;
  tr.doc.nodesBetween(diff.from, Math.min(diff.to, tr.doc.content.size), node => {
    if (found) return false;
    if (parseDriveImageRef(node.attrs?.src as string | undefined)) found = true;
    return !found;
  });
  return found;
}

export const DriveImageExtension = Extension.create({
  name: 'driveImages',

  addProseMirrorPlugins() {
    // Ids already being fetched, so a re-render mid-flight doesn't queue the
    // same download again.
    const inFlight = new Set<string>();

    function requestMissing(view: EditorView) {
      for (const fileId of driveImagePluginKey.getState(view.state)?.fileIds ?? []) {
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
          init: (_config, state) => buildState(state.doc),
          // Scanning the whole document on every keystroke was a measurable part of typing in a
          // long one. An edit that adds no image just moves the existing decorations along; a
          // deleted image's decoration goes with it.
          apply: (tr, current, _oldState, newState) => {
            if (tr.getMeta(driveImagePluginKey)) return buildState(newState.doc);
            const diff = tr.docChanged ? transactionDiff(tr) : null;
            if (!diff) return current;
            if (addsDriveImage(tr, diff)) return buildState(newState.doc);
            return { ...current, decorations: current.decorations.map(diff.map, newState.doc) };
          },
        },

        props: {
          decorations(state) {
            return driveImagePluginKey.getState(state)?.decorations;
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
