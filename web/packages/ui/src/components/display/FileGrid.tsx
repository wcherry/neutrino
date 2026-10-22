'use client';

import React, { useState, useMemo } from 'react';
import {
  LayoutGrid,
  Grid3x3,
  AlignJustify,
  MoreVertical,
  Star,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { formatDateTime, formatFriendlyDate } from '@neutrino/utils';
import { Card, Text, FileListSkeleton, Badge } from '../../index';
import styles from './FileGrid.module.css';
import { useWindowedItems } from './useWindowedItems';

export type ViewMode = 'large' | 'small' | 'list';
export type SortField = 'name' | 'size' | 'createdAt' | 'updatedAt';
export type SortDir = 'asc' | 'desc';

/**
 * What the filter chips sort a drive into.
 *
 * Deliberately coarser than the app list in the sidebar. Docs, Sheets, Slides,
 * Notes, Diagrams, Drawings and Photos each already have a nav entry of their
 * own, so a chip per app filtered Drive by a cut the sidebar had already made —
 * and left the file types a drive actually fills up with (PDFs, archives,
 * source files) with no chip at all. These group by what a file *is* instead:
 * one for anything that plays or is looked at, one for the office suite, one
 * for the canvas apps, and one each for the loose types worth singling out.
 *
 * Every file lands in exactly one of these, so the chips partition the listing
 * rather than overlapping it. `other` is the remainder — no chip of its own,
 * reachable under All.
 *
 * The names are the backend's (`DriveFileType` in `src/drive/filesystem/dto.rs`),
 * so a chip can be sent as `?type=` without a translation table in between —
 * which is why the diagrams-and-drawings group is `canvas` rather than
 * `drawing`, a value the backend already uses for the drawing app alone.
 */
export type FileCategory = 'media' | 'office' | 'canvas' | 'pdf' | 'archive' | 'code' | 'other';

/** A category chip, plus All and Starred, which are not categories of file. */
export type FilterType = 'all' | Exclude<FileCategory, 'other'> | 'starred';

export interface GridItem {
  id: string;
  name: string;
  kind: 'file' | 'folder' | 'doc';
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
  iconColor: string;
  /** Shown below name in grid cards (e.g. "4.2 MB", "Folder") */
  subtitle?: string;
  /** Used for client-side filter matching */
  mimeType?: string;
  /** Short type label shown in list view Type column */
  typeText?: string;
  /** Formatted size for list view Size column */
  sizeText?: string;
  /** Formatted modified date for list view */
  modifiedText?: string;
  /**
   * When the item last changed, ISO-8601. Shown on the large card as a
   * friendly date ("Yesterday", "A week ago") — the card is scanned rather
   * than read, so it wants "is this the one I was working on?" answered, not a
   * date. The list view's Modified column keeps `modifiedText`, since a column
   * you sort by wants the real date. Trash passes its `deletedAt` here.
   */
  updatedAt?: string;
  isStarred?: boolean;
  /**
   * Ready-to-load URL of the item's cover thumbnail, shown in grid cards and
   * list rows when present.
   *
   * A URL rather than an inline data URI since issue #175: the bytes used to
   * ride along in the listing JSON, which made a grid of photos a multi-
   * megabyte response the browser had to re-download every time. Callers build
   * this with `driveApi.getThumbnailUrl(file.coverThumbnailUrl)`.
   */
  thumbnailUrl?: string | null;
}

const FILTER_CHIPS: { key: FilterType; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'media',   label: 'Media' },
  { key: 'office',  label: 'Office' },
  { key: 'canvas',  label: 'Drawings' },
  { key: 'pdf',     label: 'PDFs' },
  { key: 'archive', label: 'Archives' },
  { key: 'code',    label: 'Code' },
  { key: 'starred', label: 'Starred' },
];

/** Neutrino's own file types, which are all `application/x-neutrino-<app>`. */
const NEUTRINO_PREFIX = 'application/x-neutrino-';
const OFFICE_APPS = ['doc', 'sheet', 'slide', 'note'];
const CANVAS_APPS = ['diagram', 'drawing'];

/**
 * The rest is matched on substrings, because the same file arrives under
 * several MIME types depending on what uploaded it — a zip is `application/zip`
 * from one browser and `application/x-zip-compressed` from another — and an
 * exhaustive list of the spellings would be wrong the first time an unusual one
 * turned up. Order of the checks below is what keeps the hints from overlapping.
 */
const OFFICE_HINTS = ['officedocument', 'opendocument', 'msword', 'ms-excel', 'ms-powerpoint', 'spreadsheet', 'presentation'];
const OFFICE_MIMES = new Set(['application/rtf', 'text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values']);
const ARCHIVE_HINTS = ['zip', 'tar', 'rar', '7z', 'gzip', 'bzip', 'compressed'];
const CODE_HINTS = ['javascript', 'typescript', 'python', 'ruby', 'java', 'php', 'rust', 'json', 'yaml', 'xml', 'sql', 'x-sh', 'x-go', 'x-perl', 'x-swift'];
const CODE_MIMES = new Set(['text/css', 'text/html', 'text/x-c', 'text/x-c++src', 'text/x-csrc']);

/**
 * Which chip a file belongs under. Exactly one, and the first match wins, so
 * the order here is load-bearing: `.docx` is `…openxmlformats-officedocument…`,
 * which contains "xml" and would be Code if the office check came second.
 */
export function categorizeMime(mime: string): FileCategory {
  if (mime.startsWith(NEUTRINO_PREFIX)) {
    const app = mime.slice(NEUTRINO_PREFIX.length);
    if (OFFICE_APPS.includes(app)) return 'office';
    if (CANVAS_APPS.includes(app)) return 'canvas';
  }
  if (mime === 'application/pdf') return 'pdf';
  // Pictures, clips and sound are one chip: they are the things you scroll past
  // looking for, rather than three separate errands.
  if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')) return 'media';
  if (OFFICE_MIMES.has(mime) || OFFICE_HINTS.some((hint) => mime.includes(hint))) return 'office';
  if (ARCHIVE_HINTS.some((hint) => mime.includes(hint))) return 'archive';
  if (CODE_MIMES.has(mime) || CODE_HINTS.some((hint) => mime.includes(hint))) return 'code';
  return 'other';
}

function matchesFilter(item: GridItem, filter: FilterType): boolean {
  if (filter === 'all') return true;
  if (filter === 'starred') return !!item.isStarred;
  // Folders survive every chip: one may hold exactly what is being looked for,
  // and hiding them would make a filtered listing a dead end to navigate.
  if (item.kind === 'folder') return true;
  return categorizeMime(item.mimeType ?? '') === filter;
}

const VIEW_BUTTONS: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
  { mode: 'large', icon: <LayoutGrid size={15} />, label: 'Large grid' },
  { mode: 'small', icon: <Grid3x3 size={15} />, label: 'Small grid' },
  { mode: 'list',  icon: <AlignJustify size={15} />, label: 'Detailed list' },
];

const ALL_SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: 'name',      label: 'Name' },
  { field: 'updatedAt', label: 'Modified' },
  { field: 'createdAt', label: 'Created' },
  { field: 'size',      label: 'Size' },
];

function SortIndicator({ field, sortBy, sortDir }: { field: SortField; sortBy: SortField; sortDir: SortDir }) {
  if (field !== sortBy) return null;
  return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
}

/**
 * The line under a large card's name: what the item is, and when it last
 * changed. Both on one row so adding the date does not make every card taller,
 * with the exact timestamp on the tooltip for when the friendly one is too
 * vague to act on.
 */
function CardMeta({ subtitle, updatedAt }: { subtitle?: string; updatedAt?: string }) {
  const friendly = updatedAt ? formatFriendlyDate(updatedAt) : '';
  if (!subtitle && !friendly) return null;
  return (
    <div className={styles['card-meta']} title={friendly ? formatDateTime(updatedAt!) : undefined}>
      {subtitle && <Text size="xs" color="muted" truncate>{subtitle}</Text>}
      {subtitle && friendly && <span className={styles['card-meta-sep']} aria-hidden="true">·</span>}
      {friendly && <Text size="xs" color="muted" truncate>{friendly}</Text>}
    </div>
  );
}

/** Keyboard handler that activates an item on Enter or Space, matching button/link conventions. */
function handleItemKeyDown(e: React.KeyboardEvent, callback: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    callback();
  }
}

/**
 * What one rendered item needs. Each layout's item is memoised on exactly
 * this, so a change elsewhere on the page — opening a context menu, typing in
 * the search box — re-renders the list's shell and not every row in it.
 * Callers already pass stable `useCallback` handlers and memoised items; that
 * is what makes the comparison hold.
 */
interface ItemProps {
  item: GridItem;
  isSelected: boolean;
  /**
   * 1-based position in the whole listing, and its length. Only a window of
   * rows is in the DOM, so without these a screen reader would announce
   * "item 3 of 30" in a folder of a thousand.
   */
  position: number;
  setSize: number;
  onItemClick: (item: GridItem) => void;
  onItemSelect?: (item: GridItem) => void;
  onItemMenuOpen?: (item: GridItem, e: React.MouseEvent) => void;
  onToggleStar?: (item: GridItem) => void;
}

function itemClickHandler({ item, onItemClick, onItemSelect }: ItemProps) {
  return (e: React.MouseEvent) => {
    if ((e.metaKey || e.ctrlKey) && onItemSelect) { e.stopPropagation(); onItemSelect(item); }
    else onItemClick(item);
  };
}

function StarBadge({ item, onToggleStar, size }: { item: GridItem; onToggleStar?: (item: GridItem) => void; size: number }) {
  // Without `onToggleStar` the badge is only an indicator, so it is dropped
  // entirely for unstarred items (Trash, tag pages).
  if (!onToggleStar && !item.isStarred) return null;
  return (
    <button
      type="button"
      className={styles['star-badge']}
      data-starred={item.isStarred ? 'true' : undefined}
      aria-label={item.isStarred ? 'Remove from starred' : 'Add to starred'}
      onClick={onToggleStar ? (e) => { e.stopPropagation(); onToggleStar(item); } : undefined}
      style={onToggleStar ? undefined : { pointerEvents: 'none' }}
    >
      <Star
        size={size}
        style={{ color: item.isStarred ? 'var(--color-amber, #d97706)' : 'var(--color-text-muted)' }}
        fill={item.isStarred ? 'var(--color-amber, #d97706)' : 'none'}
      />
    </button>
  );
}

function ItemMenuButton({ item, onItemMenuOpen, size }: { item: GridItem; onItemMenuOpen: (item: GridItem, e: React.MouseEvent) => void; size: number }) {
  return (
    <button
      type="button"
      className={styles['item-menu-btn']}
      aria-label={`More options for ${item.name}`}
      onClick={(e) => { e.stopPropagation(); onItemMenuOpen(item, e); }}
    >
      <MoreVertical size={size} />
    </button>
  );
}

const LargeCard = React.memo(function LargeCard(props: ItemProps) {
  const { item, isSelected, onItemClick, onItemMenuOpen, onToggleStar } = props;
  const thumbSrc = item.thumbnailUrl ?? null;
  return (
    <Card
      hoverable
      padding="none"
      className={[styles['card-large'], isSelected ? styles['card--selected'] : ''].filter(Boolean).join(' ')}
      role="listitem"
      aria-posinset={props.position}
      aria-setsize={props.setSize}
      tabIndex={0}
      aria-label={item.name}
      aria-selected={isSelected}
      onClick={itemClickHandler(props)}
      onKeyDown={(e) => handleItemKeyDown(e, () => onItemClick(item))}
    >
      <div className={styles['preview-large']} style={{ color: item.iconColor }}>
        {thumbSrc
          ? <img src={thumbSrc} alt={item.name} className={styles['preview-thumb']} loading="lazy" />
          : <item.icon size={48} strokeWidth={1} />
        }
        <StarBadge item={item} onToggleStar={onToggleStar} size={14} />
      </div>
      <div className={styles['card-large-body']}>
        <Text size="sm" weight="medium" truncate>{item.name}</Text>
        <CardMeta subtitle={item.subtitle} updatedAt={item.updatedAt} />
      </div>
      {onItemMenuOpen && <ItemMenuButton item={item} onItemMenuOpen={onItemMenuOpen} size={14} />}
    </Card>
  );
});

const SmallCard = React.memo(function SmallCard(props: ItemProps) {
  const { item, isSelected, onItemClick, onItemMenuOpen, onToggleStar } = props;
  const thumbSrc = item.thumbnailUrl ?? null;
  return (
    <Card
      hoverable
      padding="none"
      className={[styles['card-small'], isSelected ? styles['card--selected'] : ''].filter(Boolean).join(' ')}
      role="listitem"
      aria-posinset={props.position}
      aria-setsize={props.setSize}
      tabIndex={0}
      aria-label={item.name}
      aria-selected={isSelected}
      onClick={itemClickHandler(props)}
      onKeyDown={(e) => handleItemKeyDown(e, () => onItemClick(item))}
    >
      <div className={styles['preview-small']} style={{ color: item.iconColor }}>
        {thumbSrc
          ? <img src={thumbSrc} alt={item.name} className={styles['preview-thumb']} loading="lazy" />
          : <item.icon size={28} strokeWidth={1.25} />
        }
        <StarBadge item={item} onToggleStar={onToggleStar} size={12} />
      </div>
      <div className={styles['card-small-body']}>
        <Text size="xs" weight="medium" truncate>{item.name}</Text>
      </div>
      {onItemMenuOpen && <ItemMenuButton item={item} onItemMenuOpen={onItemMenuOpen} size={12} />}
    </Card>
  );
});

const ListRow = React.memo(function ListRow(props: ItemProps & { listCols: string; showSizeColumn: boolean }) {
  const { item, isSelected, onItemClick, onItemMenuOpen, listCols, showSizeColumn } = props;
  const thumbSrc = item.thumbnailUrl ?? null;
  return (
    <div
      className={[styles['list-row'], isSelected ? styles['list-row--selected'] : ''].filter(Boolean).join(' ')}
      style={{ gridTemplateColumns: listCols }}
      role="listitem"
      aria-posinset={props.position}
      aria-setsize={props.setSize}
      tabIndex={0}
      aria-label={item.name}
      aria-selected={isSelected}
      onClick={itemClickHandler(props)}
      onKeyDown={(e) => handleItemKeyDown(e, () => onItemClick(item))}
    >
      <div className={styles['list-name']}>
        <span className={styles['file-icon-sm']} style={{ color: item.iconColor }}>
          {thumbSrc
            ? <img src={thumbSrc} alt="" className={styles['list-thumb']} loading="lazy" />
            : <item.icon size={18} strokeWidth={1.5} />
          }
        </span>
        <Text size="sm" truncate>{item.name}</Text>
        {item.isStarred && <Star size={12} style={{ color: 'var(--color-amber, #d97706)', flexShrink: 0 }} />}
      </div>
      <Text size="sm" color="muted">{item.typeText ?? '—'}</Text>
      {showSizeColumn && <Text size="sm" color="muted">{item.sizeText ?? '—'}</Text>}
      <Text size="sm" color="muted">{item.modifiedText ?? '—'}</Text>
      {onItemMenuOpen ? <ItemMenuButton item={item} onItemMenuOpen={onItemMenuOpen} size={14} /> : <span />}
    </div>
  );
});

/** The `minmax()` minimums in FileGrid.module.css — kept beside the CSS they mirror. */
const LARGE_MIN_COLUMN = 180;
const SMALL_MIN_COLUMN = 110;

export interface FileGridProps {
  items: GridItem[];
  isLoading?: boolean;
  isError?: boolean;
  /** Shown when items is empty or isError */
  emptyState?: React.ReactNode;
  onItemClick: (item: GridItem) => void;
  /** If provided, a three-dot menu button appears on hover */
  onItemMenuOpen?: (item: GridItem, e: React.MouseEvent) => void;
  /** If provided, the star badge is clickable and calls this handler */
  onToggleStar?: (item: GridItem) => void;
  /** Show type-filter chips above the grid (default: false) */
  showFilter?: boolean;
  /**
   * The selected chip. Pass it with `onFilterChange` to own the filter — which
   * is what a caller does to answer it from the server (`?type=`) rather than
   * over the page it has already loaded. Omit both and the grid keeps the chip.
   */
  filter?: FilterType;
  onFilterChange?: (filter: FilterType) => void;
  /** Show Size column and Size sort option (default: true) */
  showSizeColumn?: boolean;
  sortBy: SortField;
  sortDir: SortDir;
  onSortChange: (field: SortField, dir: SortDir) => void;
  defaultViewMode?: ViewMode;
  /**
   * The view, for a caller that owns it (a remembered default view, which can change under the
   * grid when another device saves one). Omitted, the grid keeps its own, starting at
   * `defaultViewMode`.
   */
  viewMode?: ViewMode;
  /** The user picked a view — for a caller that remembers it (`listing.views`, `teamSpace.view`). */
  onViewModeChange?: (mode: ViewMode) => void;
  totalCount?: number;
  /** Drag-and-drop handlers — wire these up to make the grid a drop target */
  onDragEnter?: React.DragEventHandler<HTMLDivElement>;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDragLeave?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
  isDraggingOver?: boolean;
  /** IDs of currently selected items for bulk mode */
  selectedIds?: Set<string>;
  /** Called when the user Cmd/Ctrl+clicks an item to toggle its selection */
  onItemSelect?: (item: GridItem) => void;
  /**
   * Rendered after the last item, inside the scrolling container — that is
   * where an infinite-scroll sentinel has to sit, since the detailed list
   * scrolls itself rather than the page.
   */
  footer?: React.ReactNode;
}

export function FileGrid({
  items,
  isLoading,
  isError,
  emptyState,
  onItemClick,
  onItemMenuOpen,
  onToggleStar,
  showFilter = false,
  filter: filterProp,
  onFilterChange,
  showSizeColumn = true,
  sortBy,
  sortDir,
  onSortChange,
  defaultViewMode = 'large',
  viewMode: viewModeProp,
  onViewModeChange,
  totalCount,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  isDraggingOver,
  selectedIds,
  onItemSelect,
  footer,
}: FileGridProps) {
  const [ownViewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
  const viewMode = viewModeProp ?? ownViewMode;
  const [uncontrolledFilter, setUncontrolledFilter] = useState<FilterType>('all');
  const filter = filterProp ?? uncontrolledFilter;

  // Still run when the caller filtered server-side. The two answers are the same
  // one — `categorizeMime` and the backend's `MimeFilter` are the same table —
  // so it costs a pass over one page, and it is the only filter the items that
  // never came from that endpoint get: search hits, and `starred`, which is a
  // property of the row rather than a kind of file.
  const filteredItems = useMemo(
    () => (showFilter ? items.filter((item) => matchesFilter(item, filter)) : items),
    [items, showFilter, filter]
  );
  const sortOptions = showSizeColumn ? ALL_SORT_OPTIONS : ALL_SORT_OPTIONS.filter((o) => o.field !== 'size');
  const listCols = showSizeColumn ? '1fr 64px 96px 140px 40px' : '1fr 64px 140px 40px';

  // Only the rows on screen are rendered; see useWindowedItems.
  const { ref: windowRef, range } = useWindowedItems({
    count: filteredItems.length,
    minColumnWidth: viewMode === 'large' ? LARGE_MIN_COLUMN : viewMode === 'small' ? SMALL_MIN_COLUMN : undefined,
    layoutKey: viewMode,
  });
  const visibleItems = filteredItems.slice(range.start, range.end);
  const windowStyle = { paddingTop: range.padTop, paddingBottom: range.padBottom };
  const itemProps = (item: GridItem, offset: number): ItemProps => ({
    item,
    isSelected: selectedIds?.has(item.id) ?? false,
    position: range.start + offset + 1,
    setSize: filteredItems.length,
    onItemClick,
    onItemSelect,
    onItemMenuOpen,
    onToggleStar,
  });

  function handleSort(field: SortField) {
    onSortChange(field, sortBy === field ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc');
  }

  const toolbar = (
    <div className={styles.toolbar}>
      <div className={styles['toolbar-left']}>
        {totalCount != null && (
          <Badge variant="default" size="sm">{totalCount} items</Badge>
        )}
        {viewMode !== 'list' && (
          <div className={styles['sort-bar']}>
            <span className={styles['sort-label']}>Sort:</span>
            {sortOptions.map(({ field, label }) => (
              <button
                key={field}
                type="button"
                className={[styles['sort-btn'], sortBy === field ? styles['sort-btn-active'] : ''].filter(Boolean).join(' ')}
                onClick={() => handleSort(field)}
              >
                {label}
                <SortIndicator field={field} sortBy={sortBy} sortDir={sortDir} />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={styles['view-toggle']} role="group" aria-label="View mode">
        {VIEW_BUTTONS.map(({ mode, icon, label }) => (
          <button
            key={mode}
            type="button"
            className={[styles['view-btn'], viewMode === mode ? styles['view-btn-active'] : ''].filter(Boolean).join(' ')}
            onClick={() => { setViewMode(mode); onViewModeChange?.(mode); }}
            aria-label={label}
            aria-pressed={viewMode === mode}
            title={label}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );

  const rootClass = [styles.root, isDraggingOver ? styles['root--drag-over'] : ''].filter(Boolean).join(' ');
  const dragProps = { onDragEnter, onDragOver, onDragLeave, onDrop };

  if (isLoading) {
    return (
      <div className={rootClass} {...dragProps}>
        {toolbar}
        <div className={styles['list-container']}>
          <FileListSkeleton rows={8} />
        </div>
      </div>
    );
  }

  return (
    <div className={rootClass} {...dragProps}>
      {toolbar}

      {showFilter && (
        <div className={styles['filter-bar']} role="group" aria-label="Filter files">
          {FILTER_CHIPS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={[styles['filter-chip'], filter === key ? styles['filter-chip-active'] : ''].filter(Boolean).join(' ')}
              onClick={() => { setUncontrolledFilter(key); onFilterChange?.(key); }}
              aria-pressed={filter === key}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {(isError || filteredItems.length === 0) ? (
        <>
          {emptyState ?? null}
          {/* Still shown when a filter hides every loaded item, so scrolling
              can reach the pages that do match. */}
          {!isError && footer}
        </>
      ) : viewMode === 'large' ? (
        /* ── Large grid ── */
        <>
          <div ref={windowRef} className={styles['grid-large']} role="list" style={windowStyle}>
            {visibleItems.map((item, i) => <LargeCard key={item.id} {...itemProps(item, i)} />)}
          </div>
          {/* After the grid, not inside it: the rows below the window are
              padding, and an infinite-scroll sentinel inside the grid would sit
              above that padding — always near the viewport, loading every page. */}
          {footer && <div className={styles['grid-footer']}>{footer}</div>}
        </>
      ) : viewMode === 'small' ? (
        /* ── Small grid ── */
        <>
          <div ref={windowRef} className={styles['grid-small']} role="list" style={windowStyle}>
            {visibleItems.map((item, i) => <SmallCard key={item.id} {...itemProps(item, i)} />)}
          </div>
          {footer && <div className={styles['grid-footer']}>{footer}</div>}
        </>
      ) : (
        /* ── Detailed list ── */
        <div className={styles['list-container']}>
          <div className={styles['list-header']} style={{ gridTemplateColumns: listCols }}>
            <button
              type="button"
              className={[styles['list-col-btn'], sortBy === 'name' ? styles['list-col-active'] : ''].filter(Boolean).join(' ')}
              onClick={() => handleSort('name')}
            >
              <Text size="xs" color="muted" weight="semibold">Name</Text>
              <SortIndicator field="name" sortBy={sortBy} sortDir={sortDir} />
            </button>
            <Text size="xs" color="muted" weight="semibold">Type</Text>
            {showSizeColumn && (
              <button
                type="button"
                className={[styles['list-col-btn'], sortBy === 'size' ? styles['list-col-active'] : ''].filter(Boolean).join(' ')}
                onClick={() => handleSort('size')}
              >
                <Text size="xs" color="muted" weight="semibold">Size</Text>
                <SortIndicator field="size" sortBy={sortBy} sortDir={sortDir} />
              </button>
            )}
            <button
              type="button"
              className={[styles['list-col-btn'], sortBy === 'updatedAt' ? styles['list-col-active'] : ''].filter(Boolean).join(' ')}
              onClick={() => handleSort('updatedAt')}
            >
              <Text size="xs" color="muted" weight="semibold">Modified</Text>
              <SortIndicator field="updatedAt" sortBy={sortBy} sortDir={sortDir} />
            </button>
            <span />
          </div>
          <div ref={windowRef} role="list" style={windowStyle}>
            {visibleItems.map((item, i) => (
              <ListRow key={item.id} {...itemProps(item, i)} listCols={listCols} showSizeColumn={showSizeColumn} />
            ))}
          </div>
          {footer}
        </div>
      )}
    </div>
  );
}
