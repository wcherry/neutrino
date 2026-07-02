'use client';

import React, { useState, useRef, useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Code, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Link, Image, Table, Minus, Undo, Redo, Quote, ArrowUpDown,
  Superscript, Subscript, Indent, Outdent, Sparkles, Search, SpellCheck, Network,
} from 'lucide-react';
import {
  Toolbar as RickTextToolbar, ToolbarGroup, ToolbarDivider, ToolbarButton, ToolbarSelect, ColorPickerPopover,
} from '@neutrino/ui';
import { FONT_FAMILIES } from '@/constants/editor';
import { applyTextCase, type TextCaseMode } from '@/lib/textCase';
import {
  BULLET_LIST_STYLES,
  ORDERED_LIST_STYLES,
} from '@/lib/extensions/ListStyleExtension';
import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';
import styles from './page.module.css';

const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '60', '72'];

const LINE_SPACING_PRESETS = [
  { value: 1,    label: 'Single' },
  { value: 1.15, label: '1.15' },
  { value: 1.5,  label: '1.5' },
  { value: 2,    label: 'Double' },
];

// ── Line spacing dropdown ──────────────────────────────────────────────────────

function LineSpacingMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const attrs = editor.getAttributes('paragraph');
  const currentLH = (attrs.lineHeight as number | null) ?? 1.15;
  const spaceBefore = (attrs.spaceBefore as number | null) ?? 0;
  const spaceAfter  = (attrs.spaceAfter  as number | null) ?? 0;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <ToolbarButton active={open} onClick={() => setOpen(v => !v)} title="Line & paragraph spacing">
        <ArrowUpDown size={15} />
      </ToolbarButton>
      {open && (
        <div className={styles.lineSpacingDropdown}>
          {LINE_SPACING_PRESETS.map(p => (
            <button
              key={p.value}
              className={styles.lineSpacingItem}
              onClick={() => { editor.chain().focus().updateAttributes('paragraph', { lineHeight: p.value }).run(); setOpen(false); }}
            >
              <span className={styles.lineSpacingCheck}>{Math.abs(currentLH - p.value) < 0.01 ? '✓' : ''}</span>
              {p.label}
            </button>
          ))}
          <div className={styles.lineSpacingDivider} />
          <button
            className={styles.lineSpacingItem}
            onClick={() => { editor.chain().focus().updateAttributes('paragraph', { spaceBefore: spaceBefore > 0 ? 0 : 8 }).run(); setOpen(false); }}
          >
            <span className={styles.lineSpacingCheck} />
            {spaceBefore > 0 ? 'Remove space before paragraph' : 'Add space before paragraph'}
          </button>
          <button
            className={styles.lineSpacingItem}
            onClick={() => { editor.chain().focus().updateAttributes('paragraph', { spaceAfter: spaceAfter > 0 ? 0 : 8 }).run(); setOpen(false); }}
          >
            <span className={styles.lineSpacingCheck} />
            {spaceAfter > 0 ? 'Remove space after paragraph' : 'Add space after paragraph'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Text case dropdown ─────────────────────────────────────────────────────────

const TEXT_CASE_OPTIONS: { value: TextCaseMode; label: string }[] = [
  { value: 'uppercase', label: 'UPPERCASE' },
  { value: 'lowercase', label: 'lowercase' },
  { value: 'title',     label: 'Title Case' },
  { value: 'sentence',  label: 'Sentence case' },
];

function TextCaseMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <ToolbarButton
        active={open}
        onClick={() => setOpen(v => !v)}
        title="Text case"
        style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.03em' }}
      >
        Aa
      </ToolbarButton>
      {open && (
        <div className={styles.lineSpacingDropdown}>
          {TEXT_CASE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={styles.lineSpacingItem}
              onClick={() => { applyTextCase(editor, opt.value); setOpen(false); }}
            >
              <span className={styles.lineSpacingCheck} />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── List style dropdown ────────────────────────────────────────────────────────

function ListStyleMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isBullet  = editor.isActive('bulletList');
  const isOrdered = editor.isActive('orderedList');

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!isBullet && !isOrdered) return null;

  const options = isBullet ? BULLET_LIST_STYLES : ORDERED_LIST_STYLES;
  const nodeType = isBullet ? 'bulletList' : 'orderedList';
  const currentStyle = (editor.getAttributes(nodeType).listStyleType as string) ?? (isBullet ? 'disc' : 'decimal');

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <ToolbarButton active={open} onClick={() => setOpen(v => !v)} title="List style">
        <span style={{ fontSize: 11 }}>▾</span>
      </ToolbarButton>
      {open && (
        <div className={styles.lineSpacingDropdown}>
          {options.map(opt => (
            <button
              key={opt.value}
              className={styles.lineSpacingItem}
              onClick={() => {
                editor.chain().focus().updateAttributes(nodeType, { listStyleType: opt.value }).run();
                setOpen(false);
              }}
            >
              <span className={styles.lineSpacingCheck}>{currentStyle === opt.value ? '✓' : ''}</span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Headings list ──────────────────────────────────────────────────────────────

const HEADINGS: { label: string; level: number | null }[] = [
  { label: 'Normal', level: null },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
  { label: 'Heading 4', level: 4 },
  { label: 'Heading 5', level: 5 },
  { label: 'Heading 6', level: 6 },
];

// ── AI Writing dropdown (editing tools flag) ───────────────────────────────────

function AiWritingMenu({
  onSuggestions,
  onSummarize,
  onChangeTone,
}: {
  onSuggestions?: () => void;
  onSummarize?: () => void;
  onChangeTone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <ToolbarButton
        active={open}
        onClick={() => setOpen(v => !v)}
        title="AI writing"
        style={{ gap: 3, display: 'flex', alignItems: 'center' }}
      >
        <Sparkles size={14} />
        <span style={{ fontSize: 11, fontWeight: 500 }}>AI</span>
      </ToolbarButton>
      {open && (
        <div className={styles.lineSpacingDropdown} style={{ minWidth: 160 }}>
          <button className={styles.lineSpacingItem} onClick={() => { onSuggestions?.(); setOpen(false); }}>
            <span className={styles.lineSpacingCheck} />
            Suggestions
          </button>
          <button className={styles.lineSpacingItem} onClick={() => { onSummarize?.(); setOpen(false); }}>
            <span className={styles.lineSpacingCheck} />
            Summarize
          </button>
          <button className={styles.lineSpacingItem} onClick={() => { onChangeTone?.(); setOpen(false); }}>
            <span className={styles.lineSpacingCheck} />
            Change tone…
          </button>
        </div>
      )}
    </div>
  );
}

// ── Toolbar component ──────────────────────────────────────────────────────────

export interface ToolbarProps {
  editor: Editor | null;
  onInsertImage: () => void;
  /** Local file upload handler (advanced formatting flag only). */
  onInsertLocalImage?: () => void;
  /** Open paragraph styles palette (advanced formatting flag only). */
  onOpenStylesPalette?: () => void;
  /** Open image properties modal (advanced formatting flag only). */
  onOpenImageProps?: () => void;
  /** Open table cell format modal (advanced formatting flag only). */
  onOpenTableCellModal?: () => void;
  // Editing tools props (feature gap #3, docsEditingTools flag only)
  grammarEnabled?: boolean;
  onToggleGrammar?: () => void;
  onAiSuggestions?: () => void;
  onAiSummarize?: () => void;
  onAiChangeTone?: () => void;
  onOpenFindReplace?: () => void;
  onInsertDiagram?: () => void;
}

export function Toolbar({
  editor,
  onInsertImage,
  onInsertLocalImage,
  onOpenStylesPalette,
  onOpenImageProps,
  onOpenTableCellModal,
  grammarEnabled,
  onToggleGrammar,
  onAiSuggestions,
  onAiSummarize,
  onAiChangeTone,
  onOpenFindReplace,
  onInsertDiagram,
}: ToolbarProps) {
  const flags = useFeatureFlags();
  const colorSelRef = useRef<{ from: number; to: number } | null>(null);
  if (!editor) return null;

  const currentHeading = HEADINGS.find(h =>
    h.level ? editor.isActive('heading', { level: h.level }) : !editor.isActive('heading')
  );

  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Enter URL:', previous ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  };

  return (
    <RickTextToolbar>
      <ToolbarGroup>
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (Ctrl+Z)">
          <Undo size={15} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (Ctrl+Y)">
          <Redo size={15} />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* ── Paragraph styles palette button (advanced flag only) ── */}
      {flags.docsAdvancedFormatting && onOpenStylesPalette && (
        <>
          <ToolbarButton onClick={onOpenStylesPalette} title="Paragraph styles" wide>
            Styles
          </ToolbarButton>
          <ToolbarDivider />
        </>
      )}

      <ToolbarSelect
        value={currentHeading?.label ?? 'Normal'}
        onChange={e => {
          const item = HEADINGS.find(h => h.label === e.target.value);
          if (!item) return;
          if (item.level === null) {
            editor.chain().focus().setParagraph().run();
          } else {
            editor.chain().focus().toggleHeading({ level: item.level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
          }
        }}
        title="Paragraph style"
        style={{ width: 110 }}
      >
        {HEADINGS.map(h => <option key={h.label} value={h.label}>{h.label}</option>)}
      </ToolbarSelect>

      <ToolbarDivider />

      <ToolbarSelect
        value={editor.getAttributes('textStyle').fontFamily ?? ''}
        onChange={e => {
          if (e.target.value === '') {
            editor.chain().focus().unsetFontFamily().run();
          } else {
            editor.chain().focus().setFontFamily(e.target.value).run();
          }
        }}
        title="Font family"
        style={{ width: 120 }}
      >
        {FONT_FAMILIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
      </ToolbarSelect>

      <ToolbarSelect
        style={{ width: 56 }}
        title="Font size"
        defaultValue="11"
        onChange={e => {
          editor.chain().focus().setMark('textStyle', { fontSize: `${e.target.value}pt` }).run();
        }}
      >
        {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
      </ToolbarSelect>

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (Ctrl+B)" style={{ fontWeight: 700 }}>B</ToolbarButton>
        <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (Ctrl+I)" style={{ fontStyle: 'italic' }}>I</ToolbarButton>
        <ToolbarButton active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline (Ctrl+U)" style={{ textDecoration: 'underline' }}>U</ToolbarButton>
        <ToolbarButton active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough" style={{ textDecoration: 'line-through' }}>S</ToolbarButton>

        {/* Superscript / Subscript (advanced flag only) */}
        {flags.docsAdvancedFormatting && (
          <>
            <ToolbarButton
              active={editor.isActive('superscript')}
              onClick={() => editor.chain().focus().toggleMark('superscript').run()}
              title="Superscript (Ctrl+.)"
            >
              <Superscript size={15} />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive('subscript')}
              onClick={() => editor.chain().focus().toggleMark('subscript').run()}
              title="Subscript (Ctrl+,)"
            >
              <Subscript size={15} />
            </ToolbarButton>
          </>
        )}
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <ColorPickerPopover
          color={editor.getAttributes('textStyle').color ?? '#202124'}
          onOpen={() => {
            const { from, to } = editor.state.selection;
            colorSelRef.current = { from, to };
          }}
          onChange={(hex) => {
            const sel = colorSelRef.current;
            if (sel && sel.from !== sel.to) {
              editor.chain().focus().setTextSelection(sel).setColor(hex).run();
            } else {
              editor.chain().focus().setColor(hex).run();
            }
          }}
          title="Text color"
        >
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>A</span>
            <span style={{ display: 'block', width: 14, height: 3, borderRadius: 2, backgroundColor: editor.getAttributes('textStyle').color ?? '#202124' }} />
          </span>
        </ColorPickerPopover>
        <ColorPickerPopover
          color={editor.getAttributes('highlight').color ?? '#fef08a'}
          onChange={(hex) => editor.chain().focus().toggleHighlight({ color: hex }).run()}
          title="Highlight color"
        >
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1 }}>
            <span style={{ fontSize: 12, lineHeight: 1 }}>⬛</span>
            <span style={{ display: 'block', width: 14, height: 3, borderRadius: 2, backgroundColor: editor.getAttributes('highlight').color ?? '#fef08a' }} />
          </span>
        </ColorPickerPopover>
      </ToolbarGroup>

      <ToolbarDivider />

      {/* Text case (advanced flag only) */}
      {flags.docsAdvancedFormatting && (
        <>
          <TextCaseMenu editor={editor} />
          <ToolbarDivider />
        </>
      )}

      <LineSpacingMenu editor={editor} />

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarButton active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Align left"><AlignLeft size={15} /></ToolbarButton>
        <ToolbarButton active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Align center"><AlignCenter size={15} /></ToolbarButton>
        <ToolbarButton active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Align right"><AlignRight size={15} /></ToolbarButton>
        <ToolbarButton active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()} title="Justify"><AlignJustify size={15} /></ToolbarButton>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bulleted list"><List size={15} /></ToolbarButton>
        <ToolbarButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered size={15} /></ToolbarButton>

        {/* List style type dropdown (advanced flag only, shown only when a list is active) */}
        {flags.docsAdvancedFormatting && (
          <ListStyleMenu editor={editor} />
        )}

        <ToolbarButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote"><Quote size={15} /></ToolbarButton>
        <ToolbarButton active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code"><Code size={15} /></ToolbarButton>
      </ToolbarGroup>

      {/* Indent / Outdent (advanced flag only) */}
      {flags.docsAdvancedFormatting && (
        <>
          <ToolbarDivider />
          <ToolbarGroup>
            <ToolbarButton
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={() => (editor.chain().focus() as any)?.outdent?.()?.run?.()}
              title="Outdent (Shift+Tab)"
            >
              <Outdent size={15} />
            </ToolbarButton>
            <ToolbarButton
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={() => (editor.chain().focus() as any)?.indent?.()?.run?.()}
              title="Indent (Tab)"
            >
              <Indent size={15} />
            </ToolbarButton>
          </ToolbarGroup>
        </>
      )}

      <ToolbarDivider />

      <ToolbarGroup>
        <ToolbarButton active={editor.isActive('link')} onClick={setLink} title="Insert link"><Link size={15} /></ToolbarButton>

        {/* When advanced flag is on: show a URL insert + a local upload option */}
        {flags.docsAdvancedFormatting && onInsertLocalImage ? (
          <>
            <ToolbarButton onClick={onInsertLocalImage} title="Upload local image"><Image size={15} /></ToolbarButton>
            {/* When an image is selected, show properties button */}
            {editor.isActive('image') && onOpenImageProps && (
              <ToolbarButton onClick={onOpenImageProps} title="Image properties" wide>
                Img…
              </ToolbarButton>
            )}
          </>
        ) : (
          <ToolbarButton onClick={onInsertImage} title="Insert image"><Image size={15} /></ToolbarButton>
        )}

        <ToolbarButton onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert table"><Table size={15} /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule"><Minus size={15} /></ToolbarButton>
        {onInsertDiagram && (
          <ToolbarButton onClick={onInsertDiagram} title="Insert diagram">
            <Network size={15} />
          </ToolbarButton>
        )}
      </ToolbarGroup>

      {editor.isActive('table') && (
        <>
          <ToolbarDivider />
          <ToolbarGroup>
            <ToolbarButton wide onClick={() => editor.chain().focus().addColumnAfter().run()} title="Add column">+Col</ToolbarButton>
            <ToolbarButton wide onClick={() => editor.chain().focus().addRowAfter().run()} title="Add row">+Row</ToolbarButton>
            <ToolbarButton wide onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column">-Col</ToolbarButton>
            <ToolbarButton wide onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row">-Row</ToolbarButton>
            <ToolbarButton wide onClick={() => editor.chain().focus().mergeCells().run()} title="Merge cells">Merge</ToolbarButton>
            <ToolbarButton wide onClick={() => editor.chain().focus().splitCell().run()} title="Split cell">Split</ToolbarButton>
            <ToolbarButton wide onClick={() => editor.chain().focus().deleteTable().run()} title="Delete table" style={{ color: '#d93025' }}>Del Table</ToolbarButton>

            {/* Cell formatting (advanced flag only) */}
            {flags.docsAdvancedFormatting && onOpenTableCellModal && (
              <ToolbarButton wide onClick={onOpenTableCellModal} title="Cell formatting">Cell…</ToolbarButton>
            )}
          </ToolbarGroup>
        </>
      )}

      {/* ── Editing tools: grammar toggle + find/replace + AI writing ── */}
      {flags.docsEditingTools && (
        <>
          <ToolbarDivider />
          <ToolbarGroup>
            <ToolbarButton
              active={grammarEnabled}
              onClick={onToggleGrammar}
              title={grammarEnabled ? 'Grammar check on — click to disable' : 'Enable grammar check'}
            >
              <SpellCheck size={15} />
            </ToolbarButton>
            <ToolbarButton
              onClick={onOpenFindReplace}
              title="Find and replace (Ctrl+F)"
            >
              <Search size={15} />
            </ToolbarButton>
            <AiWritingMenu
              onSuggestions={onAiSuggestions}
              onSummarize={onAiSummarize}
              onChangeTone={onAiChangeTone}
            />
          </ToolbarGroup>
        </>
      )}
    </RickTextToolbar>
  );
}
