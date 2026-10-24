'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, SlidersHorizontal } from 'lucide-react';
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
  /**
   * Whether this instance holds the "More tools" menu (the last region does). That instance also
   * answers a right-click (Ctrl-click on a Mac) anywhere on the toolbar.
   */
  overflow?: boolean;
  /** A vertical tool rail rather than a row. */
  vertical?: boolean;
}

/**
 * The tool groups of an editor's toolbar in the user's order (U10), with the hidden ones in a
 * "More tools" menu and a caption under each when labels are on. Right-click (or Ctrl-click) anywhere
 * on the toolbar for "Customize toolbar…" — on a tool, a gap between groups or the empty end of the
 * bar. With nothing customized this draws exactly what the toolbar drew before.
 *
 * The toolbar is the nearest `[data-toolbar-root]` ancestor, or else the element this is drawn in.
 * Text fields keep the browser's own menu, for paste.
 */
export function ToolbarItems({ editor, tools, divider, region, overflow = true, vertical = false }: ToolbarItemsProps) {
  const layout = useToolbarLayout(editor);
  const catalog = EDITOR_TOOLBARS[editor].tools;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  useDismiss(() => setMenu(null), menu !== null);
  useDismiss(() => setMoreOpen(false), moreOpen);
  const itemsRef = useRef<HTMLDivElement>(null);

  // The items are `display: contents`, so the gaps and the rest of the bar belong to the toolbar
  // element itself: listen there.
  useEffect(() => {
    const items = itemsRef.current;
    const bar = overflow ? (items?.closest<HTMLElement>('[data-toolbar-root]') ?? items?.parentElement) : null;
    if (!bar) return;
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('[data-toolbar-menu], input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    };
    bar.addEventListener('contextmenu', onContextMenu);
    return () => bar.removeEventListener('contextmenu', onContextMenu);
  }, [overflow]);

  // A click near the right or bottom edge of the window would put the menu partly off it.
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !menu) return;
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(menu.x, window.innerWidth - width - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(menu.y, window.innerHeight - height - 4))}px`;
  }, [menu]);

  // "More tools" opens beside its button (to the right of a rail, below a bar), on <body> like the
  // menu: a tool rail scrolls, and a panel drawn inside it was clipped and scrolled the rail away.
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const morePanelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const button = moreButtonRef.current;
    const panel = morePanelRef.current;
    if (!moreOpen || !button || !panel) return;
    const at = button.getBoundingClientRect();
    const { width, height } = panel.getBoundingClientRect();
    const left = vertical ? at.right + 6 : at.right - width;
    const top = vertical ? at.top : at.bottom + 6;
    panel.style.left = `${Math.max(4, Math.min(left, window.innerWidth - width - 4))}px`;
    panel.style.top = `${Math.max(4, Math.min(top, window.innerHeight - height - 4))}px`;
  }, [moreOpen, vertical]);
  useEffect(() => {
    if (!moreOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!morePanelRef.current?.contains(target) && !moreButtonRef.current?.contains(target)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [moreOpen]);

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
    <div ref={itemsRef} className={vertical ? `${styles.toolItems} ${styles.vertical}` : styles.toolItems}>
      {shown}
      {overflow && tucked.length > 0 && (
        <>
          {shown.length > 0 && divider}
          <button
            ref={moreButtonRef}
            type="button"
            className={styles.moreButton}
            title="More tools"
            aria-label="More tools"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(v => !v)}
          >
            <MoreHorizontal size={15} />
          </button>
          {moreOpen && createPortal(
            <div ref={morePanelRef} className={`${styles.morePopover} ${styles.morePanel}`} data-toolbar-menu role="group" aria-label="More tools">
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
            </div>,
            document.body,
          )}
        </>
      )}
      {/* On <body>: a toolbar's glass `backdrop-filter` makes it the containing block of a fixed
          descendant, which put the menu far from the pointer, and stops the menu's own glass
          blurring anything. */}
      {menu && createPortal(
        <>
          <div className={styles.menuScrim} data-toolbar-menu onMouseDown={() => setMenu(null)} onContextMenu={e => { e.preventDefault(); setMenu(null); }} />
          <div ref={menuRef} className={styles.contextMenu} data-toolbar-menu role="menu" style={{ left: menu.x, top: menu.y }}>
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
        </>,
        document.body,
      )}
      <CustomizeToolbarDialog editor={editor} open={customizing} onClose={() => setCustomizing(false)} />
    </div>
  );
}
