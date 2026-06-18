'use client';

import React from 'react';
import { Sparkles, X, Copy, Check, CornerDownLeft } from 'lucide-react';
import styles from './AiPanel.module.css';

export type AiOperation = 'suggestions' | 'summarize' | 'change-tone' | 'grammar-fix';

interface AiPanelProps {
  operation: AiOperation;
  result: string;
  isLoading: boolean;
  error: string | null;
  hasSelection: boolean;
  onInsert: () => void;
  onClose: () => void;
  /** When false the "Apply fix" footer is hidden (e.g. advisory-only grammar results). */
  canInsert?: boolean;
}

const OPERATION_LABELS: Record<AiOperation, string> = {
  suggestions: 'AI Suggestions',
  summarize: 'AI Summary',
  'change-tone': 'Tone Rewrite',
  'grammar-fix': 'AI Grammar Fix',
};

const OPERATION_DESCRIPTIONS: Record<AiOperation, (hasSelection: boolean) => string> = {
  suggestions: (sel) =>
    sel ? 'Suggested continuation for the selected text' : 'Suggested continuation for the document',
  summarize: (sel) =>
    sel ? 'Summary of the selected text' : 'Summary of the document',
  'change-tone': (sel) =>
    sel ? 'Rewritten selected text with adjusted tone' : 'Rewritten document with adjusted tone',
  'grammar-fix': () => 'AI-suggested fix for the grammar issue at cursor',
};

const INSERT_LABELS: Record<AiOperation, (hasSelection: boolean) => string> = {
  suggestions: (sel) => (sel ? 'Insert after selection' : 'Insert at cursor'),
  summarize: (sel) => (sel ? 'Replace selection' : 'Insert at end'),
  'change-tone': (sel) => (sel ? 'Replace selection' : 'Replace document'),
  'grammar-fix': () => 'Apply fix',
};

export function AiPanel({
  operation,
  result,
  isLoading,
  error,
  hasSelection,
  onInsert,
  onClose,
  canInsert = true,
}: AiPanelProps) {
  const [copied, setCopied] = React.useState(false);

  function handleCopy() {
    if (!result) return;
    navigator.clipboard.writeText(result).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className={styles.panel} role="complementary" aria-label="AI result panel">
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Sparkles size={14} className={styles.sparkleIcon} />
          <span>{OPERATION_LABELS[operation]}</span>
        </div>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close AI panel"
          type="button"
        >
          <X size={14} />
        </button>
      </div>

      {/* Description */}
      {!isLoading && !error && (
        <p className={styles.description}>
          {OPERATION_DESCRIPTIONS[operation](hasSelection)}
        </p>
      )}

      {/* Body */}
      <div className={styles.body}>
        {isLoading && (
          <div className={styles.loading}>
            <span className={styles.loadingDot} />
            <span className={styles.loadingDot} />
            <span className={styles.loadingDot} />
            <span className={styles.loadingLabel}>Generating…</span>
          </div>
        )}

        {error && !isLoading && (
          <div className={styles.error} role="alert">
            <span className={styles.errorIcon}>!</span>
            <span>{error}</span>
          </div>
        )}

        {!isLoading && !error && result && (
          <div className={styles.result}>
            <pre className={styles.resultText}>{result}</pre>
          </div>
        )}
      </div>

      {/* Footer actions */}
      {!isLoading && !error && result && canInsert && (
        <div className={styles.footer}>
          <button
            className={styles.copyBtn}
            onClick={handleCopy}
            type="button"
            aria-label="Copy to clipboard"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>

          <button
            className={styles.insertBtn}
            onClick={onInsert}
            type="button"
          >
            <CornerDownLeft size={13} />
            {INSERT_LABELS[operation](hasSelection)}
          </button>
        </div>
      )}
    </div>
  );
}
