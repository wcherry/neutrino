'use client';

import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Checkbox, Modal, ModalBody, ModalHeader } from '@neutrino/ui';
import { EDITOR_TOOLBARS, useToolbarLayout, type EditorToolbarId } from '@/lib/editorToolbars';
import styles from './editorChrome.module.css';

/**
 * Show, hide and reorder one editor's tools, and turn captions on — the editor's own "Customize
 * toolbar…" dialog and Settings › Appearance both use this. A hidden tool is not gone: it waits in
 * the toolbar's "More tools" menu.
 */
export function ToolbarCustomizer({ editor }: { editor: EditorToolbarId }) {
  const layout = useToolbarLayout(editor);
  const { tools } = EDITOR_TOOLBARS[editor];
  const regions = tools.some(t => t.region)
    ? ([['start', 'Left of the title'], ['end', 'Right of the title']] as const)
    : ([[undefined, null]] as const);

  return (
    <div className={styles.customizer}>
      {regions.map(([region, heading]) => {
        const ids = layout.order.filter(id => tools.find(t => t.id === id)?.region === region);
        return (
          <div key={region ?? 'all'} className={styles.customizerRegion}>
            {heading && <h4 className={styles.customizerHeading}>{heading}</h4>}
            <ul className={styles.customizerList} aria-label={`${EDITOR_TOOLBARS[editor].label} toolbar${heading ? `, ${heading.toLowerCase()}` : ''}`}>
              {ids.map((id, i) => {
                const tool = tools.find(t => t.id === id)!;
                return (
                  <li key={id} className={styles.customizerRow}>
                    <Checkbox
                      label={tool.label}
                      checked={!layout.hidden.has(id)}
                      onChange={e => layout.setHidden(id, !e.target.checked)}
                    />
                    <span className={styles.customizerMove}>
                      <button
                        type="button"
                        className={styles.moveButton}
                        aria-label={`Move ${tool.label} earlier`}
                        disabled={i === 0}
                        onClick={() => layout.move(id, -1)}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        className={styles.moveButton}
                        aria-label={`Move ${tool.label} later`}
                        disabled={i === ids.length - 1}
                        onClick={() => layout.move(id, 1)}
                      >
                        <ArrowDown size={13} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <div className={styles.customizerFooter}>
        <Checkbox
          label="Show a label under each tool"
          checked={layout.labels}
          onChange={e => layout.setLabels(e.target.checked)}
        />
        <button type="button" className={styles.resetButton} disabled={!layout.customized} onClick={layout.reset}>
          Reset to default
        </button>
      </div>
    </div>
  );
}

export function CustomizeToolbarDialog({ editor, open, onClose }: { editor: EditorToolbarId; open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title={`Customize the ${EDITOR_TOOLBARS[editor].label} toolbar`} size="md">
      <ModalHeader title={`Customize the ${EDITOR_TOOLBARS[editor].label} toolbar`} onClose={onClose} />
      <ModalBody>
        <p className={styles.customizerHint}>
          Unticked tools move to the toolbar&rsquo;s &ldquo;More tools&rdquo; menu. Changes follow you to every device.
        </p>
        <ToolbarCustomizer editor={editor} />
      </ModalBody>
    </Modal>
  );
}
