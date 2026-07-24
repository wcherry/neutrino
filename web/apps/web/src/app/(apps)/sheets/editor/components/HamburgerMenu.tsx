'use client';

import { HamburgerMenu as HamburgerMenuBase, HamburgerMenuItem } from '@neutrino/ui';
import type { CellStyle } from '../types';

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
    officeMode?: boolean;
    onConvertToNative?: () => void;

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
    officeMode = false,
    onConvertToNative,

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
        ...(officeMode ? [{ kind: 'action' as const, label: 'Convert to Neutrino Sheet', action: () => onConvertToNative?.() }] : []),
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
        {
            kind: 'action', label: 'Text color…', disabled: formatDisabled, action: () => {
                const hex = window.prompt('Enter a hex color:', cellStyle?.color ?? '#000000');
                if (hex != null) onStyleChange({ color: hex });
            },
        },
        {
            kind: 'action', label: 'Fill color…', disabled: formatDisabled, action: () => {
                const hex = window.prompt('Enter a hex color:', cellStyle?.backgroundColor ?? '#ffffff');
                if (hex != null) onStyleChange({ backgroundColor: hex });
            },
        },
        { kind: 'separator' },
        {
            kind: 'submenu', label: 'Borders', items: [
                { kind: 'action', label: 'No border', disabled: formatDisabled, action: () => onStyleChange({ borderStyle: 'none' }) },
                { kind: 'action', label: 'Thin',       disabled: formatDisabled, action: () => onStyleChange({ borderStyle: 'thin' }) },
                { kind: 'action', label: 'Medium',     disabled: formatDisabled, action: () => onStyleChange({ borderStyle: 'medium' }) },
                { kind: 'action', label: 'Thick',      disabled: formatDisabled, action: () => onStyleChange({ borderStyle: 'thick' }) },
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
    ];

    return <HamburgerMenuBase items={items} />;
}
