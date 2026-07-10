'use client';

import { HamburgerMenu as HamburgerMenuBase, HamburgerMenuItem } from '@neutrino/ui';

type Props = {
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
}: Props) {
    const openDialog = (dialog: string) => setHamburgerDialog(dialog);

    const items: HamburgerMenuItem[] = [
        ...(!isViewer ? [{ kind: 'action' as const, label: 'New', action: () => openDialog('new') }] : []),
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

    return <HamburgerMenuBase items={items} />;
}
