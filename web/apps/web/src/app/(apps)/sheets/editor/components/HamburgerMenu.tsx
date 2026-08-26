'use client';

import React, { useState } from 'react';
import { HamburgerMenu as HamburgerMenuBase, HamburgerMenuItem, Modal, ModalHeader, ModalBody, ColorPicker } from '@neutrino/ui';
import type { CellStyle } from '../types';
import styles from './HamburgerMenu.module.css';

// ── Help modal ────────────────────────────────────────────────────────────

const SHORTCUTS = [
    { action: 'Bold',              keys: ['Ctrl', 'B'] },
    { action: 'Italic',            keys: ['Ctrl', 'I'] },
    { action: 'Undo',              keys: ['Ctrl', 'Z'] },
    { action: 'Redo',              keys: ['Ctrl', 'Y'] },
    { action: 'Cut',               keys: ['Ctrl', 'X'] },
    { action: 'Copy',              keys: ['Ctrl', 'C'] },
    { action: 'Paste',             keys: ['Ctrl', 'V'] },
    { action: 'Select all',        keys: ['Ctrl', 'A'] },
    { action: 'Find',              keys: ['Ctrl', 'F'] },
    { action: 'Find and replace',  keys: ['Ctrl', 'H'] },
    { action: 'Save',              keys: ['Ctrl', 'S'] },
];

function HelpModal({ onClose }: { onClose: () => void }) {
    return (
        <Modal open onClose={onClose} size="lg">
            <ModalHeader title="Neutrino Sheets — Help" onClose={onClose} />
            <ModalBody>
                <section className={styles.helpSection}>
                    <h3 className={styles.helpSectionTitle}>Getting started</h3>
                    <ul className={styles.helpList}>
                        <li>Click any cell to select it, then start typing to enter a value.</li>
                        <li>Start a cell with <strong>=</strong> to enter a formula, e.g. <strong>=SUM(A1:A5)</strong>.</li>
                        <li>Spreadsheets save automatically — look for the save status in the top bar.</li>
                        <li>Use <strong>File → New</strong> to start a blank sheet or from a starter template.</li>
                        <li>Use <strong>File → Export</strong> to download as CSV, Excel, or HTML.</li>
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
                        <li>Use <strong>Format</strong> to change font style, colors, borders, and number formats for the selected cells.</li>
                        <li>Merge multiple selected cells into one via <strong>Format → Merge cells</strong>.</li>
                        <li>Version History lets you restore any previous save.</li>
                        <li>Import a CSV or Excel file as a new sheet or a new tab via <strong>File → Import</strong>.</li>
                    </ul>
                </section>

                <section className={styles.helpSection}>
                    <h3 className={styles.helpSectionTitle}>About</h3>
                    <p className={styles.helpAbout}>
                        Neutrino Sheets is part of the Neutrino productivity suite — a Google Workspace-compatible
                        platform for documents, spreadsheets, and cloud storage.
                    </p>
                </section>
            </ModalBody>
        </Modal>
    );
}

type Props = {
    // File (existing, unchanged behavior — just wrapped in a File submenu)
    onOpenCsvExport: () => void;
    onOpenXlsxExport: () => void;
    onOpenHtmlExport: () => void;
    onOpenPrint: () => void;
    onSave: () => void;
    onToggleHistory: () => void;
    setHamburgerDialog: (dialog: string | null) => void;
    setHamburgerDeleteConfirm: (v: boolean) => void;
    isViewer?: boolean;
    // Office mode (issue #43) — true when editing a raw .xlsx in place.

    // Edit
    onUndo: () => void;
    onRedo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onCut: () => void;
    onCopy: () => void;
    onPaste: () => void;
    onSelectAll: () => void;
    onOpenFindReplace: () => void;

    // Format
    cellStyle?: CellStyle;
    onStyleChange: (style: Partial<CellStyle>) => void;
    formatDisabled?: boolean;
    isMerged: boolean;
    onMergeCells: () => void;

    // Insert (only rendered when provided)
    onInsertChart?: () => void;
};

export function HamburgerMenu({
    onOpenCsvExport,
    onOpenXlsxExport,
    onOpenHtmlExport,
    onOpenPrint,
    onSave,
    onToggleHistory,
    setHamburgerDialog,
    setHamburgerDeleteConfirm,
    isViewer = false,

    onUndo,
    onRedo,
    canUndo,
    canRedo,
    onCut,
    onCopy,
    onPaste,
    onSelectAll,
    onOpenFindReplace,

    cellStyle,
    onStyleChange,
    formatDisabled,
    isMerged,
    onMergeCells,

    onInsertChart,
}: Props) {
    const [showHelp, setShowHelp] = useState(false);
    const [colorDialog, setColorDialog] = useState<'text' | 'fill' | null>(null);
    const openDialog = (dialog: string) => setHamburgerDialog(dialog);

    const isBold          = cellStyle?.fontWeight     === 'bold';
    const isItalic        = cellStyle?.fontStyle      === 'italic';
    const isStrikethrough = cellStyle?.textDecoration === 'line-through';

    const fileItems: HamburgerMenuItem[] = [
        ...(!isViewer ? [{
            kind: 'submenu' as const, label: 'New', items: [
                { kind: 'action' as const, label: 'Blank',    action: () => openDialog('new') },
                { kind: 'action' as const, label: 'Template', action: () => openDialog('new-template-gallery') },
            ],
        }] : []),
        ...(!isViewer ? [{ kind: 'action' as const, label: 'Save', shortcut: 'Ctrl+S', action: () => onSave() }] : []),
        {
            kind: 'submenu', label: 'Export', items: [
                { kind: 'action', label: 'Comma Separated Values (.csv)', action: () => onOpenCsvExport() },
                { kind: 'action', label: 'Microsoft Excel (.xlsx)',        action: () => onOpenXlsxExport() },
                { kind: 'action', label: 'Web Page (.html)',               action: () => onOpenHtmlExport() },
            ],
        },
        ...(!isViewer ? [{
            kind: 'submenu' as const, label: 'Import', items: [
                { kind: 'action' as const, label: 'New sheet', action: () => openDialog('import-sheet') },
                { kind: 'action' as const, label: 'New tab',   action: () => openDialog('import-tab') },
            ],
        }] : []),
        { kind: 'action', label: 'Print',            action: () => onOpenPrint() },
        ...(!isViewer ? [{ kind: 'action' as const, label: 'Duplicate', action: () => openDialog('duplicate') }] : []),
        { kind: 'action', label: 'Version history',  action: () => onToggleHistory() },
        ...(!isViewer ? [
            { kind: 'separator' as const },
            { kind: 'action' as const, label: 'Delete', danger: true, action: () => { setHamburgerDeleteConfirm(true); setHamburgerDialog('delete'); } },
        ] : []),
        { kind: 'separator' },
        { kind: 'action', label: 'Share',                    action: () => openDialog('share') },
        { kind: 'action', label: 'Make available offline',   action: () => openDialog('offline') },
    ];

    const editItems: HamburgerMenuItem[] = [
        { kind: 'action', label: 'Undo', shortcut: 'Ctrl+Z', disabled: !canUndo, action: () => onUndo() },
        { kind: 'action', label: 'Redo', shortcut: 'Ctrl+Y', disabled: !canRedo, action: () => onRedo() },
        { kind: 'separator' },
        { kind: 'action', label: 'Cut',   shortcut: 'Ctrl+X', action: () => onCut() },
        { kind: 'action', label: 'Copy',  shortcut: 'Ctrl+C', action: () => onCopy() },
        { kind: 'action', label: 'Paste', shortcut: 'Ctrl+V', action: () => onPaste() },
        { kind: 'separator' },
        { kind: 'action', label: 'Select all', shortcut: 'Ctrl+A', action: () => onSelectAll() },
        { kind: 'separator' },
        { kind: 'action', label: 'Find and replace…', shortcut: 'Ctrl+H', action: () => onOpenFindReplace() },
    ];

    const formatItems: HamburgerMenuItem[] = [
        { kind: 'action', label: isBold ? 'Bold ✓' : 'Bold', shortcut: 'Ctrl+B', disabled: formatDisabled, action: () => onStyleChange({ fontWeight: isBold ? 'normal' : 'bold' }) },
        { kind: 'action', label: isItalic ? 'Italic ✓' : 'Italic', shortcut: 'Ctrl+I', disabled: formatDisabled, action: () => onStyleChange({ fontStyle: isItalic ? 'normal' : 'italic' }) },
        { kind: 'action', label: isStrikethrough ? 'Strikethrough ✓' : 'Strikethrough', disabled: formatDisabled, action: () => onStyleChange({ textDecoration: isStrikethrough ? 'none' : 'line-through' }) },
        { kind: 'separator' },
        { kind: 'action', label: 'Text color…', disabled: formatDisabled, action: () => setColorDialog('text') },
        { kind: 'action', label: 'Fill color…', disabled: formatDisabled, action: () => setColorDialog('fill') },
        { kind: 'separator' },
        {
            kind: 'submenu', label: 'Borders', items: [
                { kind: 'action', label: 'No border', disabled: formatDisabled, action: () => onStyleChange({ borderStyle: 'none', borderTop: undefined, borderRight: undefined, borderBottom: undefined, borderLeft: undefined }) },
                { kind: 'action', label: 'Thin',       disabled: formatDisabled, action: () => onStyleChange({ borderStyle: 'thin', borderTop: undefined, borderRight: undefined, borderBottom: undefined, borderLeft: undefined }) },
                { kind: 'action', label: 'Medium',     disabled: formatDisabled, action: () => onStyleChange({ borderStyle: 'medium', borderTop: undefined, borderRight: undefined, borderBottom: undefined, borderLeft: undefined }) },
                { kind: 'action', label: 'Thick',      disabled: formatDisabled, action: () => onStyleChange({ borderStyle: 'thick', borderTop: undefined, borderRight: undefined, borderBottom: undefined, borderLeft: undefined }) },
            ],
        },
        {
            kind: 'submenu', label: 'Number format', items: [
                { kind: 'action', label: 'Currency', disabled: formatDisabled, action: () => onStyleChange({ numberFormat: cellStyle?.numberFormat === 'currency' ? undefined : 'currency' }) },
                { kind: 'action', label: 'Percent',  disabled: formatDisabled, action: () => onStyleChange({ numberFormat: cellStyle?.numberFormat === 'percent' ? undefined : 'percent' }) },
                { kind: 'action', label: 'Number',   disabled: formatDisabled, action: () => onStyleChange({ numberFormat: cellStyle?.numberFormat === 'number' ? undefined : 'number' }) },
                { kind: 'action', label: 'Date',     disabled: formatDisabled, action: () => onStyleChange({ numberFormat: cellStyle?.numberFormat === 'date' ? undefined : 'date' }) },
            ],
        },
        { kind: 'separator' },
        { kind: 'action', label: isMerged ? 'Unmerge cells' : 'Merge cells', disabled: formatDisabled, action: () => onMergeCells() },
        { kind: 'separator' },
        {
            kind: 'action', label: 'Clear formatting', disabled: formatDisabled, action: () => onStyleChange({
                fontFamily: undefined,
                fontSize: undefined,
                fontWeight: undefined,
                fontStyle: undefined,
                textDecoration: undefined,
                color: undefined,
                backgroundColor: undefined,
                textAlign: undefined,
                verticalAlign: undefined,
                borderStyle: undefined,
                numberFormat: undefined,
                decimalPlaces: undefined,
                customFormat: undefined,
                wrapMode: undefined,
                borderTop: undefined,
                borderRight: undefined,
                borderBottom: undefined,
                borderLeft: undefined,
            }),
        },
    ];

    const items: HamburgerMenuItem[] = [
        { kind: 'submenu', label: 'File', items: fileItems },
        ...(!isViewer ? [{ kind: 'submenu' as const, label: 'Edit', items: editItems }] : []),
        ...(!isViewer ? [{ kind: 'submenu' as const, label: 'Format', items: formatItems }] : []),
        ...(!isViewer && onInsertChart ? [{
            kind: 'submenu' as const, label: 'Insert', items: [
                { kind: 'action' as const, label: 'Insert chart…', action: () => onInsertChart() },
            ],
        }] : []),
        {
            kind: 'submenu', label: 'Help', items: [
                { kind: 'action', label: 'Keyboard shortcuts & help', action: () => setShowHelp(true) },
            ],
        },
    ];

    return (
        <>
            <HamburgerMenuBase items={items} />
            {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
            {colorDialog && (
                <Modal open onClose={() => setColorDialog(null)} size="sm">
                    <ModalHeader title={colorDialog === 'text' ? 'Text color' : 'Fill color'} onClose={() => setColorDialog(null)} />
                    <ModalBody>
                        <ColorPicker
                            value={colorDialog === 'text' ? (cellStyle?.color ?? '#000000') : (cellStyle?.backgroundColor ?? '#ffffff')}
                            onChange={hex => onStyleChange(colorDialog === 'text' ? { color: hex } : { backgroundColor: hex })}
                            flat
                        />
                    </ModalBody>
                </Modal>
            )}
        </>
    );
}
