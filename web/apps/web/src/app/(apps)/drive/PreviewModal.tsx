'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Download, AlertCircle, FileText, Folder } from 'lucide-react';
import { Text, Spinner } from '@neutrino/ui';
import { useUser } from '@neutrino/auth';
import { storageApi, authApi, downloadAndDecryptFile, type FileItem, type ZipEntry } from '@/lib/api';
import { initSodium, loadKeyPair } from '@neutrino/e2e-crypto';
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

    async function fetchBlobUrl(mimeType: string): Promise<string> {
      if (file.encryptedMetadata) {
        const userId = currentUser?.id ?? await authApi.getProfile().then((u) => u.id);
        await initSodium();
        const kp = loadKeyPair(userId);
        if (!kp) throw new Error('No local keypair — cannot decrypt file');
        const bytes = await downloadAndDecryptFile(file.id, kp.publicKey, kp.secretKey);
        if (!bytes) throw new Error('Failed to decrypt file');
        const blob = new Blob([bytes], { type: mimeType });
        return URL.createObjectURL(blob);
      }
      return storageApi.fetchPreviewBlobUrl(file.id);
    }

    async function fetchText(): Promise<string> {
      if (file.encryptedMetadata) {
        const userId = currentUser?.id ?? await authApi.getProfile().then((u) => u.id);
        await initSodium();
        const kp = loadKeyPair(userId);
        if (!kp) throw new Error('No local keypair — cannot decrypt file');
        const bytes = await downloadAndDecryptFile(file.id, kp.publicKey, kp.secretKey);
        if (!bytes) throw new Error('Failed to decrypt file');
        return new TextDecoder().decode(bytes);
      }
      return storageApi.fetchPreviewText(file.id);
    }

    async function load() {
      try {
        if (file.mimeType.startsWith('image/')) {
          const url = await fetchBlobUrl(file.mimeType);
          blobUrlRef.current = url;
          if (!cancelled) setState({ kind: 'image', url });
        } else if (file.mimeType === 'application/pdf') {
          const url = await fetchBlobUrl(file.mimeType);
          blobUrlRef.current = url;
          if (!cancelled) setState({ kind: 'pdf', url });
        } else if (file.mimeType.startsWith('video/')) {
          const url = await fetchBlobUrl(file.mimeType);
          blobUrlRef.current = url;
          if (!cancelled) setState({ kind: 'video', url });
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
          setState({ kind: 'error', message: 'Failed to load preview.' });
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
              <img src={state.url} alt={file.name} className={styles.image} />
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
