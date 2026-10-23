'use client';

/**
 * A note body rendered read-only — the preview modal's view of a note, and
 * the large grid card's. One renderer so a card cannot show a note differently
 * from the preview it opens.
 */

import React from 'react';
import { parseBlocks, renderInline } from './editor/blockEditorHelpers';
import { numberedIndexInGroup } from './editor/noteMarkdown';
import type { Block } from './editor/blockEditorTypes';
import styles from './NoteBlocks.module.css';

function inline(content: string) {
  return renderInline(content, [], () => {});
}

export function NoteBlocks({ content, className }: { content: string; className?: string }) {
  const blocks: Block[] = parseBlocks(content);

  return (
    <div className={className}>
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'bullet':
            return (
              <div key={block.id ?? idx} className={styles.noteBlockBullet}>
                <span className={styles.noteBulletDot} aria-hidden />
                <span>{inline(block.content)}</span>
              </div>
            );
          case 'numbered':
            return (
              <div key={block.id ?? idx} className={styles.noteBlockNumbered}>
                <span className={styles.noteNumber}>{numberedIndexInGroup(blocks, idx)}.</span>
                <span>{inline(block.content)}</span>
              </div>
            );
          case 'code':
            return (
              <pre key={block.id ?? idx} className={styles.noteBlockCode}>{block.content}</pre>
            );
          case 'blockquote':
            return (
              <blockquote key={block.id ?? idx} className={styles.noteBlockQuote}>
                {inline(block.content)}
              </blockquote>
            );
          case 'task':
            return (
              <div key={block.id ?? idx} className={styles.noteTaskRow}>
                <span
                  className={[styles.noteTaskCheck, block.checked ? styles.noteTaskChecked : ''].filter(Boolean).join(' ')}
                  aria-label={block.checked ? 'Completed task' : 'Incomplete task'}
                />
                <span className={block.checked ? styles.noteTaskTextDone : undefined}>
                  {inline(block.content)}
                </span>
              </div>
            );
          default:
            // paragraph (and any unrecognised type)
            return (
              <div key={block.id ?? idx} className={styles.noteBlock}>
                {inline(block.content)}
              </div>
            );
        }
      })}
    </div>
  );
}
