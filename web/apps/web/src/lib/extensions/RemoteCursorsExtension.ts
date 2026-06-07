/**
 * RemoteCursorsExtension
 *
 * A Tiptap/ProseMirror extension that renders colored caret widgets for
 * remote collaborators' cursor positions. Cursor data comes from the
 * `usePresence` hook and is pushed into this plugin via a command.
 *
 * Each remote cursor is drawn as an inline widget decoration at the `anchor`
 * position. A tiny colored label floats above showing the user's name.
 */

import { Extension } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { RemoteUser } from '@/hooks/usePresence';

// ── Plugin key ────────────────────────────────────────────────────────────────

export const remoteCursorsPluginKey = new PluginKey<RemoteCursorsState>('remoteCursors');

interface RemoteCursorsState {
  users: RemoteUser[];
  decorations: DecorationSet;
}

// ── Decoration builder ────────────────────────────────────────────────────────

function buildDecorations(doc: Parameters<typeof DecorationSet.create>[0], users: RemoteUser[]): DecorationSet {
  const decorations: Decoration[] = [];

  for (const user of users) {
    if (!user.cursor) continue;
    const { anchor } = user.cursor;

    // Clamp to valid document positions
    const pos = Math.max(0, Math.min(anchor, doc.content.size));

    const widget = document.createElement('span');
    widget.className = 'remote-cursor';
    widget.style.setProperty('--cursor-color', user.color);

    const label = document.createElement('span');
    label.className = 'remote-cursor-label';
    label.style.setProperty('--cursor-color', user.color);
    label.textContent = user.name;
    widget.appendChild(label);

    decorations.push(
      Decoration.widget(pos, widget, {
        key: `cursor-${user.clientId}`,
        side: -1,
      })
    );
  }

  return DecorationSet.create(doc, decorations);
}

// ── Command type augmentation ─────────────────────────────────────────────────

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    remoteCursors: {
      updateRemoteCursors: (users: RemoteUser[]) => ReturnType;
    };
  }
}

// ── Extension ──────────────────────────────────────────────────────────────────

export const RemoteCursorsExtension = Extension.create({
  name: 'remoteCursors',

  addProseMirrorPlugins() {
    return [
      new Plugin<RemoteCursorsState>({
        key: remoteCursorsPluginKey,

        state: {
          init(_config, state) {
            return { users: [], decorations: DecorationSet.empty };
          },

          apply(tr, old, _oldState, newState) {
            const meta = tr.getMeta(remoteCursorsPluginKey) as RemoteUser[] | undefined;
            const users = meta ?? old.users;

            // Remap existing decorations when the document changes
            if (tr.docChanged && !meta) {
              return {
                users,
                decorations: old.decorations.map(tr.mapping, tr.doc),
              };
            }

            return {
              users,
              decorations: buildDecorations(newState.doc, users),
            };
          },
        },

        props: {
          decorations(state) {
            return remoteCursorsPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addCommands(): any {
    return {
      updateRemoteCursors:
        (users: RemoteUser[]) =>
        ({ tr, dispatch }: { tr: import('@tiptap/pm/state').Transaction; dispatch: ((tr: import('@tiptap/pm/state').Transaction) => void) | undefined }) => {
          if (dispatch) {
            tr.setMeta(remoteCursorsPluginKey, users);
            dispatch(tr);
          }
          return true;
        },
    };
  },
});
