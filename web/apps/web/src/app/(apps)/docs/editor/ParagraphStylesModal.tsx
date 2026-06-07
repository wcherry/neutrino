'use client';

/**
 * ParagraphStylesModal — a named styles palette for the Docs editor.
 *
 * Shows a grid of named styles (Normal, Title, Subtitle, Heading 1–6,
 * Quote, Code Block, Caption).  Clicking a style applies it to the current
 * paragraph / selection via TipTap commands.
 *
 */

import React from 'react';
import type { Editor } from '@tiptap/react';
import styles from './page.module.css';
import palStyles from './ParagraphStylesModal.module.css';

interface Props {
  editor: Editor;
  onClose: () => void;
}

interface NamedStyle {
  name: string;
  apply: (editor: Editor) => void;
}

const NAMED_STYLES: NamedStyle[] = [
  {
    name: 'Normal',
    apply: (e) => e.chain().focus().setParagraph().run(),
  },
  {
    name: 'Title',
    apply: (e) =>
      e.chain().focus().setParagraph().setMark('textStyle', { fontSize: '24pt' }).run(),
  },
  {
    name: 'Subtitle',
    apply: (e) =>
      e.chain().focus().setParagraph().setMark('textStyle', { fontSize: '14pt', color: '#5f6368' }).run(),
  },
  {
    name: 'Heading 1',
    apply: (e) => e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    name: 'Heading 2',
    apply: (e) => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    name: 'Heading 3',
    apply: (e) => e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    name: 'Heading 4',
    apply: (e) => e.chain().focus().setHeading({ level: 4 }).run(),
  },
  {
    name: 'Heading 5',
    apply: (e) => e.chain().focus().setHeading({ level: 5 }).run(),
  },
  {
    name: 'Heading 6',
    apply: (e) => e.chain().focus().setHeading({ level: 6 }).run(),
  },
  {
    name: 'Quote',
    apply: (e) => e.chain().focus().setBlockquote().run(),
  },
  {
    name: 'Code Block',
    apply: (e) => e.chain().focus().setCodeBlock().run(),
  },
  {
    name: 'Caption',
    apply: (e) =>
      e.chain().focus().setParagraph().setMark('textStyle', { fontSize: '9pt', color: '#5f6368' }).run(),
  },
];

export function ParagraphStylesModal({ editor, onClose }: Props) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={palStyles.palette} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalTitle}>Paragraph styles</div>

        <div className={palStyles.grid}>
          {NAMED_STYLES.map((s) => (
            <button
              key={s.name}
              className={palStyles.styleBtn}
              data-style={s.name}
              onClick={() => {
                s.apply(editor);
                onClose();
              }}
            >
              {s.name}
            </button>
          ))}
        </div>

        <div className={styles.modalActions}>
          <button className={styles.exportBtn} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
