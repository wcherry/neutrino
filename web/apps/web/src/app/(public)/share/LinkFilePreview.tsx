'use client';

/**
 * A file from a folder link, previewed in the browser (#321).
 *
 * The bytes are decrypted here with the link key, exactly as a download is, and shown from a blob
 * URL — nothing is rendered from the server, which holds only ciphertext. Images, video, audio,
 * PDFs, plain text and every file type the app itself opens (documents, spreadsheets,
 * presentations, notes, diagrams, drawings — see `appPreviews.tsx`) preview; anything else, and anything the browser cannot decode (HEIC in
 * most browsers, some QuickTime movies), says so and offers the download instead.
 *
 * ←/→ step through the folder's files, Esc closes.
 */

import React from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { Button, Spinner, Text } from '@neutrino/ui';
import { useDismiss, useKeyHandler } from '@neutrino/commands';
import type { FileItem } from '@neutrino/api-drive';
import styles from './page.module.css';

type Kind = 'image' | 'video' | 'audio' | 'pdf' | 'app' | 'text' | 'none';

/** The app's own types, decided without loading the readers (mirrors `appKindOf`). */
const APP_EXTS = ['docx', 'dotx', 'xlsx', 'xltx', 'pptx', 'potx', 'md', 'markdown'];
const APP_MIME = /wordprocessingml|spreadsheetml|presentationml|^text\/markdown$|^application\/x-neutrino-(diagram|drawing)$/;

/** What the browser can be asked to show for a file. Name as a fallback for a blank mime type. */
export function previewKind(file: Pick<FileItem, 'mimeType' | 'name'>): Kind {
  const mime = (file.mimeType || '').toLowerCase();
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp'].includes(ext)) {
    return 'image';
  }
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'm4a', 'wav', 'ogg', 'flac'].includes(ext)) return 'audio';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  // Before the image and text rules below would claim a note or a diagram stored as JSON.
  if (APP_MIME.test(mime) || APP_EXTS.includes(ext)) return 'app';
  if (
    mime.startsWith('text/') ||
    ['json', 'md', 'csv', 'txt', 'log', 'xml', 'yml', 'yaml'].includes(ext)
  ) {
    return 'text';
  }
  return 'none';
}

/** Text files above this are cut off in the preview; the download is whole. */
const TEXT_PREVIEW_LIMIT = 512 * 1024;

const MIME_FOR_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  pdf: 'application/pdf',
};

interface Props {
  files: FileItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Decrypted bytes, or null when the link holds no key for the file yet. */
  read: (file: FileItem) => Promise<Uint8Array | null>;
  onDownload: (file: FileItem) => void;
}

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; url: string; text?: string; truncated?: boolean; view?: React.ReactElement }
  | { phase: 'unready' }
  | { phase: 'error'; message: string };

export function LinkFilePreview({ files, index, onIndexChange, onClose, read, onDownload }: Props) {
  const file = files[index];
  const kind = previewKind(file);
  const [state, setState] = React.useState<State>({ phase: 'loading' });
  const [undecodable, setUndecodable] = React.useState(false);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    closeRef.current?.focus();
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setState({ phase: 'loading' });
    setUndecodable(false);
    if (kind === 'none') {
      setState({ phase: 'ready', url: '' });
      return;
    }
    read(file)
      .then(async (bytes) => {
        if (cancelled) return;
        if (!bytes) {
          setState({ phase: 'unready' });
          return;
        }
        const ext = file.name.toLowerCase().split('.').pop() ?? '';
        const type = file.mimeType || MIME_FOR_EXT[ext] || 'application/octet-stream';
        if (kind === 'app') {
          // The editors' own readers and Drive's preview views — loaded only when such a file is
          // opened, so the share page does not carry them for everyone.
          const { appKindOf, renderAppPreview } = await import('./appPreviews');
          const appKind = appKindOf(file.mimeType || '', file.name);
          if (!appKind) throw new Error('There is no preview for this kind of file.');
          const view = await renderAppPreview(appKind, bytes, file.name);
          if (cancelled) return;
          setState({ phase: 'ready', url: '', view });
          return;
        }
        if (kind === 'text') {
          const slice = bytes.subarray(0, TEXT_PREVIEW_LIMIT);
          setState({
            phase: 'ready',
            url: '',
            text: new TextDecoder().decode(slice),
            truncated: bytes.length > TEXT_PREVIEW_LIMIT,
          });
          return;
        }
        url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type }));
        setState({ phase: 'ready', url });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({ phase: 'error', message: e instanceof Error ? e.message : 'Could not open this file.' });
        }
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // A new file is a new read; `read` is stable for the life of the browser.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  // Through the app's one key dispatcher: Esc as a dismiss layer, so it closes the preview and
  // nothing beneath it (the browser's selection keeps its own Esc), and ←/→ as a key handler.
  useDismiss(() => onClose());
  useKeyHandler((e) => {
    if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
    else if (e.key === 'ArrowRight' && index < files.length - 1) onIndexChange(index + 1);
  });

  const fallback = (message: string) => (
    <div className={styles.previewFallback}>
      <Text color="muted">{message}</Text>
      <Button icon={<Download size={14} />} onClick={() => onDownload(file)}>
        Download
      </Button>
    </div>
  );

  let body: React.ReactNode;
  if (state.phase === 'loading') {
    body = <Spinner size="lg" />;
  } else if (state.phase === 'unready') {
    body = (
      <div className={styles.previewFallback}>
        <Text color="muted">
          This file is not ready to open through this link yet. The owner can fix that by opening the
          folder&apos;s Share dialog.
        </Text>
      </div>
    );
  } else if (state.phase === 'error') {
    body = fallback(state.message);
  } else if (kind === 'none' || undecodable) {
    body = fallback(
      undecodable ? 'This browser cannot show this file.' : 'There is no preview for this kind of file.',
    );
  } else if (kind === 'image') {
    body = (
      // A decrypted blob, not a remote image: next/image has nothing to optimise here.
      // eslint-disable-next-line @next/next/no-img-element
      <img className={styles.previewMedia} src={state.url} alt={file.name} onError={() => setUndecodable(true)} />
    );
  } else if (kind === 'video') {
    body = (
      <video className={styles.previewMedia} src={state.url} controls autoPlay onError={() => setUndecodable(true)} />
    );
  } else if (kind === 'audio') {
    body = <audio src={state.url} controls autoPlay onError={() => setUndecodable(true)} />;
  } else if (kind === 'app') {
    body = <div className={styles.previewApp}>{state.view}</div>;
  } else if (kind === 'pdf') {
    body = <iframe className={styles.previewFrame} src={state.url} title={file.name} />;
  } else {
    body = (
      <pre className={styles.previewText}>
        {state.text}
        {state.truncated ? '\n\n… (preview cut short; download for the whole file)' : ''}
      </pre>
    );
  }

  return (
    <div
      className={styles.previewBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${file.name}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.previewPanel}>
        <div className={styles.previewHeader}>
          <span className={styles.previewTitle} title={file.name}>
            {file.name}
          </span>
          <span className={styles.previewCount}>
            {index + 1} of {files.length}
          </span>
          <button type="button" className={styles.iconBtn} aria-label={`Download ${file.name}`} onClick={() => onDownload(file)}>
            <Download size={16} />
          </button>
          <button type="button" className={styles.iconBtn} aria-label="Close preview" onClick={onClose} ref={closeRef}>
            <X size={16} />
          </button>
        </div>
        <div className={styles.previewBody}>
          <button
            type="button"
            className={`${styles.previewNav} ${styles.previewPrev}`}
            aria-label="Previous file"
            onClick={() => onIndexChange(index - 1)}
            disabled={index === 0}
          >
            <ChevronLeft size={20} />
          </button>
          {body}
          <button
            type="button"
            className={`${styles.previewNav} ${styles.previewNext}`}
            aria-label="Next file"
            onClick={() => onIndexChange(index + 1)}
            disabled={index === files.length - 1}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
