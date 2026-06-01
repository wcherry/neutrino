'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { findReplacePluginKey } from '@/lib/extensions/FindReplaceExtension';
import styles from './FindReplaceBar.module.css';

interface FindReplaceBarProps {
  editor: Editor;
  onClose: () => void;
}

export function FindReplaceBar({ editor, onClose }: FindReplaceBarProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  // Update search term in plugin whenever inputs or options change
  useEffect(() => {
    editor.commands.setFindTerm(searchTerm, { caseSensitive, wholeWord });
  }, [searchTerm, caseSensitive, wholeWord, editor]);

  // Clear search decoration on unmount
  useEffect(() => {
    return () => {
      editor.commands.setFindTerm('');
    };
  }, [editor]);

  // Keyboard handling: Escape closes, Enter navigates
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        handleClose();
      }
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = useCallback(() => {
    editor.commands.setFindTerm('');
    editor.commands.focus();
    onClose();
  }, [editor, onClose]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          editor.commands.findPrev();
        } else {
          editor.commands.findNext();
        }
      }
    },
    [editor],
  );

  const handleReplaceOne = useCallback(() => {
    editor.commands.replaceOne(replaceTerm);
    editor.commands.findNext();
  }, [editor, replaceTerm]);

  const handleReplaceAll = useCallback(() => {
    editor.commands.replaceAll(replaceTerm);
  }, [editor, replaceTerm]);

  const ps = findReplacePluginKey.getState(editor.state);
  const matchCount = ps?.results.length ?? 0;
  const currentIndex = ps?.currentIndex ?? -1;

  const matchLabel = searchTerm
    ? matchCount > 0
      ? `${currentIndex >= 0 ? currentIndex + 1 : 1} / ${matchCount}`
      : 'No matches'
    : '';

  return (
    <div className={styles.bar} role="search" aria-label="Find and replace">
      <button
        className={`${styles.toggleBtn} ${showReplace ? styles.toggleBtnOpen : ''}`}
        onClick={() => setShowReplace(v => !v)}
        title={showReplace ? 'Hide replace' : 'Show replace'}
        type="button"
        aria-expanded={showReplace}
        aria-label="Toggle replace field"
      >
        <ChevronDown size={12} />
      </button>

      <div className={styles.fields}>
        <div className={styles.findRow}>
          <div className={styles.inputWrapper}>
            <input
              ref={searchInputRef}
              className={styles.input}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Find"
              aria-label="Find"
              type="text"
              spellCheck={false}
            />
            {matchLabel && (
              <span className={`${styles.matchCount} ${matchCount === 0 && searchTerm ? styles.noMatch : ''}`}>
                {matchLabel}
              </span>
            )}
          </div>

          <div className={styles.optGroup}>
            <button
              className={`${styles.optBtn} ${caseSensitive ? styles.optBtnActive : ''}`}
              onClick={() => setCaseSensitive(v => !v)}
              title="Match case"
              type="button"
              aria-pressed={caseSensitive}
            >
              Aa
            </button>
            <button
              className={`${styles.optBtn} ${wholeWord ? styles.optBtnActive : ''}`}
              onClick={() => setWholeWord(v => !v)}
              title="Match whole word"
              type="button"
              aria-pressed={wholeWord}
            >
              W
            </button>
          </div>

          <div className={styles.navGroup}>
            <button
              className={styles.navBtn}
              onClick={() => editor.commands.findPrev()}
              disabled={matchCount === 0}
              title="Previous match (Shift+Enter)"
              type="button"
              aria-label="Previous match"
            >
              <ChevronUp size={13} />
            </button>
            <button
              className={styles.navBtn}
              onClick={() => editor.commands.findNext()}
              disabled={matchCount === 0}
              title="Next match (Enter)"
              type="button"
              aria-label="Next match"
            >
              <ChevronDown size={13} />
            </button>
          </div>
        </div>

        {showReplace && (
          <div className={styles.replaceRow}>
            <div className={styles.inputWrapper}>
              <input
                className={styles.input}
                value={replaceTerm}
                onChange={e => setReplaceTerm(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleReplaceOne(); } }}
                placeholder="Replace with"
                aria-label="Replace with"
                type="text"
                spellCheck={false}
              />
            </div>
            <button
              className={styles.replaceBtn}
              onClick={handleReplaceOne}
              disabled={matchCount === 0}
              type="button"
            >
              Replace
            </button>
            <button
              className={styles.replaceBtn}
              onClick={handleReplaceAll}
              disabled={matchCount === 0}
              type="button"
            >
              All
            </button>
          </div>
        )}
      </div>

      <button
        className={styles.closeBtn}
        onClick={handleClose}
        title="Close (Escape)"
        type="button"
        aria-label="Close find and replace"
      >
        <X size={14} />
      </button>
    </div>
  );
}
