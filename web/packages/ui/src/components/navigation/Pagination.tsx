'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import styles from './Pagination.module.css';

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  showFirstLast?: boolean;
  siblingCount?: number;
  showInfo?: boolean;
  totalItems?: number;
  pageSize?: number;
  className?: string;
}

function getPageRange(current: number, total: number, siblings: number): (number | 'ellipsis')[] {
  const range: (number | 'ellipsis')[] = [];

  if (total <= 7 + siblings * 2) {
    for (let i = 1; i <= total; i++) range.push(i);
    return range;
  }

  const leftBound = Math.max(2, current - siblings);
  const rightBound = Math.min(total - 1, current + siblings);

  range.push(1);
  if (leftBound > 2) range.push('ellipsis');
  for (let i = leftBound; i <= rightBound; i++) range.push(i);
  if (rightBound < total - 1) range.push('ellipsis');
  range.push(total);

  return range;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  showFirstLast = false,
  siblingCount = 1,
  showInfo = false,
  totalItems,
  pageSize,
  className = '',
}: PaginationProps) {
  const pages = getPageRange(page, totalPages, siblingCount);

  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label="Pagination"
      className={[styles.pagination, className].filter(Boolean).join(' ')}
    >
      {showFirstLast && (
        <button
          type="button"
          className={styles.btn}
          onClick={() => onPageChange(1)}
          disabled={page === 1}
          aria-label="Go to first page"
        >
          <ChevronsLeft size={16} />
        </button>
      )}
      <button
        type="button"
        className={styles.btn}
        onClick={() => onPageChange(page - 1)}
        disabled={page === 1}
        aria-label="Go to previous page"
      >
        <ChevronLeft size={16} />
      </button>

      {pages.map((p, i) =>
        p === 'ellipsis' ? (
          <span key={`ellipsis-${i}`} className={styles.ellipsis} aria-hidden="true">
            &hellip;
          </span>
        ) : (
          <button
            key={p}
            type="button"
            className={[styles.btn, page === p ? styles.active : ''].filter(Boolean).join(' ')}
            onClick={() => onPageChange(p)}
            aria-label={`Go to page ${p}`}
            aria-current={page === p ? 'page' : undefined}
          >
            {p}
          </button>
        )
      )}

      <button
        type="button"
        className={styles.btn}
        onClick={() => onPageChange(page + 1)}
        disabled={page === totalPages}
        aria-label="Go to next page"
      >
        <ChevronRight size={16} />
      </button>
      {showFirstLast && (
        <button
          type="button"
          className={styles.btn}
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages}
          aria-label="Go to last page"
        >
          <ChevronsRight size={16} />
        </button>
      )}
      {showInfo && totalItems !== undefined && pageSize !== undefined && (
        <span className={styles.info} aria-live="polite">
          {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalItems)} of {totalItems}
        </span>
      )}
    </nav>
  );
}
