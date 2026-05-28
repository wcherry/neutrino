'use client';

import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import styles from './DropZone.module.css';

export interface DropZoneProps {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  accept?: string;
  label?: string;
  hint?: string;
}

export function DropZone({
  onFiles,
  multiple = true,
  accept,
  label = 'Drag & drop files here',
  hint = 'or click to browse',
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragging(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      onFiles(Array.from(e.dataTransfer.files));
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  return (
    <div
      className={[styles.dropzone, dragging ? styles.dragging : ''].filter(Boolean).join(' ')}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      aria-label={dragging ? 'Drop to upload' : label}
      data-testid="drop-zone"
    >
      <Upload size={32} className={styles.dropIcon} />
      <p className={styles.dropText}>{dragging ? 'Drop to upload' : label}</p>
      {hint && <p className={styles.dropSub}>{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        className={styles.hiddenInput}
        onChange={onInputChange}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}
