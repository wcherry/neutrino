'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Editor } from '@tiptap/react';
import { HamburgerMenu as HamburgerMenuBase, HamburgerMenuItem } from '@neutrino/ui';
import { Modal, ModalHeader, ModalBody } from '@neutrino/ui';
import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';
import { applyTextCase } from '@/lib/textCase';
import styles from './MenuBar.module.css';

// ── Help modal ────────────────────────────────────────────────────────────

const SHORTCUTS = [
  { action: 'Bold',             keys: ['Ctrl', 'B'] },
  { action: 'Italic',           keys: ['Ctrl', 'I'] },
  { action: 'Underline',        keys: ['Ctrl', 'U'] },
  { action: 'Strikethrough',    keys: ['Alt', 'Shift', '5'] },
  { action: 'Clear formatting', keys: ['Ctrl', '\\'] },
  { action: 'Undo',             keys: ['Ctrl', 'Z'] },
  { action: 'Redo',             keys: ['Ctrl', 'Y'] },
  { action: 'Save',             keys: ['Ctrl', 'S'] },
  { action: 'Select all',       keys: ['Ctrl', 'A'] },
  { action: 'Find in page',     keys: ['Ctrl', 'F'] },
  { action: 'Insert link',      keys: ['Ctrl', 'K'] },
  { action: 'Print',            keys: ['Ctrl', 'P'] },
  { action: 'Heading 1',        keys: ['Ctrl', 'Alt', '1'] },
  { action: 'Heading 2',        keys: ['Ctrl', 'Alt', '2'] },
  { action: 'Heading 3',        keys: ['Ctrl', 'Alt', '3'] },
  { action: 'Normal text',      keys: ['Ctrl', 'Alt', '0'] },
  { action: 'Bullet list',      keys: ['Ctrl', 'Shift', '8'] },
  { action: 'Numbered list',    keys: ['Ctrl', 'Shift', '7'] },
];

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="lg">
      <ModalHeader title="Neutrino Docs — Help" onClose={onClose} />
      <ModalBody>
        <section className={styles.helpSection}>
          <h3 className={styles.helpSectionTitle}>Getting started</h3>
          <ul className={styles.helpList}>
            <li>Click anywhere on the page to start typing.</li>
            <li>Use the toolbar to format text, insert tables, links, and images.</li>
            <li>Documents save automatically — look for &quot;All changes saved&quot; in the top bar.</li>
            <li>Use <strong>File → Page setup</strong> to change paper size, orientation, and margins.</li>
            <li>Use <strong>File → Export</strong> to download as Word, PDF, HTML, or plain text.</li>
          </ul>
        </section>

        <section className={styles.helpSection}>
          <h3 className={styles.helpSectionTitle}>Keyboard shortcuts</h3>
          <div className={styles.shortcutsGrid}>
            {SHORTCUTS.map(({ action, keys }) => (
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
        </section>

        <section className={styles.helpSection}>
          <h3 className={styles.helpSectionTitle}>Tips</h3>
          <ul className={styles.helpList}>
            <li>Right-click anywhere in the document for a context menu.</li>
            <li>Use the Outline panel to navigate long documents by heading.</li>
            <li>Version History lets you restore any previous save.</li>
            <li>Comments let you annotate specific sections.</li>
            <li>Import a Word (.docx) file to convert it to a Neutrino Doc.</li>
          </ul>
        </section>

        <section className={styles.helpSection}>
          <h3 className={styles.helpSectionTitle}>About</h3>
          <p className={styles.helpAbout}>
            Neutrino Docs is part of the Neutrino productivity suite — a Google Workspace-compatible
            platform for documents, spreadsheets, and cloud storage.
          </p>
        </section>
      </ModalBody>
    </Modal>
  );
}

// ── HamburgerMenu ─────────────────────────────────────────────────────────

export interface HamburgerMenuProps {
  editor: Editor | null;
  titleInputRef: React.RefObject<HTMLInputElement>;
  onSave: () => void;
  onNewDoc: () => void;
  onDuplicate: () => void;
  onImport: () => void;
  onExport: (format: 'docx' | 'pdf' | 'html' | 'txt') => void;
  onPageSetup: () => void;
  onPrint: () => void;
  // View panel toggles
  showOutline: boolean;
  onToggleOutline: () => void;
  showHistory: boolean;
  onToggleHistory: () => void;
  showComments: boolean;
  onToggleComments: () => void;
  distractionFree?: boolean;
  onToggleFocus?: () => void;
  showRulers: boolean;
  onToggleRulers: () => void;
  singlePageMode: boolean;
  onToggleSinglePage: () => void;
  // Layout & structure feature callbacks (only used when docsLayoutStructure flag is on)
  onInsertFootnote?: () => void;
  onInsertCrossRef?: () => void;
  onHeaderFooter?: () => void;
  onWatermark?: () => void;
  onTheme?: () => void;
  // Advanced formatting feature callbacks (only used when docsAdvancedFormatting flag is on)
  onStylesPalette?: () => void;
  onInsertLocalImage?: () => void;
  // Editing tools feature callbacks (only used when docsEditingTools flag is on)
  onOpenFindReplace?: () => void;
  grammarEnabled?: boolean;
  onToggleGrammar?: () => void;
  onAiSuggestions?: () => void;
  onAiSummarize?: () => void;
  onAiChangeTone?: () => void;
}

export function HamburgerMenu({
  editor,
  titleInputRef,
  onSave,
  onNewDoc,
  onDuplicate,
  onImport,
  onExport,
  onPageSetup,
  onPrint,
  showOutline,
  onToggleOutline,
  showHistory,
  onToggleHistory,
  showComments,
  onToggleComments,
  distractionFree,
  onToggleFocus,
  showRulers,
  onToggleRulers,
  singlePageMode,
  onToggleSinglePage,
  onInsertFootnote,
  onInsertCrossRef,
  onHeaderFooter,
  onWatermark,
  onTheme,
  onStylesPalette,
  onInsertLocalImage,
  onOpenFindReplace,
  grammarEnabled,
  onToggleGrammar,
  onAiSuggestions,
  onAiSummarize,
  onAiChangeTone,
}: HamburgerMenuProps) {
  const flags = useFeatureFlags();
  const router = useRouter();
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onSave]);

  const items: HamburgerMenuItem[] = [
    {
      kind: 'submenu',
      label: 'File',
      items: [
        { kind: 'action', label: 'New document',   shortcut: 'Ctrl+N', action: () => onNewDoc() },
        { kind: 'action', label: 'Open docs list',                     action: () => router.push('/docs') },
        { kind: 'separator' },
        { kind: 'action', label: 'Rename',                             action: () => { titleInputRef.current?.focus(); titleInputRef.current?.select(); } },
        { kind: 'action', label: 'Duplicate',                          action: () => onDuplicate() },
        { kind: 'separator' },
        { kind: 'action', label: 'Save',            shortcut: 'Ctrl+S', action: () => onSave() },
        { kind: 'separator' },
        { kind: 'action', label: 'Import (.docx)',                     action: () => onImport() },
        {
          kind: 'submenu', label: 'Export as…', items: [
            { kind: 'action', label: 'Microsoft Word (.docx)', action: () => onExport('docx') },
            { kind: 'action', label: 'PDF (.pdf)',             action: () => onExport('pdf') },
            { kind: 'action', label: 'Web page (.html)',       action: () => onExport('html') },
            { kind: 'action', label: 'Plain text (.txt)',      action: () => onExport('txt') },
          ],
        },
        { kind: 'separator' },
        { kind: 'action', label: 'Page setup…',                        action: () => onPageSetup() },
        { kind: 'action', label: 'Print…',          shortcut: 'Ctrl+P', action: () => onPrint() },
      ],
    },
    {
      kind: 'submenu',
      label: 'Edit',
      items: [
        { kind: 'action', label: 'Undo',       shortcut: 'Ctrl+Z', disabled: !editor?.can().undo(), action: () => editor?.chain().focus().undo().run() },
        { kind: 'action', label: 'Redo',       shortcut: 'Ctrl+Y', disabled: !editor?.can().redo(), action: () => editor?.chain().focus().redo().run() },
        { kind: 'separator' },
        { kind: 'action', label: 'Cut',        shortcut: 'Ctrl+X', action: () => document.execCommand('cut') },
        { kind: 'action', label: 'Copy',       shortcut: 'Ctrl+C', action: () => document.execCommand('copy') },
        { kind: 'action', label: 'Paste',      shortcut: 'Ctrl+V', action: () => document.execCommand('paste') },
        { kind: 'separator' },
        { kind: 'action', label: 'Select all', shortcut: 'Ctrl+A', action: () => editor?.chain().focus().selectAll().run() },
        ...(flags.docsEditingTools ? [
          { kind: 'separator' as const },
          { kind: 'action' as const, label: 'Find and replace…', shortcut: 'Ctrl+F', action: () => onOpenFindReplace?.() },
          { kind: 'action' as const, label: grammarEnabled ? 'Grammar check ✓' : 'Grammar check', action: () => onToggleGrammar?.() },
        ] : []),
      ],
    },
    {
      kind: 'submenu',
      label: 'Format',
      items: [
        { kind: 'action', label: 'Bold',          shortcut: 'Ctrl+B',  action: () => editor?.chain().focus().toggleBold().run() },
        { kind: 'action', label: 'Italic',        shortcut: 'Ctrl+I',  action: () => editor?.chain().focus().toggleItalic().run() },
        { kind: 'action', label: 'Underline',     shortcut: 'Ctrl+U',  action: () => editor?.chain().focus().toggleUnderline().run() },
        { kind: 'action', label: 'Strikethrough',                      action: () => editor?.chain().focus().toggleStrike().run() },
        { kind: 'separator' },
        { kind: 'action', label: 'Clear formatting', shortcut: 'Ctrl+\\', action: () => editor?.chain().focus().clearNodes().unsetAllMarks().run() },
        { kind: 'separator' },
        {
          kind: 'submenu', label: 'Paragraph style', items: [
            { kind: 'action', label: 'Normal text', shortcut: 'Ctrl+Alt+0', action: () => editor?.chain().focus().setParagraph().run() },
            { kind: 'separator' },
            { kind: 'action', label: 'Heading 1',   shortcut: 'Ctrl+Alt+1', action: () => editor?.chain().focus().toggleHeading({ level: 1 }).run() },
            { kind: 'action', label: 'Heading 2',   shortcut: 'Ctrl+Alt+2', action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run() },
            { kind: 'action', label: 'Heading 3',   shortcut: 'Ctrl+Alt+3', action: () => editor?.chain().focus().toggleHeading({ level: 3 }).run() },
            { kind: 'action', label: 'Heading 4',                           action: () => editor?.chain().focus().toggleHeading({ level: 4 }).run() },
            { kind: 'action', label: 'Heading 5',                           action: () => editor?.chain().focus().toggleHeading({ level: 5 }).run() },
            { kind: 'action', label: 'Heading 6',                           action: () => editor?.chain().focus().toggleHeading({ level: 6 }).run() },
          ],
        },
        {
          kind: 'submenu', label: 'Line spacing', items: [
            { kind: 'action', label: 'Single (1.0)',       action: () => {} },
            { kind: 'action', label: 'Comfortable (1.15)', action: () => {} },
            { kind: 'action', label: 'Double (2.0)',       action: () => {} },
          ],
        },
        ...(flags.docsLayoutStructure ? [
          { kind: 'separator' as const },
          { kind: 'action' as const, label: 'Header & footer…',  action: () => onHeaderFooter?.() },
          { kind: 'action' as const, label: 'Watermark…',         action: () => onWatermark?.() },
          { kind: 'action' as const, label: 'Document theme…',    action: () => onTheme?.() },
        ] : []),
        ...(flags.docsAdvancedFormatting ? [
          { kind: 'separator' as const },
          { kind: 'action' as const, label: 'Paragraph styles…', action: () => onStylesPalette?.() },
          { kind: 'separator' as const },
          { kind: 'action' as const, label: 'Superscript', shortcut: 'Ctrl+.', action: () => editor?.chain().focus().toggleMark('superscript').run() },
          { kind: 'action' as const, label: 'Subscript',   shortcut: 'Ctrl+,', action: () => editor?.chain().focus().toggleMark('subscript').run() },
          { kind: 'separator' as const },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { kind: 'action' as const, label: 'Indent',              action: () => (editor?.chain().focus() as any)?.indent?.()?.run?.() },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { kind: 'action' as const, label: 'Outdent',             action: () => (editor?.chain().focus() as any)?.outdent?.()?.run?.() },
          { kind: 'separator' as const },
          {
            kind: 'submenu' as const, label: 'Text case', items: [
              { kind: 'action' as const, label: 'UPPERCASE',     action: () => editor && applyTextCase(editor, 'uppercase') },
              { kind: 'action' as const, label: 'lowercase',     action: () => editor && applyTextCase(editor, 'lowercase') },
              { kind: 'action' as const, label: 'Title Case',    action: () => editor && applyTextCase(editor, 'title') },
              { kind: 'action' as const, label: 'Sentence case', action: () => editor && applyTextCase(editor, 'sentence') },
            ],
          },
        ] : []),
      ],
    },
    {
      kind: 'submenu',
      label: 'Insert',
      items: [
        { kind: 'action', label: 'Link…',           shortcut: 'Ctrl+K', action: () => { const url = window.prompt('Enter URL:', 'https://'); if (url) editor?.chain().focus().setLink({ href: url }).run(); } },
        flags.docsAdvancedFormatting
          ? { kind: 'action' as const, label: 'Image (upload)…', action: () => onInsertLocalImage?.() }
          : { kind: 'action' as const, label: 'Image…',           action: () => { const url = window.prompt('Enter image URL:'); if (url) editor?.chain().focus().setImage({ src: url }).run(); } },
        { kind: 'separator' },
        { kind: 'action', label: 'Table',                               action: () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
        { kind: 'action', label: 'Horizontal rule',                     action: () => editor?.chain().focus().setHorizontalRule().run() },
        { kind: 'action', label: 'Code block',                          action: () => editor?.chain().focus().toggleCodeBlock().run() },
        { kind: 'action', label: 'Blockquote',                          action: () => editor?.chain().focus().toggleBlockquote().run() },
        ...(flags.docsLayoutStructure ? [
          { kind: 'separator' as const },
          { kind: 'action' as const, label: 'Table of contents',  action: () => editor?.chain().focus().insertContent({ type: 'tableOfContents' }).run() },
          { kind: 'action' as const, label: 'Footnote',           action: () => onInsertFootnote?.() },
          { kind: 'action' as const, label: 'Cross-reference…',  action: () => onInsertCrossRef?.() },
          { kind: 'action' as const, label: 'Section break',      action: () => editor?.chain().focus().insertContent({ type: 'sectionBreak' }).run() },
          { kind: 'action' as const, label: '2-column layout',    action: () => editor?.chain().focus().insertContent({ type: 'columnLayout', attrs: { columns: 2 }, content: [{ type: 'paragraph' }] }).run() },
          { kind: 'action' as const, label: '3-column layout',    action: () => editor?.chain().focus().insertContent({ type: 'columnLayout', attrs: { columns: 3 }, content: [{ type: 'paragraph' }] }).run() },
        ] : []),
      ],
    },
    ...(flags.docsEditingTools ? [{
      kind: 'submenu' as const,
      label: 'AI Writing',
      items: [
        { kind: 'action' as const, label: 'Suggestions',  action: () => onAiSuggestions?.() },
        { kind: 'action' as const, label: 'Summarize',    action: () => onAiSummarize?.() },
        { kind: 'action' as const, label: 'Change tone…', action: () => onAiChangeTone?.() },
      ],
    }] : []),
    {
      kind: 'submenu',
      label: 'View',
      items: [
        { kind: 'action', label: showOutline ? 'Outline ✓'          : 'Outline',          action: () => onToggleOutline() },
        { kind: 'action', label: showHistory ? 'Version history ✓'  : 'Version history',  action: () => onToggleHistory() },
        { kind: 'action', label: showComments ? 'Comments ✓'        : 'Comments',         action: () => onToggleComments() },
        ...(flags.docsCompare ? [
          { kind: 'action' as const, label: 'Compare versions…', action: () => onToggleHistory() },
        ] : []),
        { kind: 'separator' as const },
        { kind: 'action' as const, label: showRulers ? 'Rulers ✓' : 'Rulers', action: () => onToggleRulers() },
        { kind: 'action' as const, label: singlePageMode ? 'Single page ✓' : 'Single page', action: () => onToggleSinglePage() },
        ...(flags.docsDistractionFree ? [
          { kind: 'separator' as const },
          { kind: 'action' as const, label: distractionFree ? 'Focus mode ✓' : 'Focus mode', shortcut: 'Ctrl+Shift+F', action: () => onToggleFocus?.() },
        ] : []),
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
