'use client';

import React, { useEffect, useRef } from 'react';
import { type Editor } from '@tiptap/react';
import {
  Bold, Italic, Underline, Strikethrough, Link,
  Eraser, MessageSquare, CheckSquare, AlignLeft, Sparkles,
} from 'lucide-react';
import styles from './EditorContextMenu.module.css';

const MAX_SUGGESTIONS = 5;

interface Props {
  editor: Editor;
  x: number;
  y: number;
  hasSelection: boolean;
  onClose: () => void;
  onAddComment: (selectedText: string) => void;
  onInsertLink: () => void;
  /** The word under the cursor, when spell-check is active. */
  spellWord?: string;
  /**
   * Suggestions for `spellWord`. When undefined the dictionary is still loading
   * and a "Checking…" placeholder is shown. When an empty array, the word is
   * correctly spelled (no extra UI shown).
   */
  spellSuggestions?: string[];
  /** Called with the chosen replacement word when a suggestion is clicked. */
  onApplySuggestion?: (word: string) => void;
  /** Grammar issue message at cursor position, when grammar check is active. */
  grammarMessage?: string;
  /** Replacement text for the grammar issue, if available. */
  grammarSuggestion?: string;
  /** Called with the replacement text when the grammar fix is applied. */
  onApplyGrammarFix?: (from: number, to: number, replacement: string) => void;
  /** Document position range of the grammar issue. */
  grammarRange?: { from: number; to: number };
  /** Called when the user asks AI to fix the grammar issue. */
  onAiGrammarFix?: () => void;
}

type Item =
  | { kind: 'action'; icon: React.ReactNode; label: string; shortcut?: string; active?: boolean; disabled?: boolean; action: () => void }
  | { kind: 'separator' };

export function EditorContextMenu({
  editor,
  x,
  y,
  hasSelection,
  onClose,
  onAddComment,
  onInsertLink,
  spellWord,
  spellSuggestions,
  onApplySuggestion,
  grammarMessage,
  grammarSuggestion,
  onApplyGrammarFix,
  grammarRange,
  onAiGrammarFix,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  // Keep menu within viewport
  const menuWidth = 220;
  const menuHeight = 360;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - menuHeight - 8);

  function run(fn: () => void) {
    fn();
    onClose();
  }

  // Determine whether to show the spell-check suggestions section.
  // spellWord must be present and the word must actually be misspelled
  // (spellSuggestions is undefined = loading, or has items = misspelled).
  const showSpellSection = !!spellWord && spellSuggestions !== null && (
    spellSuggestions === undefined || spellSuggestions.length > 0
  );

  const visibleSuggestions = spellSuggestions?.slice(0, MAX_SUGGESTIONS) ?? [];

  const items: Item[] = [
    {
      kind: 'action',
      icon: <MessageSquare size={14} />,
      label: 'Add comment',
      disabled: !hasSelection,
      action: () => {
        const text = window.getSelection()?.toString() ?? '';
        run(() => onAddComment(text));
      },
    },
    { kind: 'separator' },
    {
      kind: 'action',
      icon: <Bold size={14} />,
      label: 'Bold',
      shortcut: '⌘B',
      active: editor.isActive('bold'),
      disabled: !hasSelection,
      action: () => run(() => editor.chain().focus().toggleBold().run()),
    },
    {
      kind: 'action',
      icon: <Italic size={14} />,
      label: 'Italic',
      shortcut: '⌘I',
      active: editor.isActive('italic'),
      disabled: !hasSelection,
      action: () => run(() => editor.chain().focus().toggleItalic().run()),
    },
    {
      kind: 'action',
      icon: <Underline size={14} />,
      label: 'Underline',
      shortcut: '⌘U',
      active: editor.isActive('underline'),
      disabled: !hasSelection,
      action: () => run(() => editor.chain().focus().toggleUnderline().run()),
    },
    {
      kind: 'action',
      icon: <Strikethrough size={14} />,
      label: 'Strikethrough',
      active: editor.isActive('strike'),
      disabled: !hasSelection,
      action: () => run(() => editor.chain().focus().toggleStrike().run()),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      icon: <Link size={14} />,
      label: 'Insert link',
      shortcut: '⌘K',
      disabled: !hasSelection,
      action: () => run(onInsertLink),
    },
    {
      kind: 'action',
      icon: <Eraser size={14} />,
      label: 'Clear formatting',
      disabled: !hasSelection,
      action: () => run(() => editor.chain().focus().clearNodes().unsetAllMarks().run()),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      icon: <AlignLeft size={14} />,
      label: 'Paragraph',
      active: editor.isActive('paragraph'),
      action: () => run(() => editor.chain().focus().setParagraph().run()),
    },
    {
      kind: 'action',
      icon: <CheckSquare size={14} />,
      label: 'Select all',
      shortcut: '⌘A',
      action: () => run(() => editor.chain().focus().selectAll().run()),
    },
  ];

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left, top }}
      role="menu"
      aria-label="Editor options"
      onContextMenu={e => e.preventDefault()}
    >
      {/* ── Grammar suggestion (top of menu, when grammar check is active) ── */}
      {grammarMessage && (
        <>
          <div className={styles.checking} style={{ color: '#1e8e3e', fontStyle: 'normal', fontWeight: 500 }}>
            {grammarMessage}
          </div>
          {grammarSuggestion && grammarRange && onApplyGrammarFix && (
            <button
              type="button"
              role="menuitem"
              className={[styles.item, styles.suggestion].join(' ')}
              onClick={() => {
                onApplyGrammarFix(grammarRange.from, grammarRange.to, grammarSuggestion);
                onClose();
              }}
            >
              <span className={styles.itemLabel}>Fix: &quot;{grammarSuggestion}&quot;</span>
            </button>
          )}
          {onAiGrammarFix && (
            <button
              type="button"
              role="menuitem"
              className={[styles.item, styles.aiItem].join(' ')}
              onClick={() => {
                onAiGrammarFix();
                onClose();
              }}
            >
              <span className={styles.itemIcon}><Sparkles size={14} /></span>
              <span className={styles.itemLabel}>Fix with AI</span>
            </button>
          )}
          <div className={styles.separator} role="separator" />
        </>
      )}

      {/* ── Spell-check suggestions (top of menu) ── */}
      {showSpellSection && (
        <>
          {spellSuggestions === undefined ? (
            /* Dictionary still loading */
            <div className={styles.checking}>
              Checking…
            </div>
          ) : (
            /* Suggestions available */
            visibleSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                role="menuitem"
                className={[styles.item, styles.suggestion].join(' ')}
                onClick={() => {
                  onApplySuggestion?.(suggestion);
                  onClose();
                }}
              >
                <span className={styles.itemLabel}>{suggestion}</span>
              </button>
            ))
          )}
          <div className={styles.separator} role="separator" />
        </>
      )}

      {items.map((item, i) => {
        if (item.kind === 'separator') {
          return <div key={i} className={styles.separator} role="separator" />;
        }
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={[
              styles.item,
              item.active ? styles.active : '',
              item.disabled ? styles.disabled : '',
              item.label === 'Add comment' ? styles.primary : '',
            ].filter(Boolean).join(' ')}
            disabled={item.disabled}
            onClick={item.action}
          >
            <span className={styles.itemIcon}>{item.icon}</span>
            <span className={styles.itemLabel}>{item.label}</span>
            {item.shortcut && (
              <span className={styles.shortcut}>{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
