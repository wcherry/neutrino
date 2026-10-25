'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { formatFriendlyDate } from '@neutrino/utils';
import type { FileItem } from '@/lib/api';
import { storageApi } from '@/lib/api';
import { getFileIcon, getIconColor } from '@/lib/file-icons';
import type { QuickAccessEntry } from '@/hooks/useQuickAccess';
import styles from './QuickAccess.module.css';

/**
 * Quick access (look-and-feel roadmap §5, Drive): the files most likely wanted next, as preview
 * cards — the same list in every look, which `useQuickAccess` decides. A real thumbnail when the
 * file has one; otherwise a page drawn in the file's app colour, which is enough to tell a document
 * from a spreadsheet at a glance without decrypting anything to render it.
 *
 * Up to twelve cards in one row that scrolls sideways. The arrows beside the heading page it by
 * what is visible. Both show whenever the row overflows, and an arrow with nothing on its side is
 * disabled rather than removed, so the other one never moves under the pointer.
 */
export function QuickAccess({
  entries,
  loading,
  onOpen,
}: {
  entries: QuickAccessEntry[] | undefined;
  loading: boolean;
  onOpen: (file: FileItem) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    // A pixel of slack: fractional widths leave scrollLeft a hair short of the end.
    const left = row.scrollLeft > 1;
    const right = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
    setCanScroll((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    measure();
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [measure, entries]);

  const page = (direction: -1 | 1) => {
    const row = rowRef.current;
    if (!row) return;
    row.scrollBy({ left: direction * row.clientWidth * 0.9, behavior: 'smooth' });
  };

  return (
    <section className={styles.region} aria-labelledby="quick-access-heading" data-tour="quick-access">
      <div className={styles.header}>
        <h2 id="quick-access-heading" className={styles.heading}>Quick access</h2>
        {(canScroll.left || canScroll.right) && (
          <>
            <button
              type="button"
              className={styles.arrow}
              onClick={() => page(-1)}
              disabled={!canScroll.left}
              aria-label="Scroll Quick access left"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.arrow}
              onClick={() => page(1)}
              disabled={!canScroll.right}
              aria-label="Scroll Quick access right"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      <div className={styles.row} ref={rowRef} onScroll={measure} data-testid="quick-access-row">
        {loading && !entries
          ? Array.from({ length: 4 }, (_, i) => <div key={i} className={styles.skeleton} aria-hidden="true" />)
          : !entries || entries.length === 0
            ? <p className={styles.empty}>Files you edit or star appear here.</p>
            : entries.map(({ file, reason }) => {
                const Icon = getFileIcon(file.mimeType);
                const tint = getIconColor(file.mimeType);
                const thumb = storageApi.getThumbnailUrl(file.coverThumbnailUrl);
                return (
                  <button
                    key={file.id}
                    type="button"
                    className={styles.card}
                    onClick={() => onOpen(file)}
                    aria-label={`Open ${file.name}`}
                  >
                    <span className={styles.preview} aria-hidden="true">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a static export has no image optimiser
                        <img src={thumb} alt="" className={styles.thumb} loading="lazy" />
                      ) : (
                        <span className={styles.paper}>
                          <span className={styles.titleLine} style={{ background: tint }} />
                          <span className={styles.line} data-w="92" />
                          <span className={styles.line} data-w="80" />
                          <span className={styles.line} data-w="66" />
                        </span>
                      )}
                    </span>
                    <span className={styles.meta}>
                      <span style={{ color: tint }} className={styles.icon}><Icon size={18} strokeWidth={1.8} /></span>
                      <span className={styles.text}>
                        <span className={styles.name}>{file.name}</span>
                        <span className={styles.when}>
                          {reason === 'starred' && <Star size={11} className={styles.star} aria-label="Starred" />}
                          Edited · {formatFriendlyDate(file.updatedAt)}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
      </div>
    </section>
  );
}
