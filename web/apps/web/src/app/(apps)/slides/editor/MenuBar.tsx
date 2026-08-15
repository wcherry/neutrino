'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { HamburgerMenu as HamburgerMenuBase, HamburgerMenuItem } from '@neutrino/ui';
import { Modal, ModalHeader, ModalBody } from '@neutrino/ui';
import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';
import {
  SHAPE_CATALOG,
  SHAPE_GROUPS,
  LINE_CATALOG,
  SLIDE_LAYOUTS,
} from './slideEditorConstants';
import styles from './MenuBar.module.css';

// ── Help modal ────────────────────────────────────────────────────────────

const SHORTCUTS = [
  { action: 'Save',                       keys: ['Ctrl', 'S'] },
  { action: 'Delete selected element',    keys: ['Delete'] },
  { action: 'Next slide (presenting)',    keys: ['→'] },
  { action: 'Previous slide (presenting)', keys: ['←'] },
  { action: 'Exit presenting',            keys: ['Esc'] },
];

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="lg">
      <ModalHeader title="Neutrino Slides — Help" onClose={onClose} />
      <ModalBody>
        <section className={styles.helpSection}>
          <h3 className={styles.helpSectionTitle}>Getting started</h3>
          <ul className={styles.helpList}>
            <li>Use <strong>Slide → New slide</strong> to add slides, and the filmstrip on the left to reorder them.</li>
            <li>Pick a starting point for the current slide with <strong>Slide → Apply layout</strong>.</li>
            <li>Add content from the <strong>Insert</strong> menu — text boxes, images, shapes, lines and video.</li>
            <li>Presentations save automatically — look for the save status in the top bar.</li>
            <li>Use <strong>File → Export</strong> to download as PowerPoint (.pptx).</li>
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
            <li>Drag a shape from the Insert panel straight onto the canvas to place it where you drop it.</li>
            <li><strong>View → Slide master</strong> edits the background and placeholders every slide inherits.</li>
            <li><strong>Arrange</strong> changes the stacking order of the selected element.</li>
            <li>Speaker notes live in the bar below the canvas and show up in the presenter view.</li>
            <li>Import a PowerPoint (.pptx) file to convert it to a Neutrino presentation.</li>
          </ul>
        </section>

        <section className={styles.helpSection}>
          <h3 className={styles.helpSectionTitle}>About</h3>
          <p className={styles.helpAbout}>
            Neutrino Slides is part of the Neutrino productivity suite — a Google Workspace-compatible
            platform for documents, spreadsheets, and cloud storage.
          </p>
        </section>
      </ModalBody>
    </Modal>
  );
}

// ── HamburgerMenu ─────────────────────────────────────────────────────────

export interface HamburgerMenuProps {
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  onSave: () => void;
  onNewPresentation: () => void;
  onDuplicate: () => void;
  onImport: () => void;
  onExportPptx: () => void;
  onShare: () => void;
  // Office mode (issue #43) — true when this file is a raw .pptx being edited
  // in place rather than a native Neutrino presentation.
  officeMode?: boolean;
  onConvertToNative?: () => void;
  // Slide operations
  onNewSlide: () => void;
  onDuplicateSlide: () => void;
  onDeleteSlide: () => void;
  onMoveSlide: (dir: -1 | 1) => void;
  canMoveSlideUp: boolean;
  canMoveSlideDown: boolean;
  canDeleteSlide: boolean;
  onApplyLayout: (layout: (typeof SLIDE_LAYOUTS)[number]) => void;
  // Insert
  onInsertTextBox: () => void;
  onInsertShape: (shape: string) => void;
  onInsertLine: (line: string) => void;
  onInsertImage: () => void;
  onInsertVideo: () => void;
  onInsertSheet: () => void;
  onInsertDiagram: () => void;
  // Arrange (the selected element)
  hasSelection: boolean;
  onBringToFront: () => void;
  onMoveForward: () => void;
  onMoveBackward: () => void;
  onSendToBack: () => void;
  onDeleteElement: () => void;
  // View
  rightPanelTab: 'layout' | 'theme' | 'insert';
  onSelectPanel: (tab: 'layout' | 'theme' | 'insert') => void;
  masterMode: boolean;
  onToggleMaster: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onPresent: () => void;
}

const ZOOM_LEVELS = [50, 75, 100, 150, 200];

export function HamburgerMenu({
  titleInputRef,
  onSave,
  onNewPresentation,
  onDuplicate,
  onImport,
  onExportPptx,
  onShare,
  officeMode,
  onConvertToNative,
  onNewSlide,
  onDuplicateSlide,
  onDeleteSlide,
  onMoveSlide,
  canMoveSlideUp,
  canMoveSlideDown,
  canDeleteSlide,
  onApplyLayout,
  onInsertTextBox,
  onInsertShape,
  onInsertLine,
  onInsertImage,
  onInsertVideo,
  onInsertSheet,
  onInsertDiagram,
  hasSelection,
  onBringToFront,
  onMoveForward,
  onMoveBackward,
  onSendToBack,
  onDeleteElement,
  rightPanelTab,
  onSelectPanel,
  masterMode,
  onToggleMaster,
  zoom,
  onZoomChange,
  onPresent,
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
        { kind: 'action', label: 'New presentation',                    action: () => onNewPresentation() },
        { kind: 'action', label: 'Open slides list',                    action: () => router.push('/slides') },
        { kind: 'separator' },
        { kind: 'action', label: 'Rename',                              action: () => { titleInputRef.current?.focus(); titleInputRef.current?.select(); } },
        { kind: 'action', label: 'Duplicate',                           action: () => onDuplicate() },
        { kind: 'separator' },
        { kind: 'action', label: 'Save',            shortcut: 'Ctrl+S', action: () => onSave() },
        { kind: 'separator' },
        ...(officeMode ? [
          { kind: 'action' as const, label: 'Convert to Neutrino Slide', action: () => onConvertToNative?.() },
          { kind: 'separator' as const },
        ] : []),
        { kind: 'action', label: 'Import (.pptx)',                      action: () => onImport() },
        {
          kind: 'submenu', label: 'Export as…', items: [
            { kind: 'action', label: 'PowerPoint (.pptx)', action: () => onExportPptx() },
          ],
        },
        { kind: 'separator' },
        { kind: 'action', label: 'Share…',                              action: () => onShare() },
      ],
    },
    {
      kind: 'submenu',
      label: 'Slide',
      items: [
        { kind: 'action', label: 'New slide',        action: () => onNewSlide() },
        { kind: 'action', label: 'Duplicate slide',  action: () => onDuplicateSlide() },
        { kind: 'action', label: 'Delete slide', danger: true, disabled: !canDeleteSlide, action: () => onDeleteSlide() },
        { kind: 'separator' },
        { kind: 'action', label: 'Move slide up',    disabled: !canMoveSlideUp,   action: () => onMoveSlide(-1) },
        { kind: 'action', label: 'Move slide down',  disabled: !canMoveSlideDown, action: () => onMoveSlide(1) },
        { kind: 'separator' },
        {
          kind: 'submenu', label: 'Apply layout', items: SLIDE_LAYOUTS.map(layout => ({
            kind: 'action' as const, label: layout.name, action: () => onApplyLayout(layout),
          })),
        },
      ],
    },
    {
      kind: 'submenu',
      label: 'Insert',
      items: [
        { kind: 'action', label: 'Text box',  action: () => onInsertTextBox() },
        { kind: 'action', label: 'Image…',    action: () => onInsertImage() },
        { kind: 'action', label: 'Video…',    action: () => onInsertVideo() },
        { kind: 'separator' },
        ...SHAPE_GROUPS.map(group => ({
          kind: 'submenu' as const,
          label: group.label,
          items: Object.entries(SHAPE_CATALOG)
            .filter(([, def]) => def.group === group.key)
            .map(([id, def]) => ({
              kind: 'action' as const, label: def.label, action: () => onInsertShape(id),
            })),
        })),
        {
          kind: 'submenu', label: 'Line', items: Object.entries(LINE_CATALOG).map(([id, def]) => ({
            kind: 'action' as const, label: def.label, action: () => onInsertLine(id),
          })),
        },
        ...(flags.sheetLiveEmbed || flags.diagramsApp ? [{ kind: 'separator' as const }] : []),
        ...(flags.sheetLiveEmbed
          ? [{ kind: 'action' as const, label: 'Sheet…', action: () => onInsertSheet() }]
          : []),
        ...(flags.diagramsApp
          ? [{ kind: 'action' as const, label: 'Diagram…', action: () => onInsertDiagram() }]
          : []),
      ],
    },
    {
      kind: 'submenu',
      label: 'Arrange',
      items: [
        { kind: 'action', label: 'Bring to front',   disabled: !hasSelection, action: () => onBringToFront() },
        { kind: 'action', label: 'Bring forward',    disabled: !hasSelection, action: () => onMoveForward() },
        { kind: 'action', label: 'Send backward',    disabled: !hasSelection, action: () => onMoveBackward() },
        { kind: 'action', label: 'Send to back',     disabled: !hasSelection, action: () => onSendToBack() },
        { kind: 'separator' },
        { kind: 'action', label: 'Delete element', shortcut: 'Delete', danger: true, disabled: !hasSelection, action: () => onDeleteElement() },
      ],
    },
    {
      kind: 'submenu',
      label: 'View',
      items: [
        { kind: 'action', label: rightPanelTab === 'layout' ? 'Layout panel ✓' : 'Layout panel', action: () => onSelectPanel('layout') },
        { kind: 'action', label: rightPanelTab === 'theme'  ? 'Theme panel ✓'  : 'Theme panel',  action: () => onSelectPanel('theme') },
        { kind: 'action', label: rightPanelTab === 'insert' ? 'Insert panel ✓' : 'Insert panel', action: () => onSelectPanel('insert') },
        { kind: 'separator' },
        { kind: 'action', label: masterMode ? 'Slide master ✓' : 'Slide master', action: () => onToggleMaster() },
        { kind: 'separator' },
        {
          kind: 'submenu', label: 'Zoom', items: ZOOM_LEVELS.map(level => ({
            kind: 'action' as const,
            label: zoom === level ? `${level}% ✓` : `${level}%`,
            action: () => onZoomChange(level),
          })),
        },
        { kind: 'separator' },
        { kind: 'action', label: 'Present', action: () => onPresent() },
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
