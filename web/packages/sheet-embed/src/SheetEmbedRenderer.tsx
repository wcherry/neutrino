'use client';

import React, { useEffect } from 'react';
import { useSheetEmbed } from './useSheetEmbed';
import type { SheetEmbedAttrsShape, CellValue } from './types';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmbedTable({ rows }: { rows: CellValue[][] }) {
  if (rows.length === 0) return <p style={styles.emptyNote}>No data</p>;
  return (
    <div style={styles.tableWrapper} data-testid="sheet-embed-table">
      <table style={styles.table}>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={styles.cell}>
                  {cell !== null && cell !== undefined ? String(cell) : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div style={styles.skeletonWrapper} aria-label="Loading sheet data">
      {[1, 2, 3].map((i) => (
        <div key={i} style={styles.skeletonRow}>
          {[1, 2, 3, 4].map((j) => (
            <div key={j} style={styles.skeletonCell} />
          ))}
        </div>
      ))}
    </div>
  );
}

interface DeletedStateProps {
  onConvertToStatic: () => void;
  onRemove: () => void;
  hasCachedData: boolean;
}

function DeletedState({ onConvertToStatic, onRemove, hasCachedData }: DeletedStateProps) {
  return (
    <div style={styles.errorBox} role="alert" data-testid="sheet-embed-deleted-state">
      <p style={styles.errorMsg}>
        This sheet has been deleted.
      </p>
      <div style={styles.errorActions}>
        {hasCachedData && (
          <button style={styles.actionBtn} onClick={onConvertToStatic} data-testid="sheet-embed-convert-btn">
            Convert to static table
          </button>
        )}
        <button style={{ ...styles.actionBtn, ...styles.removeBtn }} onClick={onRemove} data-testid="sheet-embed-remove-btn">
          Remove embed
        </button>
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={styles.errorBox} role="alert">
      <p style={styles.errorMsg}>Could not load sheet data.</p>
      <button style={styles.actionBtn} onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

function StaleBanner() {
  return (
    <div style={styles.staleBanner} role="status" data-testid="sheet-embed-stale-banner">
      Sheet data may be outdated.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface SheetEmbedRendererProps {
  attrs: SheetEmbedAttrsShape;
  /** Called after a successful refresh; caller should persist the updated
   *  cachedData and cachedAt in the document node. */
  onCacheUpdate?: (cachedData: CellValue[][], cachedAt: string) => void;
  /** Called when the user chooses "Convert to static table". */
  onConvertToStatic?: (cachedData: CellValue[][]) => void;
  /** Called when the user chooses "Remove embed". */
  onRemove?: () => void;
  /** When true, the component triggers a live fetch on mount (default: true). */
  autoFetch?: boolean;
}

export function SheetEmbedRenderer({
  attrs,
  onCacheUpdate,
  onConvertToStatic,
  onRemove,
  autoFetch = true,
}: SheetEmbedRendererProps) {
  const { status, rows, fetchedAt, refresh } = useSheetEmbed(attrs);

  useEffect(() => {
    if (autoFetch && status === 'idle') {
      refresh().then((result) => {
        if (result && onCacheUpdate) {
          onCacheUpdate(result.rows, result.fetchedAt);
        }
      });
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCheckForUpdates = async () => {
    const result = await refresh();
    if (result && onCacheUpdate) {
      onCacheUpdate(result.rows, result.fetchedAt);
    }
  };

  const handleConvert = () => {
    const data = rows ?? attrs.cachedData;
    if (data && onConvertToStatic) {
      onConvertToStatic(data);
    }
  };

  const hasCachedData = !!(rows ?? attrs.cachedData)?.length;

  // Format the fetchedAt timestamp as a relative "X ago" string
  const lastUpdatedLabel = (() => {
    const ts = fetchedAt ?? attrs.cachedAt;
    if (!ts) return null;
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  })();

  if (status === 'deleted') {
    return (
      <div style={styles.wrapper} data-testid="sheet-embed">
        <div style={styles.header}>
          <span style={styles.label}>{attrs.title ?? 'Live sheet embed'}</span>
        </div>
        <DeletedState
          onConvertToStatic={handleConvert}
          onRemove={onRemove ?? (() => {})}
          hasCachedData={hasCachedData}
        />
      </div>
    );
  }

  if (status === 'error' && !rows) {
    return (
      <div style={styles.wrapper} data-testid="sheet-embed">
        <div style={styles.header}>
          <span style={styles.label}>{attrs.title ?? 'Live sheet embed'}</span>
        </div>
        <ErrorState onRetry={handleCheckForUpdates} />
      </div>
    );
  }

  return (
    <div style={styles.wrapper} data-testid="sheet-embed">
      {/* Header bar */}
      <div style={styles.header}>
        <span style={styles.label}>{attrs.title ?? 'Live sheet embed'}</span>
        <div style={styles.headerActions}>
          {lastUpdatedLabel && (
            <span style={styles.fetchedAt} title={fetchedAt ?? attrs.cachedAt ?? ''} data-testid="sheet-embed-last-updated">
              Last updated: {lastUpdatedLabel}
            </span>
          )}
          <button
            style={styles.refreshBtn}
            onClick={handleCheckForUpdates}
            disabled={status === 'loading'}
            title="Check for updates"
            aria-label="Refresh embed data"
            data-testid="sheet-embed-refresh-btn"
          >
            {status === 'loading' ? '…' : '↻'}
          </button>
        </div>
      </div>

      {/* Stale warning */}
      {status === 'stale' && <StaleBanner />}

      {/* Content */}
      {status === 'loading' && !rows && <SkeletonRows />}
      {status === 'error' && rows && (
        <div style={styles.inlineError}>Failed to refresh. Showing cached data.</div>
      )}
      {rows && <EmbedTable rows={rows} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    border: '1px solid var(--color-border, #e0e0e0)',
    borderRadius: 6,
    overflow: 'hidden',
    fontFamily: 'inherit',
    fontSize: 13,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    background: 'var(--color-surface-raised, #f5f5f5)',
    borderBottom: '1px solid var(--color-border, #e0e0e0)',
    gap: 8,
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--color-text-secondary, #666)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  fetchedAt: {
    fontSize: 11,
    color: 'var(--color-text-secondary, #999)',
  },
  refreshBtn: {
    fontSize: 14,
    width: 24,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    border: '1px solid var(--color-border, #ccc)',
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--color-text, #333)',
    padding: 0,
    lineHeight: 1,
  },
  tableWrapper: {
    overflowX: 'auto',
  },
  table: {
    borderCollapse: 'collapse',
    width: '100%',
    minWidth: 200,
  },
  cell: {
    border: '1px solid var(--color-border, #e0e0e0)',
    padding: '4px 8px',
    whiteSpace: 'nowrap',
    maxWidth: 240,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  skeletonWrapper: {
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  skeletonRow: {
    display: 'flex',
    gap: 6,
  },
  skeletonCell: {
    flex: 1,
    height: 20,
    borderRadius: 3,
    background: 'var(--color-border, #e0e0e0)',
    opacity: 0.7,
  },
  staleBanner: {
    padding: '4px 10px',
    background: 'var(--color-surface-warning, #fff8e1)',
    borderBottom: '1px solid var(--color-warning, #f9a825)',
    fontSize: 11,
    color: 'var(--color-text-secondary, #666)',
  },
  errorBox: {
    padding: '12px 16px',
    background: 'var(--color-surface-error, #fff3f3)',
    borderTop: '3px solid var(--color-error, #d93025)',
  },
  errorMsg: {
    margin: '0 0 10px',
    color: 'var(--color-text, #333)',
    fontSize: 13,
  },
  errorActions: {
    display: 'flex',
    gap: 8,
  },
  actionBtn: {
    fontSize: 12,
    padding: '4px 12px',
    borderRadius: 4,
    border: '1px solid var(--color-border, #ccc)',
    background: 'var(--color-surface-raised, #f5f5f5)',
    cursor: 'pointer',
    color: 'var(--color-text, #333)',
  },
  removeBtn: {
    borderColor: 'var(--color-error, #d93025)',
    color: 'var(--color-error, #d93025)',
  },
  emptyNote: {
    padding: '12px 16px',
    color: 'var(--color-text-secondary, #999)',
    margin: 0,
    fontSize: 13,
  },
  inlineError: {
    padding: '4px 10px',
    background: 'var(--color-surface-error, #fff3f3)',
    fontSize: 11,
    color: 'var(--color-error, #d93025)',
    borderBottom: '1px solid var(--color-border, #e0e0e0)',
  },
};
