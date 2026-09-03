'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { HamburgerMenu as HamburgerMenuBase, HamburgerMenuItem } from '@neutrino/ui';
import { Modal, ModalHeader, ModalBody } from '@neutrino/ui';
import { MARKDOWN_SHORTCUTS } from './blockEditorConstants';
import styles from './MenuBar.module.css';

// ── Help modal ────────────────────────────────────────────────────────────

interface ShortcutRow {
  action: string;
  keys: string[];
}

/**
 * Every markdown shortcut the editor listens for, from the table it listens
 * with, so the two can't drift — followed by the note-level ones the page
 * itself handles.
 */
const KEY_SHORTCUTS: ShortcutRow[] = [
  ...MARKDOWN_SHORTCUTS.map(({ label, keys }) => ({ action: label, keys })),
  { action: 'Select all', keys: ['Ctrl', 'A'] },
  { action: 'Save', keys: ['Ctrl', 'S'] },
  { action: 'Print', keys: ['Ctrl', 'P'] },
];

/** Markdown that converts as it is typed, needing no shortcut at all. */
const TYPED_MARKDOWN: ShortcutRow[] = [
  { action: 'Bold', keys: ['**text**'] },
  { action: 'Italic', keys: ['*text*'] },
  { action: 'Strikethrough', keys: ['~~text~~'] },
  { action: 'Inline code', keys: ['`text`'] },
  { action: 'Heading', keys: ['#', 'Space'] },
  { action: 'Bullet list', keys: ['-', 'Space'] },
  { action: 'Numbered list', keys: ['1.', 'Space'] },
  { action: 'Task checkbox', keys: ['[]', 'Space'] },
  { action: 'Blockquote', keys: ['>', 'Space'] },
  { action: 'Divider', keys: ['---'] },
  { action: 'Block menu', keys: ['/'] },
  { action: 'Link to a note', keys: ['[[', 'title'] },
  { action: 'New block', keys: ['Enter'] },
  { action: 'Merge with previous', keys: ['Backspace'] },
];

function ShortcutGrid({ rows }: { rows: ShortcutRow[] }) {
  return (
    <div className={styles.shortcutsGrid}>
      {rows.map(({ action, keys }) => (
        <div key={action} className={styles.shortcutRow}>
          <span className={styles.shortcutAction}>{action}</span>
          <span className={styles.shortcutKeys}>
            {keys.map((k, i) => (
              <React.Fragment key={k}>
                {i > 0 && <span className={styles.shortcutPlus}>+</span>}
                <kbd className={styles.kbd}>{k}</kbd>
              </React.Fragment>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="lg">
      <ModalHeader title="Neutrino Notes — Help" onClose={onClose} />
      <ModalBody>
        <section className={styles.helpSection}>
          <h3 className={styles.helpSectionTitle}>Getting started</h3>
          <ul className={styles.helpList}>
            <li>Click anywhere in the note to start typing.</li>
            <li>Notes save automatically — look for &quot;Saved&quot; in the top bar.</li>
            <li>Type <strong>/</strong> at the start of a block for headings, lists, a quote, code, a divider or a table.</li>
            <li>Type <strong>[[</strong> to link to another note by title.</li>
            <li>Drag the handle on the left of a block to reorder it.</li>
          </ul>
        </section>

        <section className={styles.helpSection}>
          <h3 className={styles.helpSectionTitle}>Keyboard shortcuts</h3>
          <ShortcutGrid rows={KEY_SHORTCUTS} />
        </section>

        <section className={styles.helpSection}>
          <h3 className={styles.helpSectionTitle}>Markdown as you type</h3>
          <ShortcutGrid rows={TYPED_MARKDOWN} />
        </section>

        <section className={styles.helpSection}>
          <h3 className={styles.helpSectionTitle}>Tips</h3>
          <ul className={styles.helpList}>
            <li>On a Mac, use <strong>⌘</strong> wherever the shortcuts above say Ctrl.</li>
            <li>A formatting shortcut with nothing selected leaves the caret between the markers, ready to type into.</li>
            <li>Notes linked to this one with <strong>[[wiki links]]</strong> show up under Linked from.</li>
            <li>Notes are end-to-end encrypted — only you can read the content.</li>
          </ul>
        </section>
      </ModalBody>
    </Modal>
  );
}

// ── HamburgerMenu ─────────────────────────────────────────────────────────

export interface HamburgerMenuProps {
  titleInputRef: React.RefObject<HTMLInputElement>;
  onSave: () => void;
  onNewNote: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: (format: 'md' | 'txt') => void;
  onPrint: () => void;
  onSelectAll: () => void;
  showBacklinks: boolean;
  onToggleBacklinks: () => void;
}

export function HamburgerMenu({
  titleInputRef,
  onSave,
  onNewNote,
  onDuplicate,
  onDelete,
  onExport,
  onPrint,
  onSelectAll,
  showBacklinks,
  onToggleBacklinks,
}: HamburgerMenuProps) {
  const router = useRouter();
  const [showHelp, setShowHelp] = useState(false);

  const items: HamburgerMenuItem[] = [
    {
      kind: 'submenu',
      label: 'File',
      items: [
        { kind: 'action', label: 'New note',       shortcut: 'Ctrl+N', action: () => onNewNote() },
        { kind: 'action', label: 'Open notes list',                    action: () => router.push('/notes') },
        { kind: 'separator' },
        { kind: 'action', label: 'Rename',                             action: () => { titleInputRef.current?.focus(); titleInputRef.current?.select(); } },
        { kind: 'action', label: 'Duplicate',                          action: () => onDuplicate() },
        { kind: 'separator' },
        { kind: 'action', label: 'Save',            shortcut: 'Ctrl+S', action: () => onSave() },
        {
          kind: 'submenu', label: 'Export as…', items: [
            { kind: 'action', label: 'Markdown (.md)',   action: () => onExport('md') },
            { kind: 'action', label: 'Plain text (.txt)', action: () => onExport('txt') },
          ],
        },
        { kind: 'action', label: 'Print…',          shortcut: 'Ctrl+P', action: () => onPrint() },
        { kind: 'separator' },
        { kind: 'action', label: 'Move to trash', danger: true,        action: () => onDelete() },
      ],
    },
    {
      kind: 'submenu',
      label: 'Edit',
      items: [
        { kind: 'action', label: 'Undo',       shortcut: 'Ctrl+Z',       action: () => document.execCommand('undo') },
        { kind: 'action', label: 'Redo',       shortcut: 'Ctrl+Y',       action: () => document.execCommand('redo') },
        { kind: 'separator' },
        { kind: 'action', label: 'Cut',        shortcut: 'Ctrl+X',       action: () => document.execCommand('cut') },
        { kind: 'action', label: 'Copy',       shortcut: 'Ctrl+C',       action: () => document.execCommand('copy') },
        { kind: 'action', label: 'Paste',      shortcut: 'Ctrl+V',       action: () => document.execCommand('paste') },
        { kind: 'separator' },
        { kind: 'action', label: 'Select all', shortcut: 'Ctrl+A',       action: () => onSelectAll() },
      ],
    },
    {
      kind: 'submenu',
      label: 'View',
      items: [
        { kind: 'action', label: showBacklinks ? 'Linked notes panel ✓' : 'Linked notes panel', action: () => onToggleBacklinks() },
      ],
    },
    {
      kind: 'submenu',
      label: 'Help',
      items: [
        { kind: 'action', label: 'Keyboard shortcuts & help', action: () => setShowHelp(true) },
      ],
    },
  ];

  return (
    <>
      <HamburgerMenuBase items={items} />
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </>
  );
}
