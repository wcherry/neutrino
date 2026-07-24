'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import * as XLSX from 'xlsx';
import type { CellProps, SheetFile, CFRule } from '../types';
import type { ChartDef } from '../charts/chartTypes';
import {
    sheetsApi, driveReadContent, driveCreateVersion, driveCreateEncryptedVersion, driveAutosaveEncryptedContent,
    driveAutosaveBytes, driveCreateVersionBytes,
    storageApi, filesystemApi, ApiClientError, type SheetResponse, type FileItem,
} from '@/lib/api';
import { decryptFile } from '@neutrino/e2e-crypto';
import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import { useToast } from '@neutrino/ui';
import { ENCRYPTION_WARNING_MESSAGE } from '@/components/EncryptionWarningMessage';
import type { SheetRef } from '../formula';
import { numToAlpha } from '../utils';
import { buildXlsxWorksheet } from './useExport';
import { buildRawSheetMap, evaluateSheetMap } from './sheetFileUtils';
import { officeAppForFile, OFFICE_MIME } from '@/lib/officeFormats';
import { getOfficeFileMode, isOneShotPromoteRequested } from '@/hooks/useOfficeFileMode';

/**
 * Parse raw .xlsx bytes into per-sheet cell maps — office-mode counterpart of
 * `parseXlsxToSheets` in SheetEditor.tsx (kept separate to avoid a hook ->
 * top-level-component import).
 */
function xlsxBufferToSheets(buffer: ArrayBuffer): { name: string; data: Map<string, CellProps> }[] {
    const wb = XLSX.read(new Uint8Array(buffer));
    return wb.SheetNames.map(name => {
        const ws = wb.Sheets[name];
        const map = new Map<string, CellProps>();
        const ref = ws['!ref'];
        if (ref) {
            const range = XLSX.utils.decode_range(ref);
            for (let r = range.s.r; r <= range.e.r; r++) {
                for (let c = range.s.c; c <= range.e.c; c++) {
                    const cell = ws[XLSX.utils.encode_cell({ r, c })];
                    if (!cell || cell.v == null) continue;
                    const id = `${numToAlpha(c + 1)}${r + 1}`;
                    const val = cell.w ?? String(cell.v);
                    if (val !== '') map.set(id, { id, raw: val, value: val, edit: false });
                }
            }
        }
        return { name, data: map };
    });
}

export function usePersistence({
    sheetId,
    dirtyRef,
    sheetsDataRef,
    sheetsColWidthsRef,
    sheetsRowHeightsRef,
    activeSheetIndexRef,
    sheetNamesRef,
    sheetColorsRef,
    flushActiveSheet,
    setData,
    setColWidths,
    setRowHeights,
    setSheetNames,
    setSheetColors,
    sheetsChartsRef,
    flushActiveCharts,
    setCharts,
    sheetsConditionalFormatsRef,
    flushActiveConditionalFormats,
    setConditionalFormats,
    // Office mode (issue #43). Defaults to true so callers that don't pass it
    // (and this hook's own unit tests, which render it standalone with no
    // FeatureFlagsProvider) still get the 404-fallback behavior; SheetEditor.tsx
    // passes the real `flags.officeInPlaceEditing` value explicitly.
    officeInPlaceEditingEnabled = true,
}: {
    sheetId: string;
    dirtyRef: React.MutableRefObject<boolean>;
    sheetsDataRef: React.MutableRefObject<Map<string, CellProps>[]>;
    sheetsColWidthsRef: React.MutableRefObject<Map<number, number>[]>;
    sheetsRowHeightsRef: React.MutableRefObject<Map<number, number>[]>;
    activeSheetIndexRef: React.MutableRefObject<number>;
    sheetNamesRef: React.MutableRefObject<string[]>;
    sheetColorsRef: React.MutableRefObject<(string | null)[]>;
    flushActiveSheet: () => void;
    setData: React.Dispatch<React.SetStateAction<Map<string, CellProps>>>;
    setColWidths: React.Dispatch<React.SetStateAction<Map<number, number>>>;
    setRowHeights: React.Dispatch<React.SetStateAction<Map<number, number>>>;
    setSheetNames: React.Dispatch<React.SetStateAction<string[]>>;
    setSheetColors: React.Dispatch<React.SetStateAction<(string | null)[]>>;
    // Optional chart persistence — omit if charting is not enabled
    sheetsChartsRef?: React.MutableRefObject<ChartDef[][]>;
    flushActiveCharts?: () => void;
    setCharts?: React.Dispatch<React.SetStateAction<ChartDef[]>>;
    // Optional conditional formatting persistence — omit if feature is disabled
    sheetsConditionalFormatsRef?: React.MutableRefObject<CFRule[][]>;
    flushActiveConditionalFormats?: () => void;
    setConditionalFormats?: React.Dispatch<React.SetStateAction<CFRule[]>>;
    officeInPlaceEditingEnabled?: boolean;
}) {
    const sheetRef = useRef<SheetResponse | null>(null);
    const { dekRef, dekResolved, isNewEncryption } = useEncryptedDocumentContent({ id: sheetId, filename: 'sheet.json' });
    const toast = useToast();
    const [title, setTitle] = useState('Untitled');
    const [yourRole, setYourRole] = useState<string>('owner');
    // ── Office mode (issue #43) ──────────────────────────────────────────────
    // True when this file is a raw .xlsx being edited in place (no `sheets`
    // row) rather than a native Neutrino sheet.
    const [officeMode, setOfficeMode] = useState(false);
    const officeFileMetaRef = useRef<FileItem | null>(null);
    // loadCount increments every time load() completes successfully.
    // The autosave useEffect depends on it so it restarts (with cleanup) on each reload.
    const [loadCount, setLoadCount] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Always points to the latest save function so the flush-on-unmount effect
    // (which uses empty deps) can call it without a stale closure.
    const saveRef = useRef<() => Promise<void>>(async () => {});
    // Every save (initial re-encryption, timer tick, flush-on-unmount) chains onto
    // this promise so the underlying PUT requests never overlap. Firing two
    // autosave PUTs back-to-back on the same connection has been observed to
    // truncate the second request's body in transit (server sees a multipart
    // "Payload(Incomplete)" 400) — almost certainly a keep-alive/connection-reuse
    // edge case between the browser and the dev/test proxy. Chaining guarantees
    // one request's response is fully received before the next one is sent.
    const saveChainRef = useRef<Promise<void>>(Promise.resolve());
    const queueSave = () => {
        saveChainRef.current = saveChainRef.current.then(() => saveRef.current()).catch(() => {});
        return saveChainRef.current;
    };

    const serialize = (): string => {
        flushActiveSheet();
        flushActiveCharts?.();
        flushActiveConditionalFormats?.();
        const fileSheets = sheetsDataRef.current.map((sheetData, i) => {
            const cells: SheetFile['sheets'][0]['cells'] = {};
            for (const [id, cell] of sheetData) {
                cells[id] = { id, raw: cell.raw, value: cell.value, cellStyle: cell.cellStyle,
                    colSpan: cell.colSpan, rowSpan: cell.rowSpan, mergeAnchor: cell.mergeAnchor };
            }
            const cw = sheetsColWidthsRef.current[i];
            const rh = sheetsRowHeightsRef.current[i];
            const colWidthsObj = cw && cw.size > 0
                ? Object.fromEntries([...cw].map(([k, v]) => [String(k), v]))
                : undefined;
            const rowHeightsObj = rh && rh.size > 0
                ? Object.fromEntries([...rh].map(([k, v]) => [String(k), v]))
                : undefined;
            const color = sheetColorsRef.current[i] ?? undefined;
            const sheetCharts = sheetsChartsRef?.current[i];
            const sheetCF = sheetsConditionalFormatsRef?.current[i];
            return {
                name: sheetNamesRef.current[i] ?? `Sheet ${i + 1}`,
                color,
                cells,
                colWidths: colWidthsObj,
                rowHeights: rowHeightsObj,
                charts: sheetCharts && sheetCharts.length > 0 ? sheetCharts : undefined,
                conditionalFormats: sheetCF && sheetCF.length > 0 ? sheetCF : undefined,
            };
        });
        return JSON.stringify({ sheets: fileSheets } as SheetFile);
    };

    // Office mode (issue #43): serialize current sheet data into real XLSX
    // bytes instead of the native JSON shape, for writing back to the SAME
    // Drive file id via the binary-safe *Bytes transport.
    const buildXlsxBytes = (): Uint8Array => {
        flushActiveSheet();
        flushActiveCharts?.();
        flushActiveConditionalFormats?.();
        const wb = XLSX.utils.book_new();
        sheetNamesRef.current.forEach((name, i) => {
            XLSX.utils.book_append_sheet(wb, buildXlsxWorksheet(sheetsDataRef.current[i]), name || `Sheet${i + 1}`);
        });
        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
        return new Uint8Array(buf);
    };

    const save = async () => {
        if (officeMode) {
            const meta = officeFileMetaRef.current;
            if (!meta) return;
            const bytes = buildXlsxBytes();
            // Office-mode files stay real, uncorrupted OOXML at rest (acceptance
            // criterion 3 — downloading the raw file must open in real Excel), so
            // these never go through the E2EE-encrypted transport even when a DEK
            // is available for this file id.
            try {
                await driveAutosaveBytes(sheetId, bytes, meta.name, OFFICE_MIME.xlsx);
            } catch {
                await driveAutosaveBytes(sheetId, bytes, meta.name, OFFICE_MIME.xlsx);
            }
            return;
        }
        if (!sheetRef.current) return;
        if (!dekRef.current) {
            toast.warning(ENCRYPTION_WARNING_MESSAGE);
            return;
        }
        const content = serialize();
        // Retry once on failure: the autosave PUT has been observed to occasionally
        // fail with a transient transport-level error (e.g. a truncated request body)
        // when it follows closely after another request to the same endpoint. This
        // save is often the last chance to persist an edit before the user navigates
        // away, so silently swallowing a transient failure would lose real data.
        try {
            await driveAutosaveEncryptedContent(sheetId, content, 'sheet.json', dekRef.current);
        } catch {
            await driveAutosaveEncryptedContent(sheetId, content, 'sheet.json', dekRef.current);
        }
    };
    saveRef.current = save;

    const manualSave = async () => {
        if (officeMode) {
            const meta = officeFileMetaRef.current;
            if (!meta) return;
            const bytes = buildXlsxBytes();
            await driveCreateVersionBytes(sheetId, bytes, meta.name, OFFICE_MIME.xlsx);
            return;
        }
        if (!sheetRef.current) return;
        if (dekRef.current) {
            await driveCreateEncryptedVersion(sheetId, serialize(), 'sheet.json', dekRef.current);
        } else {
            await driveCreateVersion(sheetId, serialize(), 'sheet.json');
        }
    };

    // "Convert to Neutrino Sheet" — one-shot promote of the raw office file
    // into a native sheet, keeping the same Drive file id.
    const promote = async () => {
        try {
            const content = serialize();
            await sheetsApi.promoteSheet(sheetId, content);
            setOfficeMode(false);
            officeFileMetaRef.current = null;
            toast.success('Converted to a native Neutrino sheet');
        } catch {
            toast.error('Failed to convert to a native Neutrino sheet');
        }
    };

    const timedSave = async () => {
        if (!dirtyRef.current) return;
        dirtyRef.current = false;
        // Flush any pending React startTransition updates (e.g. from cell editing)
        // so dataRef.current reflects the latest committed state before serialising.
        // Wrapped in try-catch for the same reason as the unmount flush: flushSync can
        // throw "flushSync was called from inside a lifecycle method" in React 18
        // concurrent mode. The drive save must still fire even if the flush is skipped.
        try { flushSync(() => {}); } catch (_) {}
        await queueSave();
    };

    // Single autosave interval, restarted cleanly after every load().
    // loadCount === 0 means load() has never completed, so no interval is started yet.
    useEffect(() => {
        if (loadCount === 0) return;
        intervalRef.current = setInterval(() => { timedSave(); }, 3_000);
        return () => {
            if (intervalRef.current !== null) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    // timedSave captures refs (dirtyRef, sheetRef, dekRef) that never change identity,
    // so it is safe to omit it from the deps array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadCount]);

    // Flush dirty state when the user leaves: tab hidden, page unload, or SPA navigation.
    // Uses empty deps so the cleanup always runs on unmount regardless of load state.
    // saveRef.current always points to the latest save, avoiding stale closure issues.
    useEffect(() => {
        const flush = () => {
            if (!dirtyRef.current || (!sheetRef.current && !officeFileMetaRef.current)) return;
            dirtyRef.current = false;
            // Flush any pending startTransition updates so dataRef.current reflects
            // the latest committed cell values before serialising (same as timedSave).
            // Wrapped in try-catch: calling flushSync during React 18 passive-effect
            // cleanup may throw "flushSync was called from inside a lifecycle method".
            // The save must still fire even if the flush is skipped.
            try { flushSync(() => {}); } catch (_) {}
            queueSave(); // fire and forget — chained so it can't overlap another save
        };
        const onVisibilityChange = () => { if (document.visibilityState === 'hidden') flush(); };
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('pagehide', flush);
        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('pagehide', flush);
            flush();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const load = async () => {
        if (!sheetId) return;

        // Reset dirty so a reload (e.g. version restore) doesn't trigger the
        // colWidths/rowHeights save-on-change effect with stale unsaved state.
        dirtyRef.current = false;

        // DEK resolution is handled by useEncryptedDocumentContent; dekRef is
        // already populated by the time the editor calls load().
        let sheet: SheetResponse;
        try {
            sheet = await sheetsApi.getSheet(sheetId);
        } catch (err) {
            const is404 = err instanceof ApiClientError && err.statusCode === 404;
            if (!is404 || !officeInPlaceEditingEnabled) throw err;
            // Raw office file — no `sheets` row for this file id. Fall back to
            // the generic Drive file metadata to distinguish "raw .xlsx, open
            // it in place" from a genuinely deleted/missing spreadsheet.
            let meta: FileItem;
            try {
                meta = await storageApi.getFileMetadata(sheetId);
            } catch {
                // Genuinely missing — leave the sheet in its existing
                // "not loaded" state; do NOT start autosave.
                return;
            }
            const app = officeAppForFile(meta.mimeType, meta.name);
            if (app !== 'sheets') return; // not an .xlsx this editor can open
            officeFileMetaRef.current = meta;
            setOfficeMode(true);
            setTitle(meta.name);
            setYourRole('owner');
            try {
                const blob = await storageApi.downloadFile(sheetId);
                const arrayBuffer = await blob.arrayBuffer();
                const parsed = xlsxBufferToSheets(arrayBuffer);
                if (parsed.length > 0) {
                    const names = parsed.map((s, i) => s.name || `Sheet ${i + 1}`);
                    sheetsDataRef.current = parsed.map(s => s.data);
                    sheetsColWidthsRef.current = parsed.map(() => new Map());
                    sheetsRowHeightsRef.current = parsed.map(() => new Map());
                    setSheetNames(names);
                    setSheetColors(parsed.map(() => null));
                    setData(parsed[0].data);
                    setColWidths(new Map());
                    setRowHeights(new Map());
                }
                setLoadCount(c => c + 1);
                // Convert-on-open (global setting) or a one-shot promote request
                // from the Drive context menu's "Convert to Neutrino Sheet" action:
                // silently promote right after the initial client-side parse
                // renders. Non-blocking.
                if (getOfficeFileMode() === 'convert-on-open' || isOneShotPromoteRequested()) {
                    void promote();
                }
            } catch {
                toast.error('Failed to open this file for editing');
            }
            return;
        }
        sheetRef.current = sheet;
        setTitle(sheet.title);
        setYourRole(sheet.yourRole ?? 'owner');
        // True only when decryptFile throws on a brand-new file (isNewEncryption),
        // meaning the server still holds the plaintext default content written at
        // sheet creation time.  When decryptFile throws for an existing key
        // (isNewEncryption=false), we fall back to the raw plaintext path so we
        // never overwrite data we simply cannot decrypt.
        let serverHasPlaintextContent = false;
        // Set to true only when the try block completes without a download error.
        // Kept false on network failures so autosave never starts after a failed load.
        let loadOk = false;
        try {
            let raw: string;
            if (dekRef.current) {
                const blob = await storageApi.downloadFile(sheetId);
                const cipherBytes = new Uint8Array(await blob.arrayBuffer());
                try {
                    const plainBytes = decryptFile(cipherBytes, dekRef.current);
                    raw = new TextDecoder().decode(plainBytes);
                } catch {
                    if (isNewEncryption) {
                        serverHasPlaintextContent = true;
                        throw new Error('plaintext content detected');
                    }
                    // Existing key but decryption failed — fall back to raw content
                    // so we never overwrite data we cannot decrypt.
                    raw = await driveReadContent(sheet.contentUrl);
                }
            } else {
                raw = await driveReadContent(sheet.contentUrl);
            }
            const file = JSON.parse(raw) as SheetFile;
            const rawSheets = file.sheets ?? [];
            if (rawSheets.length > 0) {
                const names = rawSheets.map((s, i) => s.name ?? `Sheet ${i + 1}`);
                // Pass 1: build raw maps (no formula evaluation yet)
                const rawMaps = rawSheets.map(buildRawSheetMap);
                // Pass 2: evaluate formulas with full cross-sheet context
                const allSheets: SheetRef[] = names.map((name, i) => ({ name, data: rawMaps[i] }));
                const allData = rawMaps.map(rawMap => evaluateSheetMap(rawMap, allSheets));
                const allColWidths = rawSheets.map(s => {
                    const m = new Map<number, number>();
                    for (const [k, v] of Object.entries(s.colWidths ?? {})) m.set(Number(k), v);
                    return m;
                });
                const allRowHeights = rawSheets.map(s => {
                    const m = new Map<number, number>();
                    for (const [k, v] of Object.entries(s.rowHeights ?? {})) m.set(Number(k), v);
                    return m;
                });
                const colors = rawSheets.map(s => s.color ?? null);
                // Preserve any sheets the user added while the content download
                // was still in progress — load() is async and the user may have
                // pushed new entries to the refs before we get here.
                const extraData = sheetsDataRef.current.slice(allData.length);
                const extraColWidths = sheetsColWidthsRef.current.slice(allData.length);
                const extraRowHeights = sheetsRowHeightsRef.current.slice(allData.length);
                sheetsDataRef.current = [...allData, ...extraData];
                sheetsColWidthsRef.current = [...allColWidths, ...extraColWidths];
                sheetsRowHeightsRef.current = [...allRowHeights, ...extraRowHeights];
                const extraNames = extraData.map((_, i) => `Sheet ${allData.length + i + 1}`);
                const extraColors = extraData.map(() => null as string | null);
                setSheetNames([...names, ...extraNames]);
                setSheetColors([...colors, ...extraColors]);
                setData(allData[0]);
                setColWidths(allColWidths[0]);
                setRowHeights(allRowHeights[0]);
                // Restore charts if the hook is wired up; preserve any charts
                // the user placed on sheets they added during the download.
                if (sheetsChartsRef && setCharts) {
                    const extraCharts = sheetsChartsRef.current.slice(allData.length);
                    sheetsChartsRef.current = [
                        ...rawSheets.map(s => s.charts ?? []),
                        ...extraCharts,
                    ];
                    setCharts(sheetsChartsRef.current[0] ?? []);
                }
                // Restore conditional formats if the hook is wired up.
                if (sheetsConditionalFormatsRef && setConditionalFormats) {
                    const extraCF = sheetsConditionalFormatsRef.current.slice(allData.length);
                    sheetsConditionalFormatsRef.current = [
                        ...rawSheets.map(s => s.conditionalFormats ?? []),
                        ...extraCF,
                    ];
                    setConditionalFormats(sheetsConditionalFormatsRef.current[0] ?? []);
                }
            }
            loadOk = true;
        } catch {
            // empty sheet, start fresh — but do NOT start autosave if this was a
            // network/download failure; loadOk stays false and autosave is skipped
            // so we never overwrite existing server content with an empty file.
        }
        // Signal the autosave useEffect to (re-)start the interval with a fresh closure.
        // Guard: only start when content was successfully loaded OR when we know the
        // server holds plaintext content that needs to be encrypted (new file).
        if (loadOk || serverHasPlaintextContent) {
            setLoadCount(c => c + 1);
        }

        // The server holds plaintext initial content for brand-new encrypted sheets
        // (written as plaintext by POST /api/v1/sheets on creation); for existing
        // encrypted sheets decryptFile succeeds and serverHasPlaintextContent stays
        // false. Routed through queueSave (not called directly) so this request can
        // never overlap a save triggered moments later by a fast edit-then-navigate —
        // two autosave PUTs in flight at once have been observed to truncate the
        // second request's body in transit, which would silently drop the user's edit.
        if (serverHasPlaintextContent && dekRef.current) {
            await queueSave();
        }
    };

    const updateTitle = async (event: React.FocusEvent<HTMLElement>) => {
        const newTitle = (event.currentTarget as HTMLElement).innerHTML;
        setTitle(newTitle);
        if (officeMode) {
            // No `sheets` row to PATCH — office-mode renames go through the
            // generic Drive rename call (same one FileContextMenu's rename
            // action uses).
            if (officeFileMetaRef.current && newTitle !== officeFileMetaRef.current.name) {
                officeFileMetaRef.current = { ...officeFileMetaRef.current, name: newTitle };
                await filesystemApi.updateFile(sheetId, { name: newTitle });
            }
            return;
        }
        if (sheetRef.current && newTitle !== sheetRef.current.title) {
            sheetRef.current.title = newTitle;
            await sheetsApi.saveSheet(sheetId, { title: newTitle });
        }
    };

    return {
        sheetRef,
        title,
        setTitle,
        yourRole,
        load,
        save,
        manualSave,
        serialize,
        updateTitle,
        activeSheetIndexRef,
        /** True once the E2EE DEK resolution attempt has completed. */
        dekResolved,
        /** Office mode (issue #43): true when editing a raw .xlsx in place. */
        officeMode,
        /** One-shot promote of the raw office file into a native sheet. */
        promote,
    };
}
