'use client';

import React, { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { storageApi } from '@/lib/api';
import { ShareDialog } from '@/app/(apps)/drive/ShareDialog';
import { SheetTemplatePickerModal } from './SheetTemplatePickerModal';
import type { SheetTemplate } from '../templates/sheetTemplates';
import styles from '../page.module.css';

type CsvExportOptions = {
    filename: string;
    sheetIndex: number;
    selectionOnly: boolean;
    hasSelection: boolean;
};

type XlsxExportOptions = {
    filename: string;
    sheetIndex: number;
    selectionOnly: boolean;
    hasSelection: boolean;
    allSheets: boolean;
};

type PrintOptions = {
    sheetIndex: number;
    allSheets: boolean;
    selectionOnly: boolean;
    hasSelection: boolean;
};

type HtmlExportOptions = {
    filename: string;
    sheetIndex: number;
    selectionOnly: boolean;
    hasSelection: boolean;
    allSheets: boolean;
};

type Props = {
    hamburgerDialog: string | null;
    setHamburgerDialog: (dialog: string | null) => void;
    hamburgerDeleteConfirm: boolean;
    setHamburgerDeleteConfirm: (v: boolean) => void;
    sheetId: string;
    title: string;
    sheetNames: string[];
    // CSV
    csvExportOptions: CsvExportOptions | null;
    setCsvExportOptions: React.Dispatch<React.SetStateAction<CsvExportOptions | null>>;
    doExportCsv: (opts: { filename: string; sheetIndex: number; selectionOnly: boolean }) => void;
    // XLSX
    xlsxExportOptions: XlsxExportOptions | null;
    setXlsxExportOptions: React.Dispatch<React.SetStateAction<XlsxExportOptions | null>>;
    doExportXlsx: (opts: { filename: string; sheetIndex: number; selectionOnly: boolean; allSheets: boolean }) => void;
    // Print
    printOptions: PrintOptions | null;
    setPrintOptions: React.Dispatch<React.SetStateAction<PrintOptions | null>>;
    doPrint: (opts: { sheetIndex: number; allSheets: boolean; selectionOnly: boolean }) => void;
    // HTML
    htmlExportOptions: HtmlExportOptions | null;
    setHtmlExportOptions: React.Dispatch<React.SetStateAction<HtmlExportOptions | null>>;
    doExportHtml: (opts: { filename: string; sheetIndex: number; selectionOnly: boolean; allSheets: boolean }) => void;
    // Actions
    onCreateNew: (title: string) => Promise<void>;
    onDuplicate: (title: string) => Promise<void>;
    onDelete: () => Promise<void>;
    onImportSheet: (file: File) => Promise<void>;
    onImportTab: (file: File) => Promise<void>;
    onCreateFromTemplate: (template: SheetTemplate, title: string) => Promise<void>;
};

export function ExportDialogs({
    hamburgerDialog,
    setHamburgerDialog,
    hamburgerDeleteConfirm,
    setHamburgerDeleteConfirm,
    sheetId,
    title,
    sheetNames,
    csvExportOptions,
    setCsvExportOptions,
    doExportCsv,
    xlsxExportOptions,
    setXlsxExportOptions,
    doExportXlsx,
    printOptions,
    setPrintOptions,
    doPrint,
    htmlExportOptions,
    setHtmlExportOptions,
    doExportHtml,
    onCreateNew,
    onDuplicate,
    onDelete,
    onImportSheet,
    onImportTab,
    onCreateFromTemplate,
}: Props) {
    const [newTitle, setNewTitle] = useState('Untitled spreadsheet');
    const [duplicateTitle, setDuplicateTitle] = useState('');
    const [importSheetFile, setImportSheetFile] = useState<File | null>(null);
    const [importTabFile, setImportTabFile] = useState<File | null>(null);
    const [selectedTemplate, setSelectedTemplate] = useState<SheetTemplate | null>(null);
    const [templateTitle, setTemplateTitle] = useState('');
    const importSheetInputRef = useRef<HTMLInputElement>(null);
    const importTabInputRef = useRef<HTMLInputElement>(null);

    const closeDialog = () => { setHamburgerDialog(null); setHamburgerDeleteConfirm(false); };

    return (
        <>
            {/* ── XLSX export dialog ── */}
            {hamburgerDialog === 'export-xlsx-dialog' && xlsxExportOptions && (
                <div className={styles.dialogOverlay} onClick={() => { setHamburgerDialog(null); setXlsxExportOptions(null); }}>
                    <div className={styles.dialogBox} onClick={e => e.stopPropagation()}>
                        <div className={styles.dialogTitle}>Export as Excel</div>
                        <div className={styles.csvExportField}>
                            <label className={styles.csvExportLabel}>Filename</label>
                            <div className={styles.csvExportFilenameRow}>
                                <input
                                    className={styles.csvExportInput}
                                    value={xlsxExportOptions.filename}
                                    onChange={e => setXlsxExportOptions(prev => prev ? { ...prev, filename: e.target.value } : prev)}
                                    spellCheck={false}
                                />
                                <span className={styles.csvExportExt}>.xlsx</span>
                            </div>
                        </div>
                        <label className={styles.csvExportCheckboxRow}>
                            <input
                                type="checkbox"
                                checked={xlsxExportOptions.allSheets}
                                onChange={e => setXlsxExportOptions(prev => prev
                                    ? { ...prev, allSheets: e.target.checked, selectionOnly: e.target.checked ? false : prev.selectionOnly }
                                    : prev)}
                            />
                            <span>Export all sheets</span>
                        </label>
                        {!xlsxExportOptions.allSheets && (
                            <div className={styles.csvExportField}>
                                <label className={styles.csvExportLabel}>Sheet</label>
                                <select
                                    className={styles.csvExportSelect}
                                    value={xlsxExportOptions.sheetIndex}
                                    onChange={e => setXlsxExportOptions(prev => prev ? { ...prev, sheetIndex: Number(e.target.value) } : prev)}
                                >
                                    {sheetNames.map((name, i) => <option key={i} value={i}>{name}</option>)}
                                </select>
                            </div>
                        )}
                        {xlsxExportOptions.hasSelection && !xlsxExportOptions.allSheets && (
                            <label className={styles.csvExportCheckboxRow}>
                                <input
                                    type="checkbox"
                                    checked={xlsxExportOptions.selectionOnly}
                                    onChange={e => setXlsxExportOptions(prev => prev ? { ...prev, selectionOnly: e.target.checked } : prev)}
                                />
                                <span>Export selected cells only</span>
                            </label>
                        )}
                        <div className={styles.dialogActions}>
                            <button className={styles.dialogBtnPrimary} onClick={() => { doExportXlsx(xlsxExportOptions); setHamburgerDialog(null); setXlsxExportOptions(null); }}>Export</button>
                            <button className={styles.dialogBtnSecondary} onClick={() => { setHamburgerDialog(null); setXlsxExportOptions(null); }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── CSV export dialog ── */}
            {hamburgerDialog === 'export-csv' && csvExportOptions && (
                <div className={styles.dialogOverlay} onClick={() => { setHamburgerDialog(null); setCsvExportOptions(null); }}>
                    <div className={styles.dialogBox} onClick={e => e.stopPropagation()}>
                        <div className={styles.dialogTitle}>Export as CSV</div>
                        <div className={styles.csvExportField}>
                            <label className={styles.csvExportLabel}>Filename</label>
                            <div className={styles.csvExportFilenameRow}>
                                <input
                                    className={styles.csvExportInput}
                                    value={csvExportOptions.filename}
                                    onChange={e => setCsvExportOptions(prev => prev ? { ...prev, filename: e.target.value } : prev)}
                                    spellCheck={false}
                                />
                                <span className={styles.csvExportExt}>.csv</span>
                            </div>
                        </div>
                        <div className={styles.csvExportField}>
                            <label className={styles.csvExportLabel}>Sheet</label>
                            <select
                                className={styles.csvExportSelect}
                                value={csvExportOptions.sheetIndex}
                                onChange={e => setCsvExportOptions(prev => prev ? { ...prev, sheetIndex: Number(e.target.value) } : prev)}
                            >
                                {sheetNames.map((name, i) => <option key={i} value={i}>{name}</option>)}
                            </select>
                        </div>
                        {csvExportOptions.hasSelection && (
                            <label className={styles.csvExportCheckboxRow}>
                                <input
                                    type="checkbox"
                                    checked={csvExportOptions.selectionOnly}
                                    onChange={e => setCsvExportOptions(prev => prev ? { ...prev, selectionOnly: e.target.checked } : prev)}
                                />
                                <span>Export selected cells only</span>
                            </label>
                        )}
                        <div className={styles.dialogActions}>
                            <button className={styles.dialogBtnPrimary} onClick={() => { doExportCsv(csvExportOptions); setHamburgerDialog(null); setCsvExportOptions(null); }}>Export</button>
                            <button className={styles.dialogBtnSecondary} onClick={() => { setHamburgerDialog(null); setCsvExportOptions(null); }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── HTML export dialog ── */}
            {hamburgerDialog === 'export-html' && htmlExportOptions && (
                <div className={styles.dialogOverlay} onClick={() => { setHamburgerDialog(null); setHtmlExportOptions(null); }}>
                    <div className={styles.dialogBox} onClick={e => e.stopPropagation()}>
                        <div className={styles.dialogTitle}>Export as Web Page</div>
                        <div className={styles.csvExportField}>
                            <label className={styles.csvExportLabel}>Filename</label>
                            <div className={styles.csvExportFilenameRow}>
                                <input
                                    className={styles.csvExportInput}
                                    value={htmlExportOptions.filename}
                                    onChange={e => setHtmlExportOptions(prev => prev ? { ...prev, filename: e.target.value } : prev)}
                                    spellCheck={false}
                                />
                                <span className={styles.csvExportExt}>.html</span>
                            </div>
                        </div>
                        <label className={styles.csvExportCheckboxRow}>
                            <input
                                type="checkbox"
                                checked={htmlExportOptions.allSheets}
                                onChange={e => setHtmlExportOptions(prev => prev
                                    ? { ...prev, allSheets: e.target.checked, selectionOnly: e.target.checked ? false : prev.selectionOnly }
                                    : prev)}
                            />
                            <span>Export all sheets</span>
                        </label>
                        {!htmlExportOptions.allSheets && (
                            <div className={styles.csvExportField}>
                                <label className={styles.csvExportLabel}>Sheet</label>
                                <select
                                    className={styles.csvExportSelect}
                                    value={htmlExportOptions.sheetIndex}
                                    onChange={e => setHtmlExportOptions(prev => prev ? { ...prev, sheetIndex: Number(e.target.value) } : prev)}
                                >
                                    {sheetNames.map((name, i) => <option key={i} value={i}>{name}</option>)}
                                </select>
                            </div>
                        )}
                        {htmlExportOptions.hasSelection && !htmlExportOptions.allSheets && (
                            <label className={styles.csvExportCheckboxRow}>
                                <input
                                    type="checkbox"
                                    checked={htmlExportOptions.selectionOnly}
                                    onChange={e => setHtmlExportOptions(prev => prev ? { ...prev, selectionOnly: e.target.checked } : prev)}
                                />
                                <span>Export selected cells only</span>
                            </label>
                        )}
                        <div className={styles.dialogActions}>
                            <button className={styles.dialogBtnPrimary} onClick={() => { doExportHtml(htmlExportOptions); setHamburgerDialog(null); setHtmlExportOptions(null); }}>Export</button>
                            <button className={styles.dialogBtnSecondary} onClick={() => { setHamburgerDialog(null); setHtmlExportOptions(null); }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Print dialog ── */}
            {hamburgerDialog === 'print' && printOptions && (
                <div className={styles.dialogOverlay} onClick={() => { setHamburgerDialog(null); setPrintOptions(null); }}>
                    <div className={styles.dialogBox} onClick={e => e.stopPropagation()}>
                        <div className={styles.dialogTitle}>Print</div>
                        {sheetNames.length > 1 && (
                            <label className={styles.csvExportCheckboxRow}>
                                <input
                                    type="checkbox"
                                    checked={printOptions.allSheets}
                                    onChange={e => setPrintOptions(prev => prev
                                        ? { ...prev, allSheets: e.target.checked, selectionOnly: e.target.checked ? false : prev.selectionOnly }
                                        : prev)}
                                />
                                <span>Print all sheets</span>
                            </label>
                        )}
                        {!printOptions.allSheets && (
                            <div className={styles.csvExportField}>
                                <label className={styles.csvExportLabel}>Sheet</label>
                                <select
                                    className={styles.csvExportSelect}
                                    value={printOptions.sheetIndex}
                                    onChange={e => setPrintOptions(prev => prev ? { ...prev, sheetIndex: Number(e.target.value) } : prev)}
                                >
                                    {sheetNames.map((name, i) => <option key={i} value={i}>{name}</option>)}
                                </select>
                            </div>
                        )}
                        {printOptions.hasSelection && !printOptions.allSheets && (
                            <label className={styles.csvExportCheckboxRow}>
                                <input
                                    type="checkbox"
                                    checked={printOptions.selectionOnly}
                                    onChange={e => setPrintOptions(prev => prev ? { ...prev, selectionOnly: e.target.checked } : prev)}
                                />
                                <span>Print selected cells only</span>
                            </label>
                        )}
                        <div className={styles.dialogActions}>
                            <button className={styles.dialogBtnPrimary} onClick={() => { doPrint(printOptions); setHamburgerDialog(null); setPrintOptions(null); }}>Print</button>
                            <button className={styles.dialogBtnSecondary} onClick={() => { setHamburgerDialog(null); setPrintOptions(null); }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── New spreadsheet dialog ── */}
            {hamburgerDialog === 'new' && (
                <div className={styles.dialogOverlay} onClick={closeDialog}>
                    <div className={styles.dialogBox} onClick={e => e.stopPropagation()}>
                        <div className={styles.dialogTitle}>New Spreadsheet</div>
                        <div className={styles.csvExportField}>
                            <label className={styles.csvExportLabel}>Name</label>
                            <input
                                className={styles.csvExportInput}
                                style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '7px 10px' }}
                                value={newTitle}
                                onChange={e => setNewTitle(e.target.value)}
                                onFocus={e => e.target.select()}
                                spellCheck={false}
                                autoFocus
                            />
                        </div>
                        <div className={styles.dialogActions}>
                            <button
                                className={styles.dialogBtnPrimary}
                                disabled={!newTitle.trim()}
                                onClick={() => { onCreateNew(newTitle.trim()); closeDialog(); setNewTitle('Untitled spreadsheet'); }}
                            >
                                Create
                            </button>
                            <button className={styles.dialogBtnSecondary} onClick={() => { closeDialog(); setNewTitle('Untitled spreadsheet'); }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── New spreadsheet: Blank vs. Template choice ── */}
            {hamburgerDialog === 'new-choice' && (
                <div className={styles.dialogOverlay} onClick={closeDialog}>
                    <div className={styles.dialogBox} onClick={e => e.stopPropagation()}>
                        <div className={styles.dialogTitle}>New Spreadsheet</div>
                        <div className={styles.dialogActions}>
                            <button
                                className={styles.dialogBtnSecondary}
                                onClick={() => setHamburgerDialog('new')}
                            >
                                Blank spreadsheet
                            </button>
                            <button
                                className={styles.dialogBtnPrimary}
                                onClick={() => setHamburgerDialog('new-template-gallery')}
                            >
                                From template
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── New spreadsheet: Template gallery ── */}
            {hamburgerDialog === 'new-template-gallery' && (
                <SheetTemplatePickerModal
                    open={hamburgerDialog === 'new-template-gallery'}
                    onClose={closeDialog}
                    onSelect={(template) => {
                        setSelectedTemplate(template);
                        setTemplateTitle(template.name);
                        setHamburgerDialog('new-template-name');
                    }}
                />
            )}

            {/* ── New spreadsheet: name the sheet created from a template ── */}
            {hamburgerDialog === 'new-template-name' && selectedTemplate && (
                <div className={styles.dialogOverlay} onClick={closeDialog}>
                    <div className={styles.dialogBox} onClick={e => e.stopPropagation()}>
                        <div className={styles.dialogTitle}>New Spreadsheet</div>
                        <div className={styles.csvExportField}>
                            <label className={styles.csvExportLabel}>Name</label>
                            <input
                                className={styles.csvExportInput}
                                style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '7px 10px' }}
                                value={templateTitle}
                                onChange={e => setTemplateTitle(e.target.value)}
                                onFocus={e => e.target.select()}
                                spellCheck={false}
                                autoFocus
                            />
                        </div>
                        <div className={styles.dialogActions}>
                            <button
                                className={styles.dialogBtnPrimary}
                                disabled={!templateTitle.trim()}
                                onClick={() => {
                                    onCreateFromTemplate(selectedTemplate, templateTitle.trim());
                                    closeDialog();
                                    setSelectedTemplate(null);
                                    setTemplateTitle('');
                                }}
                            >
                                Create
                            </button>
                            <button
                                className={styles.dialogBtnSecondary}
                                onClick={() => { closeDialog(); setSelectedTemplate(null); setTemplateTitle(''); }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Duplicate dialog ── */}
            {hamburgerDialog === 'duplicate' && (
                <div className={styles.dialogOverlay} onClick={closeDialog}>
                    <div className={styles.dialogBox} onClick={e => e.stopPropagation()}>
                        <div className={styles.dialogTitle}>Duplicate Spreadsheet</div>
                        <div className={styles.csvExportField}>
                            <label className={styles.csvExportLabel}>Name</label>
                            <input
                                className={styles.csvExportInput}
                                style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '7px 10px' }}
                                value={duplicateTitle || `${title} (copy)`}
                                onChange={e => setDuplicateTitle(e.target.value)}
                                onFocus={e => { if (!duplicateTitle) setDuplicateTitle(`${title} (copy)`); e.target.select(); }}
                                spellCheck={false}
                                autoFocus
                            />
                        </div>
                        <div className={styles.dialogActions}>
                            <button
                                className={styles.dialogBtnPrimary}
                                onClick={() => { onDuplicate((duplicateTitle || `${title} (copy)`).trim()); closeDialog(); setDuplicateTitle(''); }}
                            >
                                Duplicate
                            </button>
                            <button className={styles.dialogBtnSecondary} onClick={() => { closeDialog(); setDuplicateTitle(''); }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Import — New Sheet dialog (replaces all sheets) ── */}
            {hamburgerDialog === 'import-sheet' && (
                <div className={styles.dialogOverlay} onClick={closeDialog}>
                    <div className={styles.dialogBox} onClick={e => e.stopPropagation()}>
                        <div className={styles.dialogTitle}>Import — Replace Sheet</div>
                        <div className={styles.dialogBody}>
                            Choose a CSV or Excel file to import. This will replace all current sheet data.
                        </div>
                        <div className={styles.csvExportField}>
                            <input
                                ref={importSheetInputRef}
                                type="file"
                                accept=".csv,.xlsx,.xls"
                                style={{ display: 'none' }}
                                onChange={e => setImportSheetFile(e.target.files?.[0] ?? null)}
                            />
                            <button
                                className={styles.dialogBtnSecondary}
                                onClick={() => importSheetInputRef.current?.click()}
                            >
                                {importSheetFile ? importSheetFile.name : 'Choose file…'}
                            </button>
                        </div>
                        <div className={styles.dialogActions}>
                            <button
                                className={styles.dialogBtnPrimary}
                                disabled={!importSheetFile}
                                onClick={() => {
                                    if (importSheetFile) {
                                        onImportSheet(importSheetFile);
                                        setImportSheetFile(null);
                                        closeDialog();
                                    }
                                }}
                            >
                                Import
                            </button>
                            <button className={styles.dialogBtnSecondary} onClick={() => { setImportSheetFile(null); closeDialog(); }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Import — New Tab dialog (adds as new tab) ── */}
            {hamburgerDialog === 'import-tab' && (
                <div className={styles.dialogOverlay} onClick={closeDialog}>
                    <div className={styles.dialogBox} onClick={e => e.stopPropagation()}>
                        <div className={styles.dialogTitle}>Import — New Tab</div>
                        <div className={styles.dialogBody}>
                            Choose a CSV or Excel file to import as a new tab in this spreadsheet.
                        </div>
                        <div className={styles.csvExportField}>
                            <input
                                ref={importTabInputRef}
                                type="file"
                                accept=".csv,.xlsx,.xls"
                                style={{ display: 'none' }}
                                onChange={e => setImportTabFile(e.target.files?.[0] ?? null)}
                            />
                            <button
                                className={styles.dialogBtnSecondary}
                                onClick={() => importTabInputRef.current?.click()}
                            >
                                {importTabFile ? importTabFile.name : 'Choose file…'}
                            </button>
                        </div>
                        <div className={styles.dialogActions}>
                            <button
                                className={styles.dialogBtnPrimary}
                                disabled={!importTabFile}
                                onClick={() => {
                                    if (importTabFile) {
                                        onImportTab(importTabFile);
                                        setImportTabFile(null);
                                        closeDialog();
                                    }
                                }}
                            >
                                Import
                            </button>
                            <button className={styles.dialogBtnSecondary} onClick={() => { setImportTabFile(null); closeDialog(); }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Delete confirm dialog ── */}
            {hamburgerDialog === 'delete' && hamburgerDeleteConfirm && (
                <div className={styles.dialogOverlay} onClick={closeDialog}>
                    <div className={styles.dialogBox} onClick={e => e.stopPropagation()}>
                        <div className={styles.dialogTitle}>Delete &ldquo;{title}&rdquo;?</div>
                        <div className={styles.dialogBody}>This action cannot be undone.</div>
                        <div className={styles.dialogActions}>
                            <button className={styles.dialogBtnDanger} onClick={() => { onDelete(); closeDialog(); }}>Delete</button>
                            <button className={styles.dialogBtnSecondary} onClick={closeDialog}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Share dialog ── */}
            {hamburgerDialog === 'share' && (
                <ShareDialogForSheet sheetId={sheetId} onClose={closeDialog} />
            )}

            {/* ── Coming soon (offline) ── */}
            {hamburgerDialog === 'offline' && (
                <div className={styles.dialogOverlay} onClick={closeDialog}>
                    <div className={styles.dialogBox} onClick={e => e.stopPropagation()}>
                        <div className={styles.dialogTitle}>Make Available Offline</div>
                        <div className={styles.dialogBody}>This feature is coming soon.</div>
                        <div className={styles.dialogActions}>
                            <button className={styles.dialogBtnPrimary} onClick={closeDialog}>OK</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function ShareDialogForSheet({ sheetId, onClose }: { sheetId: string; onClose: () => void }) {
    const { data: fileItem } = useQuery({
        queryKey: ['file-metadata', sheetId],
        queryFn: () => storageApi.getFileMetadata(sheetId),
        enabled: !!sheetId,
    });
    if (!fileItem) return null;
    return <ShareDialog resource={fileItem} resourceType="file" onClose={onClose} />;
}
