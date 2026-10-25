'use client';

/**
 * Where the files come from: this computer (drop, or the two pickers) and,
 * optionally, Google Takeout, which has its own page.
 */

import React, { useCallback, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FolderUp, Files, Package } from 'lucide-react';
import { Button, Spinner } from '@neutrino/ui';
import { pickedFromDataTransfer, pickedFromFileList, type PickedFile } from '@/lib/localImport';
import styles from './LocalImport.module.css';

export interface LocalImportSourcesProps {
  showTakeout: boolean;
  scanning: boolean;
  disabled: boolean;
  onPicked(picked: PickedFile[]): void;
  onPickedAsync(picked: Promise<PickedFile[]>): void;
}

/** `webkitdirectory` is non-standard, so React's types do not know it; set it on the element. */
function folderInputRef(el: HTMLInputElement | null) {
  if (!el) return;
  el.setAttribute('webkitdirectory', '');
  el.setAttribute('directory', '');
}

export function LocalImportSources({ showTakeout, scanning, disabled, onPicked, onPickedAsync }: LocalImportSourcesProps) {
  const router = useRouter();
  const folderInput = useRef<HTMLInputElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const id = useId();
  const computerHeading = `${id}-computer`;
  const googleHeading = `${id}-google`;

  const fromInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (list && list.length > 0) onPicked(pickedFromFileList(list));
      // Let the same folder be chosen again after a Clear.
      e.target.value = '';
    },
    [onPicked],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      // Called synchronously: the entries must be read before the event returns.
      onPickedAsync(pickedFromDataTransfer(e.dataTransfer));
    },
    [disabled, onPickedAsync],
  );

  return (
    <div className={`${styles.sources} ${showTakeout ? '' : styles.sourcesSingle}`}>
      <section className={styles.card} aria-labelledby={computerHeading}>
        <h3 id={computerHeading} className={styles.cardTitle}>
          From this computer
        </h3>
        <div
          role="region"
          aria-label="Drop folders or files to import"
          className={`${styles.dropArea} ${dragging ? styles.dropAreaActive : ''}`}
          data-testid="local-import-drop-area"
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {scanning ? (
            <div className={styles.scanning}>
              <Spinner size="sm" />
              <span>Looking through your files…</span>
            </div>
          ) : (
            <>
              <p className={styles.dropText}>
                Drop folders here or choose them. We look first, then you choose where each kind of file goes.
              </p>
              <div className={styles.pickButtons}>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<FolderUp size={14} aria-hidden="true" />}
                  onClick={() => folderInput.current?.click()}
                  disabled={disabled}
                >
                  Choose folders
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Files size={14} aria-hidden="true" />}
                  onClick={() => fileInput.current?.click()}
                  disabled={disabled}
                >
                  Choose files
                </Button>
              </div>
            </>
          )}
          <input
            ref={(el) => {
              folderInput.current = el;
              folderInputRef(el);
            }}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            aria-hidden="true"
            data-testid="local-import-folder-input"
            onChange={fromInput}
          />
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            aria-hidden="true"
            data-testid="local-import-file-input"
            onChange={fromInput}
          />
        </div>
      </section>

      {showTakeout && (
        <section className={styles.card} aria-labelledby={googleHeading}>
          <h3 id={googleHeading} className={styles.cardTitle}>
            From Google
          </h3>
          <p className={styles.cardText}>
            Import a Google Takeout archive: Drive documents, sheets and slides, Keep notes and Google Photos, with
            their original dates.
          </p>
          <div>
            <Button
              variant="secondary"
              size="sm"
              icon={<Package size={14} aria-hidden="true" />}
              onClick={() => router.push('/import')}
            >
              Open Takeout import
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
