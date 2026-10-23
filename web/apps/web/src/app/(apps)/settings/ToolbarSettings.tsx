'use client';

import React, { useState } from 'react';
import { EDITOR_TOOLBARS, type EditorToolbarId } from '@/lib/editorToolbars';
import { ToolbarCustomizer } from '@/components/editorChrome/CustomizeToolbar';
import styles from './SidebarSettings.module.css';

const EDITORS = Object.keys(EDITOR_TOOLBARS) as EditorToolbarId[];

/**
 * Settings › Appearance › Toolbars (customization roadmap U10): each editor's tools shown, hidden
 * and reordered, and captions on or off — the same list the editor's own "Customize toolbar…"
 * opens, so neither has to be found to use the other.
 */
export function ToolbarSettings() {
  const [editor, setEditor] = useState<EditorToolbarId>('docs');
  return (
    <div className={styles.root} id="toolbars">
      <div className={styles.head}>
        <span className={styles.label} id="toolbars-label">Toolbars</span>
      </div>
      <p className={styles.hint}>
        Which tools each editor&rsquo;s toolbar shows, and in what order, on every device. A hidden tool is
        still in the toolbar&rsquo;s &ldquo;More tools&rdquo; menu. Right-click a toolbar to change it from the editor.
      </p>
      <div role="tablist" aria-labelledby="toolbars-label" className={styles.editorTabs}>
        {EDITORS.map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={editor === id}
            className={styles.editorTab}
            onClick={() => setEditor(id)}
          >
            {EDITOR_TOOLBARS[id].label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={`${EDITOR_TOOLBARS[editor].label} toolbar`}>
        <ToolbarCustomizer key={editor} editor={editor} />
      </div>
    </div>
  );
}
