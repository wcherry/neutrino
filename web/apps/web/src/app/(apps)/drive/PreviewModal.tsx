'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Download, AlertCircle, FileText, Folder } from 'lucide-react';
import { Text, Spinner } from '@neutrino/ui';
import { useUser } from '@neutrino/auth';
import { storageApi, authApi, downloadAndDecryptFile, type FileItem, type ZipEntry } from '@/lib/api';
import { initSodium, loadKeyPair } from '@neutrino/e2e-crypto';
import { toRenderableImageBlob } from '@/lib/heic';
import styles from './PreviewModal.module.css';

interface PreviewModalProps {
  file: FileItem;
  onClose: () => void;
}

type PreviewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'image'; url: string }
  | { kind: 'pdf'; url: string }
  | { kind: 'video'; url: string }
  | { kind: 'text'; content: string; language: string }
  | { kind: 'zip'; entries: ZipEntry[] };

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp',
    cs: 'csharp', rb: 'ruby', sh: 'bash', bash: 'bash', zsh: 'bash',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml',
    html: 'html', css: 'css', scss: 'css', sql: 'sql', md: 'markdown',
  };
  return map[ext] ?? 'plaintext';
}

function isPreviewableText(mimeType: string, name: string): boolean {
  if (mimeType.startsWith('text/')) return true;
  const textMimes = ['application/json', 'application/xml', 'application/x-sh',
    'application/javascript', 'application/typescript', 'application/toml'];
  if (textMimes.some((m) => mimeType.includes(m))) return true;
  // Fallback: check extension
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const textExts = ['txt', 'md', 'json', 'yaml', 'yml', 'toml', 'xml', 'csv',
    'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'cs',
    'rb', 'sh', 'bash', 'html', 'css', 'scss', 'sql'];
  return textExts.includes(ext);
}

function isZip(mimeType: string, name: string): boolean {
  if (mimeType.includes('zip')) return true;
  return (name.split('.').pop()?.toLowerCase() ?? '') === 'zip';
}

/**
 * Whether this file is worth downloading as a picture.
 *
 * The mime type decides, with one exception: a `.heic`/`.heif` name is enough
 * on its own. A HEIC arrives here typed `image/heic` when the uploading browser
 * knew what it was, and `application/octet-stream` when it didn't — Chrome
 * outside macOS reads `File.type` as empty for one, `uploadEncryptedFile` then
 * sends no `mime_type`, and the server sees only the octet-stream the
 * *ciphertext* was posted as. Either way the same picture should preview.
 *
 * This is a decision about what to fetch, not about how to decode it: nothing
 * downstream trusts the name. `toRenderableImageBlob` sniffs the bytes, and a
 * file misnamed `.heic` that turns out to be something else falls through to
 * the "no preview" message below rather than into libheif.
 */
function isPreviewableImage(mimeType: string, name: string): boolean {
  if (mimeType.startsWith('image/')) return true;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'heic' || ext === 'heif';
}

/**
 * The reason a preview did not load, keeping whatever the failure said.
 *
 * Download, decryption and decoding all fail into the same catch, and which it
 * was is the difference between "try again" and "this will never open here" —
 * the same argument `PhotoEditor` makes for its own loader. The transcode is
 * the case that needs it most: `heic-to` decodes in a worker and rejects with
 * `e.toString()` rather than an `Error`, so demanding an `Error` would discard
 * the detail exactly where it is the only account of what went wrong.
 */
function loadFailureMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  // Already stringified as "Error: <message>" when it came back from a worker;
  // the prefix says nothing next to the sentence in front of it.
  const detail = raw.trim().replace(/^Error:\s*/, '');
  return detail ? `Failed to load preview. (${detail})` : 'Failed to load preview.';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PreviewModal({ file, onClose }: PreviewModalProps) {
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });
  const blobUrlRef = useRef<string | null>(null);
  const currentUser = useUser();

  useEffect(() => {
    let cancelled = false;

    async function fetchBlob(mimeType: string): Promise<Blob> {
      if (file.encryptedMetadata) {
        const userId = (currentUser?.id ?? await authApi.getProfile().then((u) => u.id))!;
        await initSodium();
        const kp = loadKeyPair(userId);
        if (!kp) throw new Error('No local keypair — cannot decrypt file');
        const bytes = await downloadAndDecryptFile(file.id, userId);
        if (!bytes) throw new Error('Failed to decrypt file');
        return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType });
      }
      return storageApi.fetchPreviewBlob(file.id);
    }

    async function fetchBlobUrl(mimeType: string): Promise<string> {
      return URL.createObjectURL(await fetchBlob(mimeType));
    }

    /**
     * The image, in something this browser can actually decode.
     *
     * No browser but Safari decodes HEIC, and an `<img>` pointed at one fails
     * *silently* — the broken-image glyph and the alt text, with nothing in the
     * console (issue #210). Photos already solved this for its own editor, so
     * the transcode is the shared `toRenderableImageBlob`: it reads the
     * container's `ftyp` brands and pulls libheif in dynamically only for bytes
     * that really are HEIC, leaving every other image untouched and the ~1.5 MB
     * wasm out of the bundle.
     *
     * Bytes that are neither HEIC nor an image by their mime type come back
     * unchanged and un-typed, which is the `.heic` name that was a label on
     * something else — reported as "no preview" rather than shown broken.
     */
    async function fetchImageUrl(): Promise<string | null> {
      const renderable = await toRenderableImageBlob(await fetchBlob(file.mimeType));
      if (!renderable.type.startsWith('image/')) return null;
      return URL.createObjectURL(renderable);
    }

    async function fetchText(): Promise<string> {
      if (file.encryptedMetadata) {
        const userId = (currentUser?.id ?? await authApi.getProfile().then((u) => u.id))!;
        await initSodium();
        const kp = loadKeyPair(userId);
        if (!kp) throw new Error('No local keypair — cannot decrypt file');
        const bytes = await downloadAndDecryptFile(file.id, userId);
        if (!bytes) throw new Error('Failed to decrypt file');
        return new TextDecoder().decode(bytes);
      }
      return storageApi.fetchPreviewText(file.id);
    }

    /**
     * Takes ownership of an object URL, or throws it away when the preview was
     * closed while its bytes were still being fetched.
     *
     * `blobUrlRef` is the only handle the cleanup below has, and by this point
     * it has already run, so assigning to it now would leak the bytes for the
     * life of the page. The window is not theoretical any more: a HEIC
     * transcode runs for seconds on a phone-sized picture.
     */
    function adopt(url: string): boolean {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return false;
      }
      blobUrlRef.current = url;
      return true;
    }

    async function load() {
      try {
        if (isPreviewableImage(file.mimeType, file.name)) {
          const url = await fetchImageUrl();
          if (!url) {
            if (!cancelled)
              setState({ kind: 'error', message: 'Preview not available for this file type.' });
            return;
          }
          if (adopt(url)) setState({ kind: 'image', url });
        } else if (file.mimeType === 'application/pdf') {
          const url = await fetchBlobUrl(file.mimeType);
          if (adopt(url)) setState({ kind: 'pdf', url });
        } else if (file.mimeType.startsWith('video/')) {
          const url = await fetchBlobUrl(file.mimeType);
          if (adopt(url)) setState({ kind: 'video', url });
        } else if (isZip(file.mimeType, file.name)) {
          const { entries } = await storageApi.getZipContents(file.id);
          if (!cancelled) setState({ kind: 'zip', entries });
        } else if (isPreviewableText(file.mimeType, file.name)) {
          const content = await fetchText();
          const language = detectLanguage(file.name);
          if (!cancelled) {
            // Lazy-load highlight.js only when needed
            const hljs = (await import('highlight.js')).default;
            const highlighted =
              language !== 'plaintext' && hljs.getLanguage(language)
                ? hljs.highlight(content, { language }).value
                : escapeHtml(content);
            setState({ kind: 'text', content: highlighted, language });
          }
        } else {
          if (!cancelled)
            setState({ kind: 'error', message: 'Preview not available for this file type.' });
        }
      } catch (err) {
        if (!cancelled)
          setState({ kind: 'error', message: loadFailureMessage(err) });
      }
    }

    load();
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [file, currentUser?.id]);

  // Close on backdrop click
  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleDownload() {
    const blob = await storageApi.downloadFile(file.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  return (
    <div className={styles.backdrop} onClick={handleBackdrop} role="dialog" aria-modal aria-label={`Preview ${file.name}`}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles['header-left']}>
            <Text size="sm" weight="semibold" truncate>{file.name}</Text>
          </div>
          <div className={styles['header-actions']}>
            <button
              type="button"
              className={styles['icon-btn']}
              onClick={handleDownload}
              aria-label="Download file"
              title="Download"
            >
              <Download size={16} />
            </button>
            <button
              type="button"
              className={styles['icon-btn']}
              onClick={onClose}
              aria-label="Close preview"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {state.kind === 'loading' && (
            <div className={styles.centered}>
              <Spinner size="lg" />
            </div>
          )}

          {state.kind === 'error' && (
            <div className={styles.centered}>
              <AlertCircle size={40} style={{ color: 'var(--color-text-muted)', marginBottom: '12px' }} />
              <Text color="muted">{state.message}</Text>
            </div>
          )}

          {state.kind === 'image' && (
            <div className={styles['image-container']}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={state.url}
                alt={file.name}
                className={styles.image}
                /*
                 * A format the browser cannot decode fails here with no error
                 * anywhere — the broken-image glyph beside the alt text, which
                 * is all issue #210 gave the person looking at it. Say so.
                 */
                onError={() =>
                  setState({ kind: 'error', message: 'This browser could not display this image.' })
                }
              />
            </div>
          )}

          {state.kind === 'pdf' && (
            <iframe
              src={state.url}
              className={styles.iframe}
              title={file.name}
            />
          )}

          {state.kind === 'video' && (
            <div className={styles['video-container']}>
              <video controls className={styles.video} key={state.url}>
                <source src={state.url} type={file.mimeType} />
                Your browser does not support video playback.
              </video>
            </div>
          )}

          {state.kind === 'text' && (
            <div className={styles['code-container']}>
              <pre className={styles.pre}>
                <code
                  className={`hljs language-${state.language}`}
                  dangerouslySetInnerHTML={{ __html: state.content }}
                />
              </pre>
            </div>
          )}

          {state.kind === 'zip' && (
            <div className={styles['zip-container']}>
              <div className={styles['zip-header']}>
                <Text size="xs" color="muted" weight="semibold">Name</Text>
                <Text size="xs" color="muted" weight="semibold">Size</Text>
              </div>
              <ul className={styles['zip-list']} role="list">
                {state.entries.map((entry, i) => (
                  <li key={i} className={styles['zip-entry']}>
                    <span className={styles['zip-icon']}>
                      {entry.isDir ? <Folder size={14} /> : <FileText size={14} />}
                    </span>
                    <span className={styles['zip-entry-name']}>
                      <Text size="sm" truncate>{entry.name}</Text>
                    </span>
                    <span className={styles['zip-entry-size']}>
                      <Text size="xs" color="muted">{entry.isDir ? '—' : formatBytes(entry.size)}</Text>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
