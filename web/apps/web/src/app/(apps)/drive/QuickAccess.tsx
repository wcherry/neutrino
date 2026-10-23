'use client';

import React from 'react';
import { formatFriendlyDate } from '@neutrino/utils';
import type { FileItem } from '@/lib/api';
import { storageApi } from '@/lib/api';
import { getFileIcon, getIconColor } from '@/lib/file-icons';
import styles from './QuickAccess.module.css';

/**
 * Quick access in the new looks (look-and-feel roadmap §5, Drive): the four files most recently
 * worked on, as preview cards — what someone opening Drive most often wants next. A real thumbnail
 * when the file has one; otherwise a page drawn in the file's app colour, which is enough to tell a
 * document from a spreadsheet at a glance without decrypting anything to render it.
 *
 * Classic keeps its "Recently starred" row (the Drive page decides which to show).
 */
export function QuickAccess({
  files,
  loading,
  onOpen,
}: {
  files: FileItem[] | undefined;
  loading: boolean;
  onOpen: (file: FileItem) => void;
}) {
  return (
    <section className={styles.region} aria-labelledby="quick-access-heading">
      <h2 id="quick-access-heading" className={styles.heading}>Quick access</h2>
      <div className={styles.grid}>
        {loading && !files
          ? Array.from({ length: 4 }, (_, i) => <div key={i} className={styles.skeleton} aria-hidden="true" />)
          : !files || files.length === 0
            ? <p className={styles.empty}>Files you open and edit appear here.</p>
            : files.slice(0, 4).map((file) => {
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
                        <span className={styles.when}>Edited · {formatFriendlyDate(file.updatedAt)}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
      </div>
    </section>
  );
}
