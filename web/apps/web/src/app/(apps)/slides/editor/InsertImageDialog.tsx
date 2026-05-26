'use client';

import React, { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { storageApi } from '@/lib/api';
import type { FileItem } from '@neutrino/api-drive';
import { ImageIcon, Link, Upload } from 'lucide-react';
import styles from './page.module.css';

type Tab = 'drive' | 'url' | 'upload';

interface Props {
  onInsert: (src: string, driveFileId?: string) => void;
  onClose: () => void;
}

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/tiff',
]);

function isImageFile(item: FileItem): boolean {
  return IMAGE_MIME_TYPES.has(item.mimeType);
}

export function InsertImageDialog({ onInsert, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('drive');
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [urlPreviewOk, setUrlPreviewOk] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<FileItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: filesData, isLoading: filesLoading } = useQuery({
    queryKey: ['drive-files-images'],
    queryFn: () => storageApi.listFiles({ limit: 100 }),
    staleTime: 30_000,
  });

  const imageFiles = (filesData?.items ?? []).filter(isImageFile);

  async function handleUpload(file: File) {
    setUploadError(null);
    setUploadProgress(0);
    setUploadedFile(null);
    try {
      const result = await storageApi.uploadFile(file, (pct) => setUploadProgress(pct));
      setUploadedFile(result);
      setUploadProgress(100);
    } catch {
      setUploadError('Upload failed. Please try again.');
      setUploadProgress(null);
    }
  }

  function handleInsert() {
    if (tab === 'drive' && selectedFileId) {
      const src = storageApi.getFileDownloadUrl(selectedFileId);
      onInsert(src, selectedFileId);
    } else if (tab === 'url' && urlInput.trim()) {
      onInsert(urlInput.trim());
    } else if (tab === 'upload' && uploadedFile) {
      const src = storageApi.getFileDownloadUrl(uploadedFile.id);
      onInsert(src, uploadedFile.id);
    }
  }

  const canInsert =
    (tab === 'drive' && !!selectedFileId) ||
    (tab === 'url' && !!urlInput.trim() && urlPreviewOk) ||
    (tab === 'upload' && !!uploadedFile);

  return (
    <div className={styles.dialogOverlay} onClick={onClose}>
      <div className={styles.dialogBoxWide} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dialogTitle}>Insert Image</div>

        {/* Tabs */}
        <div className={styles.imageTabs}>
          <button
            className={`${styles.imageTab} ${tab === 'drive' ? styles.imageTabActive : ''}`}
            onClick={() => setTab('drive')}
          >
            <ImageIcon size={13} style={{ display: 'inline', marginRight: 4 }} />
            Neutrino Drive
          </button>
          <button
            className={`${styles.imageTab} ${tab === 'url' ? styles.imageTabActive : ''}`}
            onClick={() => setTab('url')}
          >
            <Link size={13} style={{ display: 'inline', marginRight: 4 }} />
            From URL
          </button>
          <button
            className={`${styles.imageTab} ${tab === 'upload' ? styles.imageTabActive : ''}`}
            onClick={() => setTab('upload')}
          >
            <Upload size={13} style={{ display: 'inline', marginRight: 4 }} />
            Upload to Drive
          </button>
        </div>

        <div className={styles.imageDialogContent}>
          {/* Drive tab */}
          {tab === 'drive' && (
            <>
              {filesLoading ? (
                <div className={styles.sheetDialogMuted}>Loading your images…</div>
              ) : imageFiles.length === 0 ? (
                <div className={styles.sheetDialogMuted}>No image files found in your Drive. Upload one first.</div>
              ) : (
                <div className={styles.imageDriveGrid}>
                  {imageFiles.map((file) => (
                    <button
                      key={file.id}
                      className={`${styles.imageDriveItem} ${selectedFileId === file.id ? styles.imageDriveItemActive : ''}`}
                      onClick={() => setSelectedFileId(file.id)}
                      title={file.name}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={storageApi.getFileDownloadUrl(file.id)}
                        alt={file.name}
                        className={styles.imageDriveItemImg}
                      />
                      <span className={styles.imageDriveItemName}>{file.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* URL tab */}
          {tab === 'url' && (
            <div className={styles.imageUploadArea}>
              <input
                className={styles.dialogInput}
                type="url"
                placeholder="https://example.com/image.jpg"
                value={urlInput}
                onChange={(e) => { setUrlInput(e.target.value); setUrlPreviewOk(false); }}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && canInsert) handleInsert(); else if (e.key === 'Escape') onClose(); }}
              />
              {urlInput.trim() && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={urlInput.trim()}
                  alt="Preview"
                  className={styles.imageUrlPreview}
                  onLoad={() => setUrlPreviewOk(true)}
                  onError={() => setUrlPreviewOk(false)}
                />
              )}
              {urlInput.trim() && !urlPreviewOk && (
                <p className={styles.sheetDialogError}>Could not load image from that URL.</p>
              )}
            </div>
          )}

          {/* Upload tab */}
          {tab === 'upload' && (
            <div className={styles.imageUploadArea}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                }}
              />
              <button
                className={styles.imageUploadBtn}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadProgress !== null && uploadProgress < 100}
              >
                <Upload size={16} />
                {uploadProgress === null ? 'Choose image file' : uploadProgress < 100 ? `Uploading… ${uploadProgress}%` : 'Choose another file'}
              </button>

              {uploadProgress !== null && uploadProgress < 100 && (
                <div className={styles.imageUploadProgress}>
                  <div className={styles.imageUploadProgressBar} style={{ width: `${uploadProgress}%` }} />
                </div>
              )}

              {uploadedFile && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={storageApi.getFileDownloadUrl(uploadedFile.id)}
                    alt={uploadedFile.name}
                    className={styles.imageUrlPreview}
                  />
                  <span className={styles.sheetDialogLabel}>{uploadedFile.name} — uploaded to Drive</span>
                </div>
              )}

              {uploadError && <p className={styles.sheetDialogError}>{uploadError}</p>}
            </div>
          )}
        </div>

        <div className={styles.dialogActions}>
          <button className={styles.dialogCancelBtn} onClick={onClose}>Cancel</button>
          <button
            className={styles.dialogConfirmBtn}
            disabled={!canInsert}
            onClick={handleInsert}
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
