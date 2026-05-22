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
import { Card, Text, FileListSkeleton, Badge } from '../../index';
import styles from './FileGrid.module.css';

export type ViewMode = 'large' | 'small' | 'list';
export type SortField = 'name' | 'size' | 'createdAt' | 'updatedAt';
export type SortDir = 'asc' | 'desc';
export type FilterType = 'all' | 'image' | 'video' | 'audio' | 'document' | 'archive' | 'starred';

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
  isStarred?: boolean;
  /** Base64-encoded cover thumbnail, shown in grid cards when available */
  coverThumbnail?: string | null;
  coverThumbnailMimeType?: string | null;
}

const FILTER_CHIPS: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'image', label: 'Images' },
  { key: 'video', label: 'Videos' },
  { key: 'audio', label: 'Audio' },
  { key: 'document', label: 'Documents' },
  { key: 'archive', label: 'Archives' },
  { key: 'starred', label: 'Starred' },
];

function matchesFilter(item: GridItem, filter: FilterType): boolean {
  if (filter === 'all') return true;
  if (filter === 'starred') return !!item.isStarred;
  const mime = item.mimeType ?? '';
  if (filter === 'image') return mime.startsWith('image/');
  if (filter === 'video') return mime.startsWith('video/');
  if (filter === 'audio') return mime.startsWith('audio/');
  if (filter === 'archive') return mime.includes('zip') || mime.includes('tar') || mime.includes('rar');
  if (filter === 'document') return mime.includes('text') || mime.includes('document') || mime.includes('pdf');
  return true;
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

/** Keyboard handler that activates an item on Enter or Space, matching button/link conventions. */
function handleItemKeyDown(e: React.KeyboardEvent, callback: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    callback();
  }
}

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
  /** Show Size column and Size sort option (default: true) */
  showSizeColumn?: boolean;
  sortBy: SortField;
  sortDir: SortDir;
  onSortChange: (field: SortField, dir: SortDir) => void;
  defaultViewMode?: ViewMode;
  totalCount?: number;
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
  showSizeColumn = true,
  sortBy,
  sortDir,
  onSortChange,
  defaultViewMode = 'large',
  totalCount,
}: FileGridProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
  const [filter, setFilter] = useState<FilterType>('all');

  const filteredItems = useMemo(
    () => (showFilter ? items.filter((item) => matchesFilter(item, filter)) : items),
    [items, showFilter, filter]
  );
  const sortOptions = showSizeColumn ? ALL_SORT_OPTIONS : ALL_SORT_OPTIONS.filter((o) => o.field !== 'size');
  const listCols = showSizeColumn ? '1fr 64px 96px 140px 40px' : '1fr 64px 140px 40px';

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
            onClick={() => setViewMode(mode)}
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

  if (isLoading) {
    return (
      <div className={styles.root}>
        {toolbar}
        <div className={styles['list-container']}>
          <FileListSkeleton rows={8} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {toolbar}

      {showFilter && (
        <div className={styles['filter-bar']} role="group" aria-label="Filter files">
          {FILTER_CHIPS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={[styles['filter-chip'], filter === key ? styles['filter-chip-active'] : ''].filter(Boolean).join(' ')}
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {(isError || filteredItems.length === 0) ? (
        emptyState ?? null
      ) : viewMode === 'large' ? (
        /* ── Large grid ── */
        <div className={styles['grid-large']} role="list">
          {filteredItems.map((item) => {
            const thumbSrc = item.coverThumbnail && item.coverThumbnailMimeType
              ? `data:${item.coverThumbnailMimeType};base64,${item.coverThumbnail}`
              : null;
            return (
            <Card
              key={item.id}
              hoverable
              padding="none"
              className={styles['card-large']}
              role="listitem"
              tabIndex={0}
              aria-label={item.name}
              onClick={() => onItemClick(item)}
              onKeyDown={(e) => handleItemKeyDown(e, () => onItemClick(item))}
            >
              <div className={styles['preview-large']} style={{ color: item.iconColor }}>
                {thumbSrc
                  ? <img src={thumbSrc} alt={item.name} className={styles['preview-thumb']} loading="lazy" />
                  : <item.icon size={48} strokeWidth={1} />
                }
                <button
                  type="button"
                  className={styles['star-badge']}
                  data-starred={item.isStarred ? 'true' : undefined}
                  aria-label={item.isStarred ? 'Remove from starred' : 'Add to starred'}
                  onClick={onToggleStar ? (e) => { e.stopPropagation(); onToggleStar(item); } : undefined}
                  style={onToggleStar ? undefined : { pointerEvents: 'none' }}
                >
                  <Star
                    size={14}
                    style={{ color: item.isStarred ? 'var(--color-amber, #d97706)' : 'var(--color-text-muted)' }}
                    fill={item.isStarred ? 'var(--color-amber, #d97706)' : 'none'}
                  />
                </button>
              </div>
              <div className={styles['card-large-body']}>
                <Text size="sm" weight="medium" truncate>{item.name}</Text>
                {item.subtitle && <Text size="xs" color="muted">{item.subtitle}</Text>}
              </div>
              {onItemMenuOpen && (
                <button
                  type="button"
                  className={styles['item-menu-btn']}
                  aria-label={`More options for ${item.name}`}
                  onClick={(e) => { e.stopPropagation(); onItemMenuOpen(item, e); }}
                >
                  <MoreVertical size={14} />
                </button>
              )}
            </Card>
          ); })}
        </div>
      ) : viewMode === 'small' ? (
        /* ── Small grid ── */
        <div className={styles['grid-small']} role="list">
          {filteredItems.map((item) => {
            const thumbSrc = item.coverThumbnail && item.coverThumbnailMimeType
              ? `data:${item.coverThumbnailMimeType};base64,${item.coverThumbnail}`
              : null;
            return (
            <Card
              key={item.id}
              hoverable
              padding="none"
              className={styles['card-small']}
              role="listitem"
              tabIndex={0}
              aria-label={item.name}
              onClick={() => onItemClick(item)}
              onKeyDown={(e) => handleItemKeyDown(e, () => onItemClick(item))}
            >
              <div className={styles['preview-small']} style={{ color: item.iconColor }}>
                {thumbSrc
                  ? <img src={thumbSrc} alt={item.name} className={styles['preview-thumb']} loading="lazy" />
                  : <item.icon size={28} strokeWidth={1.25} />
                }
                <button
                  type="button"
                  className={styles['star-badge']}
                  data-starred={item.isStarred ? 'true' : undefined}
                  aria-label={item.isStarred ? 'Remove from starred' : 'Add to starred'}
                  onClick={onToggleStar ? (e) => { e.stopPropagation(); onToggleStar(item); } : undefined}
                  style={onToggleStar ? undefined : { pointerEvents: 'none' }}
                >
                  <Star
                    size={12}
                    style={{ color: item.isStarred ? 'var(--color-amber, #d97706)' : 'var(--color-text-muted)' }}
                    fill={item.isStarred ? 'var(--color-amber, #d97706)' : 'none'}
                  />
                </button>
              </div>
              <div className={styles['card-small-body']}>
                <Text size="xs" weight="medium" truncate>{item.name}</Text>
              </div>
              {onItemMenuOpen && (
                <button
                  type="button"
                  className={styles['item-menu-btn']}
                  aria-label={`More options for ${item.name}`}
                  onClick={(e) => { e.stopPropagation(); onItemMenuOpen(item, e); }}
                >
                  <MoreVertical size={12} />
                </button>
              )}
            </Card>
          ); })}
        </div>
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
          <div role="list">
            {filteredItems.map((item) => {
              const thumbSrc = item.coverThumbnail && item.coverThumbnailMimeType
                ? `data:${item.coverThumbnailMimeType};base64,${item.coverThumbnail}`
                : null;
              return (
              <div
                key={item.id}
                className={styles['list-row']}
                style={{ gridTemplateColumns: listCols }}
                role="listitem"
                tabIndex={0}
                aria-label={item.name}
                onClick={() => onItemClick(item)}
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
                {onItemMenuOpen ? (
                  <button
                    type="button"
                    className={styles['item-menu-btn']}
                    aria-label={`More options for ${item.name}`}
                    onClick={(e) => { e.stopPropagation(); onItemMenuOpen(item, e); }}
                  >
                    <MoreVertical size={14} />
                  </button>
                ) : <span />}
              </div>
              ); })}
          </div>
        </div>
      )}
    </div>
  );
}
