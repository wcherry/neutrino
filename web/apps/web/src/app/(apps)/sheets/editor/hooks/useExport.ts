'use client';

import { useState, useCallback } from 'react';
import type { CellProps, CellStyle, SheetData } from '../types';
import { getRangeCells, getCellBounds, getSelectionSubset, triggerDownload, formatCellValue, numToAlpha } from '../utils';

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * One tab's live state as the stored model's shape, which is what `writeXlsx`
 * takes. `selectionIds` narrows it to a copied range for a selection export.
 */
function sheetDataFor(
    name: string,
    cells: Map<string, CellProps>,
    colWidths: Map<number, number> | undefined,
    rowHeights: Map<number, number> | undefined,
    selectionIds?: Set<string>,
): SheetData {
    const out: SheetData['cells'] = {};
    for (const [id, cell] of cells) {
        if (selectionIds && !selectionIds.has(id)) continue;
        out[id] = {
            id, raw: cell.raw, value: cell.value, cellStyle: cell.cellStyle,
            colSpan: cell.colSpan, rowSpan: cell.rowSpan, mergeAnchor: cell.mergeAnchor,
        };
    }
    const sheet: SheetData = { name, cells: out };
    if (colWidths?.size) sheet.colWidths = Object.fromEntries([...colWidths].map(([k, v]) => [String(k), v]));
    if (rowHeights?.size) sheet.rowHeights = Object.fromEntries([...rowHeights].map(([k, v]) => [String(k), v]));
    return sheet;
}

function buildTableHtml(
    cells: Map<string, CellProps>,
    colWidthsMap: Map<number, number>,
    rowHeightsMap: Map<number, number>,
    selectionIds?: Set<string>,
): string {
    const DEFAULT_COL_WIDTH = 100;
    const DEFAULT_ROW_HEIGHT = 22;
    const PT_TO_PX = 1.333;

    const activeCells = selectionIds ? getSelectionSubset(selectionIds, cells) : cells;

    const { minRow, maxRow, minCol, maxCol } = getCellBounds(activeCells.keys());
    if (maxRow === 0) return '';

    let colGroupHtml = '<colgroup>';
    for (let c = minCol; c <= maxCol; c++) {
        colGroupHtml += `<col style="width:${colWidthsMap.get(c - 1) ?? DEFAULT_COL_WIDTH}px">`;
    }
    colGroupHtml += '</colgroup>';

    const hidden = new Set<string>();
    let tbodyHtml = '<tbody>';
    for (let r = minRow; r <= maxRow; r++) {
        tbodyHtml += `<tr style="height:${rowHeightsMap.get(r - 1) ?? DEFAULT_ROW_HEIGHT}px">`;
        for (let c = minCol; c <= maxCol; c++) {
            const id = `${numToAlpha(c)}${r}`;
            if (hidden.has(id)) continue;
            const cell = activeCells.get(id);
            if (cell?.mergeAnchor) { hidden.add(id); continue; }

            const cs: CellStyle | undefined = cell?.cellStyle;
            const displayValue = cell ? formatCellValue(cell.value ?? cell.raw ?? '', cs) : '';
            const colSpan = cell?.colSpan ?? 1;
            const rowSpan = cell?.rowSpan ?? 1;

            if (colSpan > 1 || rowSpan > 1) {
                for (let dr = 0; dr < rowSpan; dr++) {
                    for (let dc = 0; dc < colSpan; dc++) {
                        if (dr === 0 && dc === 0) continue;
                        hidden.add(`${numToAlpha(c + dc)}${r + dr}`);
                    }
                }
            }

            let tdStyle = 'padding:2px 4px;border:1px solid #ddd;overflow:hidden;';
            if (cs?.fontFamily) tdStyle += `font-family:${cs.fontFamily};`;
            if (cs?.fontSize) { const ptVal = parseFloat(cs.fontSize); tdStyle += `font-size:${Math.round(ptVal * PT_TO_PX)}px;`; }
            if (cs?.fontWeight === 'bold') tdStyle += 'font-weight:bold;';
            if (cs?.fontStyle === 'italic') tdStyle += 'font-style:italic;';
            if (cs?.textDecoration === 'line-through') tdStyle += 'text-decoration:line-through;';
            if (cs?.color) tdStyle += `color:${cs.color};`;
            if (cs?.backgroundColor) tdStyle += `background-color:${cs.backgroundColor};`;
            if (cs?.textAlign) tdStyle += `text-align:${cs.textAlign};`;
            if (cs?.wrapMode === 'wrap') tdStyle += 'white-space:pre-wrap;word-break:break-word;';
            else tdStyle += 'white-space:nowrap;';
            if (cs?.borderStyle === 'thin') tdStyle += 'border:1px solid #999;';
            else if (cs?.borderStyle === 'medium') tdStyle += 'border:2px solid #555;';
            else if (cs?.borderStyle === 'thick') tdStyle += 'border:3px solid #111;';

            const colSpanAttr = colSpan > 1 ? ` colspan="${colSpan}"` : '';
            const rowSpanAttr = rowSpan > 1 ? ` rowspan="${rowSpan}"` : '';
            const escaped = String(displayValue)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            tbodyHtml += `<td${colSpanAttr}${rowSpanAttr} style="${tdStyle}">${escaped}</td>`;
        }
        tbodyHtml += '</tr>';
    }
    tbodyHtml += '</tbody>';
    return `<table style="border-collapse:collapse;table-layout:fixed;">${colGroupHtml}${tbodyHtml}</table>`;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useExport({
    title,
    sheetsDataRef,
    sheetsColWidthsRef,
    sheetsRowHeightsRef,
    activeSheetIndexRef,
    sheetNamesRef,
    selectionAnchorRef,
    selectionActiveRef,
    flushActiveSheet,
    sheetNames,
    setHamburgerDialog,
}: {
    title: string;
    sheetsDataRef: React.MutableRefObject<Map<string, CellProps>[]>;
    sheetsColWidthsRef: React.MutableRefObject<Map<number, number>[]>;
    sheetsRowHeightsRef: React.MutableRefObject<Map<number, number>[]>;
    activeSheetIndexRef: React.MutableRefObject<number>;
    sheetNamesRef: React.MutableRefObject<string[]>;
    selectionAnchorRef: React.MutableRefObject<string | undefined>;
    selectionActiveRef: React.MutableRefObject<string | undefined>;
    flushActiveSheet: () => void;
    sheetNames: string[];
    setHamburgerDialog: (dialog: string | null) => void;
}) {
    const [csvExportOptions, setCsvExportOptions] = useState<CsvExportOptions | null>(null);
    const [xlsxExportOptions, setXlsxExportOptions] = useState<XlsxExportOptions | null>(null);
    const [printOptions, setPrintOptions] = useState<PrintOptions | null>(null);
    const [htmlExportOptions, setHtmlExportOptions] = useState<HtmlExportOptions | null>(null);

    const hasMultiSelection = () =>
        selectionAnchorRef.current !== undefined &&
        selectionActiveRef.current !== undefined &&
        selectionAnchorRef.current !== selectionActiveRef.current;

    // ── CSV ───────────────────────────────────────────────────────────────────

    const openCsvExportDialog = useCallback(() => {
        flushActiveSheet();
        const hasSelection = hasMultiSelection();
        setCsvExportOptions({
            filename: title || 'sheet',
            sheetIndex: activeSheetIndexRef.current,
            selectionOnly: hasSelection,
            hasSelection,
        });
        setHamburgerDialog('export-csv');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [title, flushActiveSheet, activeSheetIndexRef, setHamburgerDialog]);

    const doExportCsv = useCallback((opts: { filename: string; sheetIndex: number; selectionOnly: boolean }) => {
        const cells = opts.selectionOnly
            ? getSelectionSubset(
                getRangeCells(selectionAnchorRef.current!, selectionActiveRef.current ?? selectionAnchorRef.current!),
                sheetsDataRef.current[opts.sheetIndex],
            )
            : sheetsDataRef.current[opts.sheetIndex];

        const { minRow, maxRow, minCol, maxCol } = getCellBounds(cells.keys());
        if (maxRow === 0) return;

        const rows: string[] = [];
        for (let r = minRow; r <= maxRow; r++) {
            const cols: string[] = [];
            for (let c = minCol; c <= maxCol; c++) {
                const cell = cells.get(`${numToAlpha(c)}${r}`);
                const val = cell?.value ?? cell?.raw ?? '';
                if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                    cols.push('"' + val.replace(/"/g, '""') + '"');
                } else {
                    cols.push(val);
                }
            }
            rows.push(cols.join(','));
        }
        triggerDownload(
            new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' }),
            `${opts.filename || 'sheet'}.csv`,
        );
    }, [sheetsDataRef, selectionAnchorRef, selectionActiveRef]);

    // ── XLSX ──────────────────────────────────────────────────────────────────

    const openXlsxExportDialog = useCallback(() => {
        flushActiveSheet();
        const hasSelection = hasMultiSelection();
        setXlsxExportOptions({
            filename: title || 'sheet',
            sheetIndex: activeSheetIndexRef.current,
            selectionOnly: false,
            hasSelection,
            allSheets: sheetsDataRef.current.length > 1,
        });
        setHamburgerDialog('export-xlsx-dialog');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [title, flushActiveSheet, activeSheetIndexRef, sheetsDataRef, setHamburgerDialog]);

    /**
     * One writer for both destinations — the autosave that stores the
     * spreadsheet and the export that downloads it — because a spreadsheet is
     * *stored* as an `.xlsx` now, so an export that produced anything different
     * would mean two writers to keep in step and a downloaded copy that did not
     * match the stored one. It used to be `buildXlsxWorksheet`, which wrote a
     * value per cell and nothing else, so an exported workbook arrived with the
     * numbers and none of the formatting.
     *
     * Charts, conditional formats and table regions are not here: this hook is
     * given the cells, widths and heights and nothing else. They are in the
     * stored file, which is what a user who wants all of it should download
     * from Drive.
     */
    const doExportXlsx = useCallback(async (opts: {
        filename: string;
        sheetIndex: number;
        selectionOnly: boolean;
        allSheets: boolean;
    }) => {
        flushActiveSheet();
        const { writeXlsx } = await import('@/lib/ooxml/xlsx/write');
        const indices = opts.allSheets
            ? sheetNamesRef.current.map((_, i) => i)
            : [opts.sheetIndex];
        const selectionIds = !opts.allSheets && opts.selectionOnly
            ? getRangeCells(selectionAnchorRef.current!, selectionActiveRef.current ?? selectionAnchorRef.current!)
            : undefined;
        const bytes = await writeXlsx({
            sheets: indices.map((i) => sheetDataFor(
                sheetNamesRef.current[i],
                sheetsDataRef.current[i],
                sheetsColWidthsRef.current[i],
                sheetsRowHeightsRef.current[i],
                selectionIds,
            )),
        });
        triggerDownload(
            new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
            `${opts.filename || 'sheet'}.xlsx`,
        );
    }, [
        flushActiveSheet, sheetsDataRef, sheetNamesRef, sheetsColWidthsRef, sheetsRowHeightsRef,
        selectionAnchorRef, selectionActiveRef,
    ]);

    // ── Print ─────────────────────────────────────────────────────────────────

    const openPrintDialog = useCallback(() => {
        flushActiveSheet();
        const hasSelection = hasMultiSelection();
        setPrintOptions({
            sheetIndex: activeSheetIndexRef.current,
            allSheets: false,
            selectionOnly: false,
            hasSelection,
        });
        setHamburgerDialog('print');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flushActiveSheet, activeSheetIndexRef, setHamburgerDialog]);

    const doPrint = useCallback((opts: {
        sheetIndex: number;
        allSheets: boolean;
        selectionOnly: boolean;
    }) => {
        flushActiveSheet();
        let bodyHtml = '';
        if (opts.allSheets) {
            for (let i = 0; i < sheetsDataRef.current.length; i++) {
                bodyHtml += `<h2 style="font-family:sans-serif;margin:16px 0 8px;">${sheetNamesRef.current[i]}</h2>`;
                bodyHtml += buildTableHtml(sheetsDataRef.current[i], sheetsColWidthsRef.current[i], sheetsRowHeightsRef.current[i]);
                if (i < sheetsDataRef.current.length - 1) bodyHtml += '<div style="page-break-after:always"></div>';
            }
        } else {
            const selectionIds = opts.selectionOnly
                ? getRangeCells(selectionAnchorRef.current!, selectionActiveRef.current ?? selectionAnchorRef.current!)
                : undefined;
            bodyHtml = buildTableHtml(
                sheetsDataRef.current[opts.sheetIndex],
                sheetsColWidthsRef.current[opts.sheetIndex],
                sheetsRowHeightsRef.current[opts.sheetIndex],
                selectionIds,
            );
        }

        const win = window.open('', '_blank');
        if (!win) return;
        win.document.title = `Print \u2014 ${title}`;
        const style = win.document.createElement('style');
        style.textContent = 'body { margin: 16px; font-size: 11px; } @media print { body { margin: 0; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }';
        win.document.head.appendChild(style);
        win.document.body.innerHTML = bodyHtml;
        win.addEventListener('afterprint', () => win.close());
        win.print();
    }, [title, flushActiveSheet, sheetsDataRef, sheetsColWidthsRef, sheetsRowHeightsRef, sheetNamesRef, selectionAnchorRef, selectionActiveRef]);

    // ── HTML ──────────────────────────────────────────────────────────────────

    const openHtmlExportDialog = useCallback(() => {
        flushActiveSheet();
        const hasSelection = hasMultiSelection();
        setHtmlExportOptions({
            filename: title || 'sheet',
            sheetIndex: activeSheetIndexRef.current,
            selectionOnly: false,
            hasSelection,
            allSheets: sheetsDataRef.current.length > 1,
        });
        setHamburgerDialog('export-html');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [title, flushActiveSheet, activeSheetIndexRef, sheetsDataRef, setHamburgerDialog]);

    const doExportHtml = useCallback((opts: {
        filename: string;
        sheetIndex: number;
        selectionOnly: boolean;
        allSheets: boolean;
    }) => {
        flushActiveSheet();
        let bodyHtml = '';
        if (opts.allSheets) {
            for (let i = 0; i < sheetsDataRef.current.length; i++) {
                bodyHtml += `<h2 style="font-family:sans-serif;margin:16px 0 8px;">${sheetNamesRef.current[i]}</h2>`;
                bodyHtml += buildTableHtml(sheetsDataRef.current[i], sheetsColWidthsRef.current[i], sheetsRowHeightsRef.current[i]);
            }
        } else {
            const selectionIds = opts.selectionOnly
                ? getRangeCells(selectionAnchorRef.current!, selectionActiveRef.current ?? selectionAnchorRef.current!)
                : undefined;
            bodyHtml = buildTableHtml(
                sheetsDataRef.current[opts.sheetIndex],
                sheetsColWidthsRef.current[opts.sheetIndex],
                sheetsRowHeightsRef.current[opts.sheetIndex],
                selectionIds,
            );
        }
        const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${opts.filename || 'sheet'}</title></head><body style="margin:16px;font-family:sans-serif;">${bodyHtml}</body></html>`;
        triggerDownload(
            new Blob([fullHtml], { type: 'text/html;charset=utf-8;' }),
            `${opts.filename || 'sheet'}.html`,
        );
    }, [flushActiveSheet, sheetsDataRef, sheetsColWidthsRef, sheetsRowHeightsRef, sheetNamesRef, selectionAnchorRef, selectionActiveRef]);

    return {
        csvExportOptions,
        setCsvExportOptions,
        xlsxExportOptions,
        setXlsxExportOptions,
        printOptions,
        setPrintOptions,
        htmlExportOptions,
        setHtmlExportOptions,
        openCsvExportDialog,
        doExportCsv,
        openXlsxExportDialog,
        doExportXlsx,
        openPrintDialog,
        doPrint,
        openHtmlExportDialog,
        doExportHtml,
        sheetNames,
    };
}
