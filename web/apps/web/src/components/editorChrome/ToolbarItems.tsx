'use client';

import React, { useState } from 'react';
import { MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { Popover } from '@neutrino/ui';
import { useDismiss } from '@neutrino/commands';
import { EDITOR_TOOLBARS, useToolbarLayout, type EditorToolbarId } from '@/lib/editorToolbars';
import { CustomizeToolbarDialog } from './CustomizeToolbar';
import styles from './editorChrome.module.css';

/** One tool group as the editor draws it. */
export interface ToolDef {
  id: string;
  /** The group, or nothing when it does not apply right now (table tools outside a table). */
  render: () => React.ReactNode;
  /** Drawn straight after the group before it, with no divider — as the toolbar always drew it. */
  joined?: boolean;
}

export interface ToolbarItemsProps {
  editor: EditorToolbarId;
  tools: ToolDef[];
  /** What separates two groups in this editor's toolbar. */
  divider: React.ReactNode;
  /** Only this region's tools, for a toolbar split around its title. */
  region?: 'start' | 'end';
  /** Whether this instance holds the "More tools" menu (the last region does). */
  overflow?: boolean;
  /** A vertical tool rail rather than a row. */
  vertical?: boolean;
}

/**
 * The tool groups of an editor's toolbar in the user's order (U10), with the hidden ones in a
 * "More tools" menu and a caption under each when labels are on. Right-click a tool for
 * "Customize toolbar…". With nothing customized this draws exactly what the toolbar drew before.
 */
export function ToolbarItems({ editor, tools, divider, region, overflow = true, vertical = false }: ToolbarItemsProps) {
  const layout = useToolbarLayout(editor);
  const catalog = EDITOR_TOOLBARS[editor].tools;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useDismiss(() => setMenu(null), menu !== null);

  const byId = new Map(tools.map(t => [t.id, t]));
  const captionOf = (id: string) => catalog.find(t => t.id === id)?.caption ?? id;
  const inRegion = (id: string) => !region || catalog.find(t => t.id === id)?.region === region;

  const shown: React.ReactNode[] = [];
  const tucked: { id: string; body: React.ReactNode }[] = [];
  for (const id of layout.order) {
    const tool = byId.get(id);
    if (!tool) continue;
    if (layout.hidden.has(id)) {
      if (overflow) {
        const body = tool.render();
        if (body != null && body !== false) tucked.push({ id, body });
      }
      continue;
    }
    if (!inRegion(id)) continue;
    const body = tool.render();
    if (body == null || body === false) continue;
    if (shown.length > 0 && !tool.joined) shown.push(<React.Fragment key={`${id}:divider`}>{divider}</React.Fragment>);
    shown.push(
      <span key={id} data-tool={id} className={layout.labels ? styles.toolLabelled : styles.tool}>
        {layout.labels ? <span className={styles.toolBody}>{body}</span> : body}
        {layout.labels && <span className={styles.toolCaption}>{captionOf(id)}</span>}
      </span>,
    );
  }

  return (
    <div
      className={styles.toolItems}
      onContextMenu={e => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {shown}
      {overflow && tucked.length > 0 && (
        <>
          {shown.length > 0 && divider}
          <Popover
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
            placement={vertical ? 'right' : 'bottom-end'}
            trigger={
              <button
                type="button"
                className={styles.moreButton}
                title="More tools"
                aria-label="More tools"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen(v => !v)}
              >
                <MoreHorizontal size={15} />
              </button>
            }
          >
            <div className={styles.morePanel} role="group" aria-label="More tools">
              {tucked.map(({ id, body }) => (
                <div key={id} className={styles.moreRow} data-tool={id}>
                  <span className={styles.moreCaption}>{captionOf(id)}</span>
                  <span className={styles.moreTools}>{body}</span>
                </div>
              ))}
              <button
                type="button"
                className={styles.moreCustomize}
                onClick={() => {
                  setMoreOpen(false);
                  setCustomizing(true);
                }}
              >
                <SlidersHorizontal size={13} aria-hidden="true" /> Customize toolbar…
              </button>
            </div>
          </Popover>
        </>
      )}
      {menu && (
        <>
          <div className={styles.menuScrim} onMouseDown={() => setMenu(null)} onContextMenu={e => { e.preventDefault(); setMenu(null); }} />
          <div className={styles.contextMenu} role="menu" style={{ left: menu.x, top: menu.y }}>
            <button
              type="button"
              role="menuitem"
              className={styles.contextItem}
              autoFocus
              onClick={() => {
                setMenu(null);
                setCustomizing(true);
              }}
            >
              <SlidersHorizontal size={13} aria-hidden="true" /> Customize toolbar…
            </button>
          </div>
        </>
      )}
      <CustomizeToolbarDialog editor={editor} open={customizing} onClose={() => setCustomizing(false)} />
    </div>
  );
}
