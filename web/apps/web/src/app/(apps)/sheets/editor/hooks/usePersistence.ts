'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import * as XLSX from 'xlsx';
import type { CellProps, SheetFile, CFRule, TableRegion } from '../types';
import type { ChartDef } from '../charts/chartTypes';
import {
    sheetsApi, driveReadContent, driveCreateEncryptedVersion, driveAutosaveEncryptedContent,
    driveAutosaveEncryptedBytes, driveCreateEncryptedVersionBytes, extractSheetText,
    storageApi, filesystemApi, ApiClientError, type SheetResponse, type FileItem,
} from '@/lib/api';
import { decryptFile } from '@neutrino/e2e-crypto';
import { useUser } from '@neutrino/auth';
import { indexOnSave } from '@/lib/searchIndexUpdate';
import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import { useToast } from '@neutrino/ui';
import { ENCRYPTION_WARNING_MESSAGE } from '@/components/EncryptionWarningMessage';
import type { SheetRef } from '../formula';
import { numToAlpha } from '../utils';
import { buildXlsxWorksheet } from './useExport';
import { buildRawSheetMap, evaluateSheetMap } from './sheetFileUtils';
import { officeAppForFile } from '@/lib/officeFormats';
import { getOfficeFileMode, isOneShotPromoteRequested } from '@/hooks/useOfficeFileMode';
import { useContentVersionGuard } from '@/hooks/useContentVersionGuard';

/**
 * How long one save may hold the save chain before the next one is allowed to
 * run. Comfortably longer than a slow upload of a large sheet; short enough
 * that a request which will never answer does not cost the user a whole
 * editing session's worth of saves.
 */
const SAVE_DEADLINE_MS = 20_000;

/** How long to wait before re-sending a save whose request failed in transit. */
const SAVE_RETRY_DELAY_MS = 400;

interface SaveOptions {
    /**
     * This save is the last thing the page does — the user is navigating away.
     * The request has to be allowed to outlive the document, or the browser
     * cancels it partway and the edit that triggered it is lost.
     */
    keepalive?: boolean;
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * A signal that aborts after `ms`, so a request with no answer releases its
 * connection instead of holding one open for the rest of the session. Without
 * this the deadline below would only stop the *waiting* — the socket would stay
 * occupied and take the retry down with it.
 *
 * `AbortSignal.timeout` is Baseline-supported but absent in older Safari and in
 * jsdom, where saving unguarded is the pre-existing behaviour.
 */
function abortAfter(ms: number): AbortSignal | undefined {
    return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
        ? AbortSignal.timeout(ms)
        : undefined;
}

/**
 * `promise`, but rejecting if it has not settled within `ms`.
 *
 * The timer is cleared either way: a pending `setTimeout` per save would keep
 * the editor awake and, on the flush-on-unmount path, outlive the component.
 */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('save-timeout')), ms);
    });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

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
    sheetsTableRegionsRef,
    flushActiveTableRegions,
    setTableRegions,
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
    // Optional table-region persistence — omit if the feature isn't wired up
    sheetsTableRegionsRef?: React.MutableRefObject<TableRegion[][]>;
    flushActiveTableRegions?: () => void;
    setTableRegions?: React.Dispatch<React.SetStateAction<TableRegion[]>>;
    officeInPlaceEditingEnabled?: boolean;
}) {
    const sheetRef = useRef<SheetResponse | null>(null);
    const { dekRef, dekResolved, isNewEncryption } = useEncryptedDocumentContent({ id: sheetId, filename: 'sheet.json' });
    const toast = useToast();
    // Rejects a save that would overwrite a revision written elsewhere since
    // this spreadsheet was loaded. See `useContentVersionGuard`.
    const versionGuard = useContentVersionGuard();
    const currentUser = useUser();
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
    const saveRef = useRef<(opts?: SaveOptions) => Promise<void>>(async () => {});
    // Every save (initial re-encryption, timer tick, flush-on-unmount) chains onto
    // this promise so the underlying PUT requests never overlap. Firing two
    // autosave PUTs back-to-back on the same connection has been observed to
    // truncate the second request's body in transit (server sees a multipart
    // "Payload(Incomplete)" 400) — almost certainly a keep-alive/connection-reuse
    // edge case between the browser and the dev/test proxy. Chaining guarantees
    // one request's response is fully received before the next one is sent.
    const saveChainRef = useRef<Promise<void>>(Promise.resolve());
    const queueSave = (opts?: SaveOptions) => {
        saveChainRef.current = saveChainRef.current
            // Bounded, because everything queued behind a save waits for it. The
            // same connection-reuse fault that truncates a body can also leave a
            // PUT with no response at all, and an unbounded link here turns that
            // into an editor that never saves again — every later edit silently
            // dropped, with no error anywhere. Giving up on one save is recoverable;
            // the next timer tick tries again.
            .then(() => withDeadline(saveRef.current(opts), SAVE_DEADLINE_MS))
            .catch(() => {});
        return saveChainRef.current;
    };

    const serialize = (): string => {
        flushActiveSheet();
        flushActiveCharts?.();
        flushActiveConditionalFormats?.();
        flushActiveTableRegions?.();
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
            const sheetTables = sheetsTableRegionsRef?.current[i];
            return {
                name: sheetNamesRef.current[i] ?? `Sheet ${i + 1}`,
                color,
                cells,
                colWidths: colWidthsObj,
                rowHeights: rowHeightsObj,
                charts: sheetCharts && sheetCharts.length > 0 ? sheetCharts : undefined,
                conditionalFormats: sheetCF && sheetCF.length > 0 ? sheetCF : undefined,
                tables: sheetTables && sheetTables.length > 0 ? sheetTables : undefined,
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
        flushActiveTableRegions?.();
        const wb = XLSX.utils.book_new();
        sheetNamesRef.current.forEach((name, i) => {
            XLSX.utils.book_append_sheet(wb, buildXlsxWorksheet(sheetsDataRef.current[i]), name || `Sheet${i + 1}`);
        });
        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
        return new Uint8Array(buf);
    };

    const save = async ({ keepalive = false }: SaveOptions = {}) => {
        const transport = { signal: abortAfter(SAVE_DEADLINE_MS), keepalive };
        // Checked before the office branch, not after: office-mode bytes are
        // encrypted too. They used not to be, on the grounds that "downloading
        // the raw file must open in real Excel" (issue #43, criterion 3) — but
        // Drive's download decrypts client-side, so the .xlsx that reaches the
        // user's disk is identical either way. What the plaintext write bought
        // was a readable spreadsheet in object storage: issue #95.
        if (!dekRef.current) {
            toast.warning(ENCRYPTION_WARNING_MESSAGE);
            return;
        }
        if (officeMode) {
            const meta = officeFileMetaRef.current;
            if (!meta) return;
            const bytes = buildXlsxBytes();
            try {
                await driveAutosaveEncryptedBytes(sheetId, bytes, meta.name, dekRef.current, transport);
            } catch {
                if (keepalive) throw new Error('save-failed-on-unload');
                await delay(SAVE_RETRY_DELAY_MS);
                await driveAutosaveEncryptedBytes(sheetId, bytes, meta.name, dekRef.current, transport);
            }
            return;
        }
        if (!sheetRef.current) return;
        const savedTitle = sheetRef.current.title;
        const content = serialize();
        // Retry once on failure: the autosave PUT has been observed to occasionally
        // fail with a transient transport-level error (e.g. a truncated request body)
        // when it follows closely after another request to the same endpoint. This
        // save is often the last chance to persist an edit before the user navigates
        // away, so silently swallowing a transient failure would lose real data.
        // The retry must not swallow a rejected save: a 409 is a decision for
        // the user, and retrying it would only fail again against the same
        // stale revision.
        //
        // It waits first. "Follows closely after another request" is the condition
        // that breaks these requests, and an immediate retry follows more closely
        // than anything — it reproduces the fault it is meant to recover from, and
        // the retry has been seen to hang outright rather than fail.
        let saved;
        try {
            saved = await driveAutosaveEncryptedContent(
                sheetId, content, 'sheet.json', dekRef.current, versionGuard.check(), transport,
            );
        } catch (err) {
            if (versionGuard.handleError(err)) {
                toast.warning(
                    'This spreadsheet changed elsewhere since you opened it. Reload to get ' +
                    'the latest version, or save again to keep your copy.',
                );
                return;
            }
            // Nothing to retry into on the unload path — this document is going
            // away, and the keepalive request above was the one chance to land.
            if (keepalive) throw err;
            await delay(SAVE_RETRY_DELAY_MS);
            saved = await driveAutosaveEncryptedContent(
                sheetId, content, 'sheet.json', dekRef.current, versionGuard.check(), transport,
            );
        }
        versionGuard.observe(saved.contentVersion);
        indexOnSave(currentUser?.id, {
            id: sheetId,
            type: 'spreadsheet',
            title: savedTitle,
            content: extractSheetText(content),
        });
    };
    saveRef.current = save;

    const manualSave = async () => {
        // No key, no write — for either shape of file. The plaintext fallback
        // this used to have wrote a readable version snapshot of an encrypted
        // spreadsheet, which is a file with no key ref and so no way back
        // (issue #95). The content is still in the editor, so unlocking and
        // pressing save again loses nothing.
        if (!dekRef.current) {
            toast.warning(ENCRYPTION_WARNING_MESSAGE);
            return;
        }
        if (officeMode) {
            const meta = officeFileMetaRef.current;
            if (!meta) return;
            const bytes = buildXlsxBytes();
            await driveCreateEncryptedVersionBytes(sheetId, bytes, meta.name, dekRef.current);
            return;
        }
        if (!sheetRef.current) return;
        await driveCreateEncryptedVersion(sheetId, serialize(), 'sheet.json', dekRef.current);
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
            // Fire and forget — chained so it can't overlap another save, and
            // `keepalive` so the browser still delivers it once this document is
            // gone. Every path into here is the user leaving: the tab hidden,
            // the page unloading, or the editor unmounting under a navigation
            // that may well be a full document load. Without it the request is
            // torn down mid-flight and the edit is silently lost.
            queueSave({ keepalive: true });
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
                const stored = new Uint8Array(await blob.arrayBuffer());
                // Office-mode saves are encrypted now, so a file that already
                // has a key ref holds ciphertext. `isNewEncryption` separates
                // the two: it means the DEK was just minted for a file that had
                // none, so the stored bytes are still the plaintext .xlsx it
                // was uploaded as, and the first save is what encrypts it.
                const plain = dekRef.current && !isNewEncryption
                    ? decryptFile(stored, dekRef.current)
                    : stored;
                const arrayBuffer = plain.buffer.slice(
                    plain.byteOffset, plain.byteOffset + plain.byteLength,
                ) as ArrayBuffer;
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
        versionGuard.observe(sheet.contentVersion);
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
                // Restore table regions if the hook is wired up.
                if (sheetsTableRegionsRef && setTableRegions) {
                    const extraTableRegions = sheetsTableRegionsRef.current.slice(allData.length);
                    sheetsTableRegionsRef.current = [
                        ...rawSheets.map(s => s.tables ?? []),
                        ...extraTableRegions,
                    ];
                    setTableRegions(sheetsTableRegionsRef.current[0] ?? []);
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
        // (seeded as plaintext by POST /api/v1/drive/files on creation); for existing
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
            // Both branches land on the same Drive rename endpoint; they differ
            // only in the local state they keep in step — office mode tracks the
            // raw file's metadata, native mode the loaded sheet.
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
        /**
         * Queued, not the raw `save`. Callers outside this hook — the back
         * button, the CSV/XLSX imports, the template apply — were the one path
         * that could still put two autosave PUTs on the wire at once, which is
         * exactly what the chain was built to prevent.
         */
        save: queueSave,
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
