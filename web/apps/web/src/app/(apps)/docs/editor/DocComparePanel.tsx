'use client';

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, GitCompare } from 'lucide-react';
import { storageApi } from '@/lib/api';
import type { FileVersionItem } from '@neutrino/api-drive';
import styles from './DocComparePanel.module.css';

interface DocComparePanelProps {
  fileId: string;
  baseVersion: FileVersionItem;
  compareVersion: FileVersionItem;
  onClose: () => void;
  /** When provided, used directly as "compare version" content (for the current unsaved doc). */
  currentContent?: string;
}

// ── Word-level diff ────────────────────────────────────────────────────────────

type DiffToken = { type: 'equal' | 'insert' | 'delete'; text: string };

function wordDiff(oldText: string, newText: string): DiffToken[] {
  // Tokenise on word boundaries preserving whitespace
  const tokenize = (s: string) => s.match(/\S+|\s+/g) ?? [];
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);

  // Myers LCS-based diff
  const m = oldTokens.length;
  const n = newTokens.length;

  // Compute LCS lengths (DP table — simplified for reasonable document sizes)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldTokens[i] === newTokens[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Traceback
  const result: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && oldTokens[i] === newTokens[j]) {
      result.push({ type: 'equal', text: oldTokens[i] });
      i++;
      j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ type: 'insert', text: newTokens[j] });
      j++;
    } else {
      result.push({ type: 'delete', text: oldTokens[i] });
      i++;
    }
  }
  return result;
}

// ── Extract plain text from a Tiptap JSON or raw JSON string ──────────────────

function extractPlainText(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    // Handle wrapper format { doc, _meta }
    const doc = parsed._meta ? parsed.doc : parsed;
    return extractFromNode(doc);
  } catch {
    return raw;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFromNode(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  const parts: string[] = [];
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const text = extractFromNode(child);
      if (text) parts.push(text);
    }
  }
  // Add newline after block nodes
  const blockTypes = ['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock'];
  const sep = blockTypes.includes(node.type) ? '\n' : '';
  return parts.join('') + sep;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function DocComparePanel({ fileId, baseVersion, compareVersion, onClose, currentContent }: DocComparePanelProps) {
  const baseQuery = useQuery({
    queryKey: ['version-content', fileId, baseVersion.id],
    queryFn: () => storageApi.downloadVersionContent(fileId, baseVersion.id),
    staleTime: Infinity,
  });

  // "compare" version: either use the injected current content or fetch from API
  const compareQuery = useQuery({
    queryKey: ['version-content', fileId, compareVersion.id],
    queryFn: () => storageApi.downloadVersionContent(fileId, compareVersion.id),
    staleTime: Infinity,
    enabled: !currentContent, // skip if we have current content directly
  });
  const compareData = currentContent ?? compareQuery.data;

  const diff = useMemo(() => {
    if (!baseQuery.data || !compareData) return null;
    const oldText = extractPlainText(baseQuery.data);
    const newText = extractPlainText(compareData);
    return wordDiff(oldText, newText);
  }, [baseQuery.data, compareData]);

  const isLoading = baseQuery.isLoading || (!currentContent && compareQuery.isLoading);
  const isError = baseQuery.isError || (!currentContent && compareQuery.isError);

  const formatVersion = (v: FileVersionItem) =>
    v.label
      ? `${v.label} (v${v.versionNumber})`
      : `Version ${v.versionNumber}`;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <GitCompare size={15} />
          <span>Compare versions</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose} type="button" aria-label="Close compare panel">
          <X size={14} />
        </button>
      </div>

      <div className={styles.versionLabels}>
        <div className={styles.versionLabel}>
          <span className={styles.versionDot} style={{ background: '#e53935' }} />
          <span>{formatVersion(baseVersion)}</span>
          <span className={styles.versionDate}>
            {new Date(baseVersion.createdAt).toLocaleString()}
          </span>
        </div>
        <div className={styles.versionLabel}>
          <span className={styles.versionDot} style={{ background: '#43a047' }} />
          <span>{formatVersion(compareVersion)}</span>
          <span className={styles.versionDate}>
            {new Date(compareVersion.createdAt).toLocaleString()}
          </span>
        </div>
      </div>

      <div className={styles.body}>
        {isLoading && (
          <div className={styles.loading}>Loading versions…</div>
        )}
        {isError && (
          <div className={styles.error}>Failed to load version content.</div>
        )}
        {diff && !isLoading && !isError && (
          <div className={styles.diffView}>
            {diff.map((token, i) => {
              if (token.type === 'equal') {
                return <span key={i}>{token.text}</span>;
              }
              if (token.type === 'insert') {
                return (
                  <ins key={i} className={styles.insert}>
                    {token.text}
                  </ins>
                );
              }
              return (
                <del key={i} className={styles.delete}>
                  {token.text}
                </del>
              );
            })}
          </div>
        )}
        {diff && diff.every(t => t.type === 'equal') && (
          <div className={styles.noDiff}>No differences found between these versions.</div>
        )}
      </div>
    </div>
  );
}
