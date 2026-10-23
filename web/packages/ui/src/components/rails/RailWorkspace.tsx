'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MoreHorizontal, X } from 'lucide-react';
import { Menu, MenuItem } from '../navigation/Menu';
import {
  RAIL_SIDES,
  collapseRail,
  dockPane,
  floatPane,
  isVertical,
  locate,
  movePane,
  normalizeLayout,
  paneSize,
  resizePane,
  sameLayout,
  setFloatRect,
  togglePane,
  MIN_FLOAT_HEIGHT,
  MIN_FLOAT_WIDTH,
  type FloatRect,
  type RailLayout,
  type RailSide,
  type RailSpec,
} from './railLayout';
import styles from './RailWorkspace.module.css';

/**
 * Rails of panes around a view (an editor's page, grid or canvas).
 *
 * A rail sits on any side and is a strip of tabs with labels turned along it. Clicking a tab opens
 * its pane beside the strip; a rail shows one pane at a time, and clicking the open tab — or the
 * pane's collapse button — folds the rail back to its strip. Every pane is always a tab somewhere:
 * nothing is closed, only collapsed. A tab can be dragged to another rail or out over the view,
 * where it floats; closing a floating pane puts it back where it came from. The pane's ⋯ menu does
 * the same moves for keyboard and screen-reader users.
 *
 * The layout is plain data (`railLayout.ts`) so an app can keep it as a preference: pass `layout`
 * and `onLayoutChange` to control it, or `defaultLayout` to let the workspace hold it. Whatever is
 * passed is normalised against the panes the app has now, so a stored layout from an older build
 * never breaks the view. Drags and resizes update locally and report the layout once, on release.
 */

export interface RailPane {
  id: string;
  title: string;
  icon?: React.ReactNode;
  /** The rail this pane starts in. */
  side: RailSide;
  content: React.ReactNode;
}

export interface RailWorkspaceProps {
  panes: RailPane[];
  /** The rails this view has. */
  sides: RailSide[];
  /**
   * Controlled layout — anything, normalised against `panes` and `sides`; `null` for a controlled
   * workspace with nothing stored yet. Leave it undefined to let the workspace hold the layout.
   */
  layout?: unknown;
  /** Starting layout when uncontrolled. */
  defaultLayout?: unknown;
  /** Panes open in a fresh layout, by rail. */
  defaultExpanded?: Partial<Record<RailSide, string>>;
  onLayoutChange?: (layout: RailLayout) => void;
  /** The view the rails surround. */
  children: React.ReactNode;
  className?: string;
}

const SIDE_LABEL: Record<RailSide, string> = { left: 'left', right: 'right', top: 'top', bottom: 'bottom' };
const COLLAPSE_ICON: Record<RailSide, React.ReactNode> = {
  left: <ChevronLeft size={14} />,
  right: <ChevronRight size={14} />,
  top: <ChevronUp size={14} />,
  bottom: <ChevronDown size={14} />,
};
const NARROW_QUERY = '(max-width: 640px)';
/** How far a pointer moves before a press on a tab becomes a drag. */
const DRAG_THRESHOLD = 5;
/** How far outside a strip a drop still lands on it. */
const DROP_SLOP = 16;
const KEY_RESIZE_STEP = 16;
const NEW_FLOAT_SIZE = { width: 320, height: 360 };

type DropTarget = { kind: 'rail'; side: RailSide; index: number } | { kind: 'float' };

interface TabDrag {
  paneId: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  target: DropTarget | null;
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(NARROW_QUERY);
    setNarrow(mq.matches);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return narrow;
}

function within(rect: DOMRect, x: number, y: number, slop = 0): boolean {
  return x >= rect.left - slop && x <= rect.right + slop && y >= rect.top - slop && y <= rect.bottom + slop;
}

export function RailWorkspace({
  panes,
  sides,
  layout: controlled,
  defaultLayout: initial,
  defaultExpanded,
  onLayoutChange,
  children,
  className,
}: RailWorkspaceProps) {
  const uid = useId();
  const narrow = useNarrow();
  const spec: RailSpec = useMemo(
    () => ({ sides, panes: panes.map((p) => ({ id: p.id, side: p.side })) }),
    // The spec is the ids, sides and starting rails — not the pane contents, which change every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sides.join(), panes.map((p) => `${p.id}:${p.side}`).join()],
  );
  const [uncontrolled, setUncontrolled] = useState<unknown>(initial);
  const layout = useMemo(
    () => normalizeLayout(controlled !== undefined ? controlled : uncontrolled, spec, defaultExpanded),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controlled, uncontrolled, spec, JSON.stringify(defaultExpanded ?? {})],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // At phone width an open pane covers the view, so only one shows: the rail opened most recently.
  // Display only — the stored layout keeps every rail's pane for when there is room again.
  const [front, setFront] = useState<RailSide | null>(null);
  const frontRef = useRef<RailSide | null>(null);

  const update = useCallback(
    (change: (current: RailLayout) => RailLayout) => {
      const current = layoutRef.current;
      const next = change(current);
      if (sameLayout(current, next)) return;
      const opened = RAIL_SIDES.find((side) => next.rails[side]?.expanded && next.rails[side]?.expanded !== current.rails[side]?.expanded);
      // The first change pins whichever rail was showing, so collapsing it does not fall through
      // to another rail's pane.
      const pinned = opened ?? frontRef.current;
      if (pinned) setFront(pinned);
      layoutRef.current = next;
      if (controlled === undefined) setUncontrolled(next);
      onLayoutChange?.(next);
    },
    [controlled, onLayoutChange],
  );

  const byId = useMemo(() => new Map(panes.map((p) => [p.id, p])), [panes]);
  // Until something is opened here, the first rail with a pane open; after that, the rail last
  // opened — even once it is collapsed again, so collapsing a pane leaves the view uncovered
  // rather than uncovering another rail's pane.
  const frontSide: RailSide | null = front ?? sides.find((side) => layout.rails[side]?.expanded) ?? null;
  frontRef.current = frontSide;

  // Panes keep their content mounted once opened, so collapsing one does not lose what is in it.
  const visited = useRef(new Set<string>());
  for (const side of sides) {
    const open = layout.rails[side]?.expanded;
    if (open) visited.current.add(open);
  }
  for (const id of Object.keys(layout.floating)) visited.current.add(id);

  const strips = useRef(new Map<RailSide, HTMLElement>());
  const centerRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef<string | null>(null);
  const [drag, setDrag] = useState<TabDrag | null>(null);

  const dropTargetAt = useCallback(
    (x: number, y: number): DropTarget | null => {
      for (const [side, el] of strips.current) {
        if (!within(el.getBoundingClientRect(), x, y, DROP_SLOP)) continue;
        const tabs = Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]'));
        const vertical = isVertical(side);
        const index = tabs.filter((tab) => {
          const r = tab.getBoundingClientRect();
          return vertical ? r.top + r.height / 2 < y : r.left + r.width / 2 < x;
        }).length;
        return { kind: 'rail', side, index };
      }
      const center = centerRef.current?.getBoundingClientRect();
      if (!narrow && center && within(center, x, y)) return { kind: 'float' };
      return null;
    },
    [narrow],
  );

  const startTabDrag = (paneId: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setDrag({ paneId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, active: false, target: null });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      setDrag((d) => {
        if (!d) return d;
        const active = d.active || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_THRESHOLD;
        return { ...d, x: e.clientX, y: e.clientY, active, target: active ? dropTargetAt(e.clientX, e.clientY) : null };
      });
    };
    const onUp = (e: PointerEvent) => {
      const d = drag;
      setDrag(null);
      if (!d.active) return;
      // The click that follows a drag is the end of the drag, not a tab press.
      suppressClick.current = d.paneId;
      const target = dropTargetAt(e.clientX, e.clientY);
      if (target?.kind === 'rail') update((l) => movePane(l, d.paneId, target.side, target.index));
      else if (target?.kind === 'float') {
        const center = centerRef.current!.getBoundingClientRect();
        const width = Math.min(NEW_FLOAT_SIZE.width, center.width);
        const height = Math.min(NEW_FLOAT_SIZE.height, center.height);
        update((l) => floatPane(l, d.paneId, {
          x: Math.min(Math.max(0, e.clientX - center.left - 24), Math.max(0, center.width - width)),
          y: Math.min(Math.max(0, e.clientY - center.top - 12), Math.max(0, center.height - height)),
          width,
          height,
        }));
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
    // Re-bound per drag start only; the handlers read the latest pointer through setDrag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.paneId, drag?.startX, drag?.startY, drag?.active, dropTargetAt, update]);

  const moveTargets = (paneId: string): { label: string; run: () => void }[] => {
    const at = locate(layout, paneId);
    const here = at && at !== 'floating' ? at.side : null;
    const items = sides
      .filter((side) => side !== here)
      .map((side) => ({
        label: at === 'floating' ? `Dock to ${SIDE_LABEL[side]} rail` : `Move to ${SIDE_LABEL[side]} rail`,
        run: () => update((l) => movePane(l, paneId, side)),
      }));
    if (at !== 'floating' && !narrow) {
      items.push({
        label: 'Float',
        run: () => {
          const center = centerRef.current?.getBoundingClientRect();
          const width = Math.min(NEW_FLOAT_SIZE.width, center?.width || NEW_FLOAT_SIZE.width);
          const height = Math.min(NEW_FLOAT_SIZE.height, center?.height || NEW_FLOAT_SIZE.height);
          const x = Math.max(0, ((center?.width ?? width) - width) / 2);
          const y = Math.max(0, ((center?.height ?? height) - height) / 3);
          update((l) => floatPane(l, paneId, { x, y, width, height }));
        },
      });
    }
    return items;
  };

  const dragging = drag?.active ? drag : null;

  return (
    <div className={[styles.workspace, className].filter(Boolean).join(' ')} data-dragging={dragging ? 'true' : undefined}>
      {sides.map((side) => (
        <Rail
          key={side}
          uid={uid}
          side={side}
          layout={layout}
          byId={byId}
          visited={visited.current}
          update={update}
          registerStrip={(el) => {
            if (el) strips.current.set(side, el);
            else strips.current.delete(side);
          }}
          onTabPointerDown={startTabDrag}
          suppressClick={suppressClick}
          dropIndex={dragging?.target?.kind === 'rail' && dragging.target.side === side ? dragging.target.index : null}
          draggingId={dragging?.paneId ?? null}
          moveTargets={moveTargets}
          coveredOnPhone={narrow && frontSide !== null && frontSide !== side}
          bringToFront={() => setFront(side)}
        />
      ))}
      <div ref={centerRef} className={styles.center} data-rail-view="" data-drop-float={dragging?.target?.kind === 'float' ? 'true' : undefined}>
        {children}
        {Object.entries(layout.floating).map(([id, entry]) => {
          const pane = byId.get(id);
          if (!pane) return null;
          return (
            <FloatingPane
              key={id}
              uid={uid}
              pane={pane}
              rect={entry.rect}
              centerRef={centerRef}
              onRect={(rect) => update((l) => setFloatRect(l, id, rect))}
              onClose={() => update((l) => dockPane(l, id))}
              moveTargets={moveTargets(id)}
            />
          );
        })}
      </div>
      {dragging && (
        <div className={styles.dragGhost} style={{ left: dragging.x + 12, top: dragging.y + 12 }} aria-hidden="true">
          {byId.get(dragging.paneId)?.icon}
          <span>{byId.get(dragging.paneId)?.title}</span>
        </div>
      )}
    </div>
  );
}

interface RailProps {
  uid: string;
  side: RailSide;
  layout: RailLayout;
  byId: Map<string, RailPane>;
  visited: Set<string>;
  update: (change: (l: RailLayout) => RailLayout) => void;
  registerStrip: (el: HTMLElement | null) => void;
  onTabPointerDown: (paneId: string, e: React.PointerEvent) => void;
  suppressClick: React.MutableRefObject<string | null>;
  dropIndex: number | null;
  draggingId: string | null;
  moveTargets: (paneId: string) => { label: string; run: () => void }[];
  /** At phone width another rail's pane is showing, so this one's stays folded away. */
  coveredOnPhone: boolean;
  bringToFront: () => void;
}

function Rail({
  uid,
  side,
  layout,
  byId,
  visited,
  update,
  registerStrip,
  onTabPointerDown,
  suppressClick,
  dropIndex,
  draggingId,
  moveTargets,
  coveredOnPhone,
  bringToFront,
}: RailProps) {
  const rail = layout.rails[side];
  const vertical = isVertical(side);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const stored = rail?.expanded ?? null;
  const expanded = coveredOnPhone ? null : stored;
  const [liveSize, setLiveSize] = useState<number | null>(null);
  if (!rail) return null;

  const ids = rail.panes.filter((id) => byId.has(id));
  const focusable = expanded ?? ids[0];
  const size = liveSize ?? (expanded ? paneSize(layout, expanded, side) : 0);

  const focusTab = (id: string | undefined) => {
    if (id) tabRefs.current.get(id)?.focus();
  };

  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
    const next = vertical ? 'ArrowDown' : 'ArrowRight';
    let to: number | null = null;
    if (e.key === next) to = (index + 1) % ids.length;
    else if (e.key === prev) to = (index - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = ids.length - 1;
    if (to === null) return;
    e.preventDefault();
    focusTab(ids[to]);
  };

  const startResize = (e: React.PointerEvent) => {
    if (!expanded || e.button !== 0) return;
    e.preventDefault();
    const start = vertical ? e.clientX : e.clientY;
    const base = paneSize(layout, expanded, side);
    // Dragging towards the view grows a left or top pane and shrinks a right or bottom one.
    const sign = side === 'left' || side === 'top' ? 1 : -1;
    let latest = base;
    const onMove = (ev: PointerEvent) => {
      latest = base + sign * ((vertical ? ev.clientX : ev.clientY) - start);
      setLiveSize(Math.max(0, latest));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLiveSize(null);
      update((l) => resizePane(l, expanded, latest));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onResizeKey = (e: React.KeyboardEvent) => {
    if (!expanded) return;
    const grow = side === 'left' ? 'ArrowRight' : side === 'right' ? 'ArrowLeft' : side === 'top' ? 'ArrowDown' : 'ArrowUp';
    const shrink = { ArrowRight: 'ArrowLeft', ArrowLeft: 'ArrowRight', ArrowDown: 'ArrowUp', ArrowUp: 'ArrowDown' }[grow]!;
    const delta = e.key === grow ? KEY_RESIZE_STEP : e.key === shrink ? -KEY_RESIZE_STEP : 0;
    if (!delta) return;
    e.preventDefault();
    update((l) => resizePane(l, expanded, paneSize(l, expanded, side) + delta));
  };

  const tabs: React.ReactNode[] = [];
  ids.forEach((id, index) => {
    if (dropIndex === index) tabs.push(<span key="drop" className={styles.dropMarker} aria-hidden="true" />);
    const pane = byId.get(id)!;
    tabs.push(
      <button
        key={id}
        ref={(el) => {
          if (el) tabRefs.current.set(id, el);
          else tabRefs.current.delete(id);
        }}
        type="button"
        role="tab"
        id={`${uid}-tab-${id}`}
        aria-selected={expanded === id}
        aria-controls={`${uid}-pane-${id}`}
        tabIndex={focusable === id ? 0 : -1}
        className={styles.tab}
        data-dragging={draggingId === id ? 'true' : undefined}
        title={pane.title}
        onPointerDown={(e) => onTabPointerDown(id, e)}
        onClick={() => {
          if (suppressClick.current === id) {
            suppressClick.current = null;
            return;
          }
          // Open in the layout but folded away for another rail's pane: bring it back, not close it.
          if (coveredOnPhone && stored === id) bringToFront();
          else update((l) => togglePane(l, id));
        }}
        onKeyDown={(e) => onTabKeyDown(e, index)}
      >
        {pane.icon && <span className={styles.tabIcon} aria-hidden="true">{pane.icon}</span>}
        <span className={styles.tabLabel}>{pane.title}</span>
      </button>,
    );
  });
  if (dropIndex !== null && dropIndex >= ids.length) tabs.push(<span key="drop" className={styles.dropMarker} aria-hidden="true" />);

  return (
    <div className={styles.rail} data-side={side} data-expanded={expanded ? 'true' : undefined}>
      <div
        ref={registerStrip}
        className={styles.strip}
        role="tablist"
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        aria-label={`${SIDE_LABEL[side][0].toUpperCase()}${SIDE_LABEL[side].slice(1)} panels`}
        data-drop-active={dropIndex !== null ? 'true' : undefined}
      >
        {tabs}
      </div>
      {ids.some((id) => id === expanded || visited.has(id)) && (
        <div
          className={styles.paneArea}
          hidden={!expanded}
          style={expanded ? (vertical ? { width: size } : { height: size }) : undefined}
        >
          {ids.filter((id) => id === expanded || visited.has(id)).map((id) => {
            const pane = byId.get(id)!;
            return (
              <section
                key={id}
                id={`${uid}-pane-${id}`}
                role="tabpanel"
                aria-labelledby={`${uid}-tab-${id}`}
                hidden={expanded !== id}
                className={styles.pane}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape' || e.defaultPrevented) return;
                  e.preventDefault();
                  update((l) => collapseRail(l, side));
                  focusTab(id);
                }}
              >
                <header className={styles.paneHeader}>
                  {pane.icon && <span className={styles.paneIcon} aria-hidden="true">{pane.icon}</span>}
                  <span className={styles.paneTitle}>{pane.title}</span>
                  <PaneMenu title={pane.title} items={moveTargets(id)} />
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Collapse ${pane.title}`}
                    title="Collapse"
                    onClick={() => {
                      update((l) => collapseRail(l, side));
                      focusTab(id);
                    }}
                  >
                    {COLLAPSE_ICON[side]}
                  </button>
                </header>
                <div className={styles.paneBody}>{pane.content}</div>
              </section>
            );
          })}
          {expanded && (
            <div
              className={styles.resizeHandle}
              role="separator"
              tabIndex={0}
              aria-orientation={vertical ? 'vertical' : 'horizontal'}
              aria-label={`Resize ${byId.get(expanded)?.title ?? 'panel'}`}
              aria-valuenow={Math.round(size)}
              onPointerDown={startResize}
              onKeyDown={onResizeKey}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PaneMenu({ title, items }: { title: string; items: { label: string; run: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div className={styles.menuRoot} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.iconButton}
        aria-label={`Move ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Move"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div className={styles.menuPopover}>
          <Menu aria-label={`Move ${title}`}>
            {items.map((item) => (
              <MenuItem
                key={item.label}
                id={item.label}
                label={item.label}
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
              />
            ))}
          </Menu>
        </div>
      )}
    </div>
  );
}

interface FloatingPaneProps {
  uid: string;
  pane: RailPane;
  rect: FloatRect;
  centerRef: React.RefObject<HTMLDivElement | null>;
  onRect: (rect: FloatRect) => void;
  onClose: () => void;
  moveTargets: { label: string; run: () => void }[];
}

function FloatingPane({ uid, pane, rect, centerRef, onRect, onClose, moveTargets }: FloatingPaneProps) {
  const [live, setLive] = useState<FloatRect | null>(null);
  const shown = live ?? rect;

  const track = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    if (e.button !== 0) return;
    if (mode === 'move' && (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const bounds = centerRef.current?.getBoundingClientRect();
    const maxW = bounds?.width ?? Infinity;
    const maxH = bounds?.height ?? Infinity;
    const sx = e.clientX;
    const sy = e.clientY;
    let latest = rect;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      latest = mode === 'move'
        ? {
            ...rect,
            // The window stays inside the view; it can be moved, not lost.
            x: Math.min(Math.max(0, rect.x + dx), Math.max(0, maxW - rect.width)),
            y: Math.min(Math.max(0, rect.y + dy), Math.max(0, maxH - rect.height)),
          }
        : {
            ...rect,
            width: Math.min(Math.max(MIN_FLOAT_WIDTH, rect.width + dx), Math.max(MIN_FLOAT_WIDTH, maxW - rect.x)),
            height: Math.min(Math.max(MIN_FLOAT_HEIGHT, rect.height + dy), Math.max(MIN_FLOAT_HEIGHT, maxH - rect.y)),
          };
      setLive(latest);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLive(null);
      onRect(latest);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <section
      className={styles.floating}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${uid}-float-${pane.id}`}
      style={{ left: shown.x, top: shown.y, width: shown.width, height: shown.height }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.preventDefault();
        onClose();
      }}
    >
      <header className={`${styles.paneHeader} ${styles.floatHeader}`} onPointerDown={(e) => track(e, 'move')}>
        {pane.icon && <span className={styles.paneIcon} aria-hidden="true">{pane.icon}</span>}
        <span className={styles.paneTitle} id={`${uid}-float-${pane.id}`}>{pane.title}</span>
        <PaneMenu title={pane.title} items={moveTargets} />
        <button
          type="button"
          className={styles.iconButton}
          aria-label={`Close ${pane.title}`}
          title="Close (returns it to its rail)"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </header>
      <div className={styles.paneBody}>{pane.content}</div>
      <div className={styles.floatResize} aria-hidden="true" onPointerDown={(e) => track(e, 'resize')} />
    </section>
  );
}
