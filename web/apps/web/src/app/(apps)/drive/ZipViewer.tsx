'use client';

/**
 * The inside of a zip, browsable: folders to walk into, files to open.
 *
 * Takes the archive as plaintext bytes and does the rest itself — the caller
 * (`PreviewModal`) has already downloaded and, for an encrypted file,
 * decrypted it. See `lib/zipArchive.ts` for why the archive is read here and
 * not on the server.
 */

import React, { useEffect, useState } from 'react';
import {
  AlertCircle, ArrowLeft, ChevronRight, Download, FileArchive, FileText,
  Folder, Lock,
} from 'lucide-react';
import { Text, Spinner } from '@neutrino/ui';
import {
  openZipArchive, entryPreviewKind, entryMimeType, looksLikeText,
  MAX_PREVIEW_BYTES, MAX_TEXT_PREVIEW_BYTES, ZipArchiveError,
  type ZipArchive, type ZipNode,
} from '@/lib/zipArchive';
import { highlightText } from './previewText';
import styles from './ZipViewer.module.css';
// The highlight.js theme is scoped under PreviewModal's `.pre`; sharing it
// keeps a file inside a zip coloured the same as the same file in Drive.
import previewStyles from './PreviewModal.module.css';

interface ZipViewerProps {
  /** The archive's plaintext bytes. */
  source: Blob;
  /** The archive's own name, shown as the root of the breadcrumb. */
  fileName: string;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(date: Date | null): string {
  if (!date) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function failureMessage(err: unknown, fallback: string): string {
  if (err instanceof ZipArchiveError) return err.message;
  const detail = err instanceof Error ? err.message.trim() : '';
  return detail ? `${fallback} (${detail})` : fallback;
}

/** Hands a `Blob` to the browser as a download named `name`. */
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ZipViewer({ source, fileName }: ZipViewerProps) {
  const [archive, setArchive] = useState<ZipArchive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState('');
  const [selected, setSelected] = useState<ZipNode | null>(null);

  useEffect(() => {
    let cancelled = false;
    let opened: ZipArchive | null = null;
    setArchive(null);
    setError(null);
    setFolder('');
    setSelected(null);
    openZipArchive(source)
      .then((a) => {
        if (cancelled) {
          void a.close();
          return;
        }
        opened = a;
        setArchive(a);
      })
      .catch((err) => {
        if (!cancelled) setError(failureMessage(err, 'Could not read this archive.'));
      });
    return () => {
      cancelled = true;
      void opened?.close();
    };
  }, [source]);

  if (error) {
    return (
      <div className={styles.centered}>
        <AlertCircle size={40} className={styles['muted-icon']} />
        <Text color="muted">{error}</Text>
      </div>
    );
  }

  if (!archive) {
    return (
      <div className={styles.centered}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (selected) {
    return <EntryPreview archive={archive} node={selected} onBack={() => setSelected(null)} />;
  }

  const rows = archive.list(folder);
  const crumbs = folder ? folder.split('/') : [];

  return (
    <div className={styles.viewer}>
      <div className={styles.toolbar}>
        <nav className={styles.breadcrumb} aria-label="Folder path">
          <button
            type="button"
            className={styles.crumb}
            onClick={() => setFolder('')}
            aria-current={crumbs.length === 0 ? 'location' : undefined}
          >
            <FileArchive size={14} />
            <span>{fileName}</span>
          </button>
          {crumbs.map((segment, i) => {
            const path = crumbs.slice(0, i + 1).join('/');
            const isLast = i === crumbs.length - 1;
            return (
              <React.Fragment key={path}>
                <ChevronRight size={14} className={styles['crumb-sep']} aria-hidden />
                <button
                  type="button"
                  className={styles.crumb}
                  onClick={() => setFolder(path)}
                  aria-current={isLast ? 'location' : undefined}
                >
                  <span>{segment}</span>
                </button>
              </React.Fragment>
            );
          })}
        </nav>
        <Text size="xs" color="muted">
          {archive.fileCount} {archive.fileCount === 1 ? 'file' : 'files'} · {formatBytes(archive.totalSize)}
        </Text>
      </div>

      <div className={styles['list-header']}>
        <Text size="xs" color="muted" weight="semibold">Name</Text>
        <Text size="xs" color="muted" weight="semibold">Modified</Text>
        <Text size="xs" color="muted" weight="semibold">Size</Text>
      </div>

      {rows.length === 0 ? (
        <div className={styles.centered}>
          <Text color="muted">{folder ? 'This folder is empty.' : 'This archive is empty.'}</Text>
        </div>
      ) : (
        <ul className={styles.list} role="list">
          {rows.map((node) => (
            <li key={node.path}>
              <button
                type="button"
                className={styles.row}
                onClick={() => (node.isDir ? setFolder(node.path) : setSelected(node))}
                aria-label={node.isDir ? `Open folder ${node.name}` : `Open ${node.name}`}
              >
                <span className={styles.icon}>
                  {node.isDir ? <Folder size={14} /> : node.encrypted ? <Lock size={14} /> : <FileText size={14} />}
                </span>
                <span className={styles.name}>
                  <Text size="sm" truncate>{node.name}</Text>
                </span>
                <span className={styles.modified}>
                  <Text size="xs" color="muted">{formatDate(node.modified)}</Text>
                </span>
                <span className={styles.size}>
                  <Text size="xs" color="muted">{formatBytes(node.size)}</Text>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type EntryState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'none'; message: string }
  | { kind: 'image' | 'pdf' | 'video' | 'audio'; url: string }
  | { kind: 'text'; html: string; language: string };

/** One file out of the archive, inflated and shown. */
function EntryPreview({ archive, node, onBack }: { archive: ZipArchive; node: ZipNode; onBack: () => void }) {
  const [state, setState] = useState<EntryState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;

    async function load() {
      if (node.encrypted) {
        setState({ kind: 'none', message: 'This file is password-protected and cannot be opened here.' });
        return;
      }
      if (node.size > MAX_PREVIEW_BYTES) {
        setState({ kind: 'none', message: `This file is too large to preview (${formatBytes(node.size)}). Download it instead.` });
        return;
      }

      let kind = entryPreviewKind(node.name);
      if ((kind === 'text' || kind === 'unknown') && node.size > MAX_TEXT_PREVIEW_BYTES) {
        setState({ kind: 'none', message: 'This file is too large to show as text. Download it instead.' });
        return;
      }

      try {
        const bytes = await archive.readBytes(node.path);
        if (cancelled) return;

        if (kind === 'unknown') {
          // No telling extension: show it if the bytes turn out to be text.
          if (!looksLikeText(bytes)) {
            setState({ kind: 'none', message: 'Preview not available for this file type.' });
            return;
          }
          kind = 'text';
        }

        if (kind === 'text') {
          const { html, language } = await highlightText(new TextDecoder().decode(bytes), node.name);
          if (!cancelled) setState({ kind: 'text', html, language });
          return;
        }

        url = URL.createObjectURL(new Blob([bytes], { type: entryMimeType(node.name) }));
        if (cancelled) {
          URL.revokeObjectURL(url);
          url = null;
          return;
        }
        setState({ kind, url });
      } catch (err) {
        if (!cancelled) setState({ kind: 'error', message: failureMessage(err, 'Could not open this file.') });
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [archive, node]);

  async function handleDownload() {
    try {
      saveBlob(await archive.read(node.path, entryMimeType(node.name)), node.name);
    } catch (err) {
      setState({ kind: 'error', message: failureMessage(err, 'Could not extract this file.') });
    }
  }

  return (
    <div className={styles.viewer}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.back} onClick={onBack} aria-label="Back to archive contents">
          <ArrowLeft size={14} />
          <span>Back</span>
        </button>
        <span className={styles['entry-title']}>
          <Text size="sm" weight="semibold" truncate>{node.path}</Text>
        </span>
        <Text size="xs" color="muted">{formatBytes(node.size)}</Text>
        {!node.encrypted && (
          <button
            type="button"
            className={styles['icon-btn']}
            onClick={handleDownload}
            aria-label={`Download ${node.name}`}
            title="Download this file"
          >
            <Download size={16} />
          </button>
        )}
      </div>

      <div className={styles['entry-body']}>
        {state.kind === 'loading' && (
          <div className={styles.centered}><Spinner size="lg" /></div>
        )}

        {(state.kind === 'error' || state.kind === 'none') && (
          <div className={styles.centered}>
            {state.kind === 'error'
              ? <AlertCircle size={40} className={styles['muted-icon']} />
              : <FileText size={40} className={styles['muted-icon']} />}
            <Text color="muted">{state.message}</Text>
          </div>
        )}

        {state.kind === 'image' && (
          <div className={styles['media-container']}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={state.url}
              alt={node.name}
              className={styles.image}
              onError={() => setState({ kind: 'none', message: 'This browser could not display this image.' })}
            />
          </div>
        )}

        {state.kind === 'pdf' && <iframe src={state.url} className={styles.iframe} title={node.name} />}

        {state.kind === 'video' && (
          <div className={styles['media-container']}>
            <video controls className={styles.video} src={state.url} />
          </div>
        )}

        {state.kind === 'audio' && (
          <div className={styles['media-container']}>
            <audio controls src={state.url} />
          </div>
        )}

        {state.kind === 'text' && (
          <pre className={`${previewStyles.pre} ${styles.pre}`}>
            <code
              className={`hljs language-${state.language}`}
              dangerouslySetInnerHTML={{ __html: state.html }}
            />
          </pre>
        )}
      </div>
    </div>
  );
}
