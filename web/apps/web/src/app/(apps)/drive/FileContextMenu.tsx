'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Eye, Info, Pencil, Star, StarOff, Download, Trash2, Link, Share2, FolderInput, FileCog } from 'lucide-react';
import { type FileItem } from '@/lib/api';
import { officeAppForFile, type OfficeApp } from '@/lib/officeFormats';
import styles from './FileContextMenu.module.css';

const CONVERT_LABEL: Record<OfficeApp, string> = {
  docs: 'Convert to Neutrino Doc',
  sheets: 'Convert to Neutrino Sheet',
  slides: 'Convert to Neutrino Slide',
};

interface Props {
  file: FileItem;
  x: number;
  y: number;
  onClose: () => void;
  onPreview?: () => void;
  onInfo: () => void;
  onRename: () => void;
  onStarToggle: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onCopyLink: () => void;
  onShare: () => void;
  onMove: () => void;
  /** Present only when `file` is a raw, not-yet-promoted office file and the
   *  office-in-place-editing flag is on (issue #43). */
  onConvert?: () => void;
}

export function FileContextMenu({
  file,
  x,
  y,
  onClose,
  onPreview,
  onInfo,
  onRename,
  onStarToggle,
  onDownload,
  onDelete,
  onCopyLink,
  onShare,
  onMove,
  onConvert,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  // After first render, measure actual dimensions and clamp within viewport.
  useLayoutEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const clampedX = Math.min(x, window.innerWidth - width - 4);
    const clampedY = Math.min(y, window.innerHeight - height - 4);
    setPos({ x: Math.max(4, clampedX), y: Math.max(4, clampedY) });
  }, [x, y]);

  const convertApp = onConvert ? officeAppForFile(file.mimeType, file.name) : null;

  const items = [
    ...(onPreview ? [{ icon: <Eye size={14} />, label: 'Preview', action: onPreview }] : []),
    { icon: <Info size={14} />, label: 'File info', action: onInfo },
    { icon: <Share2 size={14} />, label: 'Share', action: onShare },
    { icon: <Pencil size={14} />, label: 'Rename', action: onRename },
    {
      icon: file.isStarred ? <StarOff size={14} /> : <Star size={14} />,
      label: file.isStarred ? 'Remove star' : 'Star',
      action: onStarToggle,
    },
    { icon: <Link size={14} />, label: 'Copy link', action: onCopyLink },
    { icon: <FolderInput size={14} />, label: 'Move to', action: onMove },
    { icon: <Download size={14} />, label: 'Download', action: onDownload },
    ...(convertApp && onConvert
      ? [{ icon: <FileCog size={14} />, label: CONVERT_LABEL[convertApp], action: onConvert }]
      : []),
    null,
    { icon: <Trash2 size={14} />, label: 'Move to trash', action: onDelete, danger: true },
  ] as const;

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      aria-label="File options"
    >
      {items.map((item, i) =>
        item === null ? (
          <div key={i} className={styles.separator} role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            className={[styles.item, 'danger' in item && item.danger ? styles.danger : '']
              .filter(Boolean)
              .join(' ')}
            role="menuitem"
            onClick={() => {
              item.action();
              onClose();
            }}
          >
            <span className={styles.itemIcon}>{item.icon}</span>
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
