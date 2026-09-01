'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import * as XLSX from 'xlsx';
import type { CellProps, SheetFile, CFRule, TableRegion } from '../types';
import type { ChartDef } from '../charts/chartTypes';
import {
    sheetsApi, driveReadContent, driveReadBytes, driveCreateEncryptedVersion, driveAutosaveEncryptedContent,
    driveAutosaveEncryptedBytes, driveCreateEncryptedVersionBytes, extractSheetText,
    storageApi, filesystemApi, ApiClientError, type SheetResponse, type FileItem,
} from '@/lib/api';
import { decryptFile } from '@neutrino/e2e-crypto';
import { readStoredBody } from '@/lib/storedBody';
import { useUser } from '@neutrino/auth';
import { indexOnSave } from '@/lib/searchIndexUpdate';
import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import { useToast } from '@neutrino/ui';
import { ENCRYPTION_WARNING_MESSAGE } from '@/components/EncryptionWarningMessage';
import type { SheetRef } from '../formula';
import { numToAlpha } from '../utils';
import { buildXlsxWorksheet } from './useExport';
import { buildRawSheetMap, evaluateSheetMap } from './sheetFileUtils';
import { officeAppForFile, withOoxmlExtension, stripOoxmlExtension } from '@/lib/officeFormats';
import { packNeutrinoModel, readNeutrinoModel } from '@/lib/ooxmlContainer';
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

/** The four bytes every zip — and so every `.xlsx` — opens with. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function looksLikeWorkbook(bytes: Uint8Array): boolean {
    return bytes.byteLength >= ZIP_MAGIC.length && ZIP_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * The stored bytes of an `.xlsx`, decrypted when they need it.
 *
 * Which of the two they are is read off the bytes, the same rule
 * `readStoredBody` follows for the JSON format and for the same reason. This
 * used to ask `isNewEncryption` — "this session minted the key, so what is
 * stored must still be plaintext" — which reads the session rather than the
 * file and is wrong at both ends: a workbook created and then reopened before
 * the sealing save landed has a key ref and a plaintext body, and a load that
 * runs while the key is still being minted has the flag not yet set for a body
 * that is already ciphertext. A workbook is a zip, and ciphertext opening with
 * the zip magic is a 1-in-2^32 accident.
 */
function readStoredWorkbook(stored: Uint8Array, dek: Uint8Array | null): Uint8Array {
    if (stored.byteLength === 0 || !dek || looksLikeWorkbook(stored)) return stored;
    return decryptFile(stored, dek);
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
}) {
    const sheetRef = useRef<SheetResponse | null>(null);
    // `awaitDek`, not `dekRef` — the rule docs, slides, notes and drawing
    // already follow. `dekResolved` means the resolution *attempt* finished,
    // and for a spreadsheet created a moment ago the key is still being minted
    // when the editor's load effect first fires; sampling the ref there reports
    // "no key" for a file that is about to have one, and every save made in
    // that window warned the user their changes were not saved (issue #157).
    const { dekResolved, awaitDek } = useEncryptedDocumentContent({ id: sheetId, filename: 'sheet.json' });
    const toast = useToast();
    // Rejects a save that would overwrite a revision written elsewhere since
    // this spreadsheet was loaded. See `useContentVersionGuard`.
    const versionGuard = useContentVersionGuard();
    const currentUser = useUser();
    const [title, setTitle] = useState('Untitled');
    const [yourRole, setYourRole] = useState<string>('owner');
    // ── OOXML mode (issue #127) ──────────────────────────────────────────────
    // True when this file is an `.xlsx` — which every spreadsheet created since
    // #127 is, as well as any workbook uploaded to Drive. False only for a
    // spreadsheet still in the bespoke JSON that predates it. Named `officeMode`
    // because that is what it was when only uploads took this path.
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

    /**
     * The bytes an `.xlsx` spreadsheet is stored as: a real Excel workbook with
     * this editor's own model packed in beside it (issue #127).
     *
     * Both halves are needed. `buildXlsxWorksheet` writes `{v, t}` per cell and
     * `!ref`, and nothing else — no column widths, no merges, no cell fills, no
     * sheet colours, no conditional formats, no charts — so a save that wrote
     * only the workbook would delete all of that on every autosave tick. Some
     * of that is ours to fix (`!cols` and `!merges` are things SheetJS would
     * write if we set them); styles and charts the community build cannot write
     * at all. Neither is a limit of `.xlsx` itself. Until then: the workbook is
     * what Excel reads, the model is what this editor reads back. See
     * `lib/ooxmlContainer.ts`.
     */
    const buildXlsxBytes = async (): Promise<Uint8Array> => {
        const model = serialize();
        const wb = XLSX.utils.book_new();
        sheetNamesRef.current.forEach((name, i) => {
            XLSX.utils.book_append_sheet(wb, buildXlsxWorksheet(sheetsDataRef.current[i]), name || `Sheet${i + 1}`);
        });
        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
        return packNeutrinoModel(new Uint8Array(buf), 'sheets', model);
    };

    const save = async ({ keepalive = false }: SaveOptions = {}) => {
        const transport = { signal: abortAfter(SAVE_DEADLINE_MS), keepalive };
        // Checked before the office branch, not after: office-mode bytes are
        // encrypted too. They used not to be, on the grounds that "downloading
        // the raw file must open in real Excel" (issue #43, criterion 3) — but
        // Drive's download decrypts client-side, so the .xlsx that reaches the
        // user's disk is identical either way. What the plaintext write bought
        // was a readable spreadsheet in object storage: issue #95.
        const dek = await awaitDek();
        if (!dek) {
            toast.warning(ENCRYPTION_WARNING_MESSAGE);
            return;
        }
        // The ref, not the `officeMode` state: `load()` writes it and then
        // saves in the same turn for a newly created spreadsheet, and a state
        // update is not visible to this closure until the next render — so
        // reading the state here would send that first save down the JSON path,
        // which bails on the missing `sheetRef` and writes nothing at all.
        const meta = officeFileMetaRef.current;
        if (meta) {
            const bytes = await buildXlsxBytes();
            let saved;
            try {
                saved = await driveAutosaveEncryptedBytes(
                    sheetId, bytes, meta.name, dek, versionGuard.check(), transport,
                );
            } catch (err) {
                // A 409 is a decision for the user, not a transport fault —
                // retrying only fails again against the same stale revision.
                if (versionGuard.handleError(err)) {
                    toast.warning(
                        'This spreadsheet changed elsewhere since you opened it. Reload to get ' +
                        'the latest version, or save again to keep your copy.',
                    );
                    return;
                }
                if (keepalive) throw new Error('save-failed-on-unload');
                await delay(SAVE_RETRY_DELAY_MS);
                saved = await driveAutosaveEncryptedBytes(
                    sheetId, bytes, meta.name, dek, versionGuard.check(), transport,
                );
            }
            versionGuard.observe(saved?.contentVersion);
            // Search runs against a client-side index, so a spreadsheet the
            // editor never announces is one the user cannot find. The JSON path
            // below has always done this; the OOXML path is the one every new
            // spreadsheet takes now, so it has to as well.
            indexOnSave(currentUser?.id, {
                id: sheetId,
                type: 'spreadsheet',
                title: stripOoxmlExtension(meta.name),
                content: extractSheetText(serialize()),
            });
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
                sheetId, content, 'sheet.json', dek, versionGuard.check(), transport,
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
                sheetId, content, 'sheet.json', dek, versionGuard.check(), transport,
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
        const dek = await awaitDek();
        if (!dek) {
            toast.warning(ENCRYPTION_WARNING_MESSAGE);
            return;
        }
        const meta = officeFileMetaRef.current;
        if (meta) {
            const bytes = await buildXlsxBytes();
            await driveCreateEncryptedVersionBytes(sheetId, bytes, meta.name, dek);
            return;
        }
        if (!sheetRef.current) return;
        await driveCreateEncryptedVersion(sheetId, serialize(), 'sheet.json', dek);
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
    // timedSave captures refs (dirtyRef, sheetRef) and awaitDek, none of which change identity,
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

    /**
     * Load a serialized `SheetFile` into the editor.
     *
     * Shared by both storage formats: it is the body of a bespoke-JSON
     * spreadsheet, and it is also the model packed inside an `.xlsx` (issue
     * #127). Throws on unparseable input, which both callers treat as "there is
     * nothing readable here" rather than as an empty spreadsheet to save over.
     */
    const applySheetFileJson = (raw: string): void => {
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
    };

    const runLoad = async () => {
        if (!sheetId) return;

        // Reset dirty so a reload (e.g. version restore) doesn't trigger the
        // colWidths/rowHeights save-on-change effect with stale unsaved state.
        dirtyRef.current = false;
        loadBlockedRef.current = false;

        // Waited for, not sampled: the editor fires this off `dekResolved`,
        // which is true while a brand-new spreadsheet's key is still being
        // minted. Reading the ref there reports "no key" and the whole load
        // then treats ciphertext as plaintext (issue #157).
        const dek = await awaitDek();
        let sheet: SheetResponse;
        try {
            sheet = await sheetsApi.getSheet(sheetId);
        } catch (err) {
            const is404 = err instanceof ApiClientError && err.statusCode === 404;
            if (!is404) throw err;
            // Not bespoke JSON — so an `.xlsx`, which is what every spreadsheet
            // created since #127 is. Fall back to the generic Drive file
            // metadata to tell that apart from a genuinely deleted or missing
            // spreadsheet.
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
            setTitle(stripOoxmlExtension(meta.name));
            setYourRole('owner');
            // Seed the stale-write guard from the revision this load saw, the
            // same thing the JSON branch does with `sheet.contentVersion`.
            versionGuard.observe(meta.contentVersion);
            try {
                // `driveReadBytes`, not `downloadFile`: a workbook created a
                // moment ago has no body, and the download endpoint answers
                // that with 409 `NO_CONTENT` rather than with the zero bytes
                // the empty branch below is written for.
                const stored = await driveReadBytes(sheetId);
                // Ciphertext, and no key to open it. The unlock gate is an
                // overlay rather than a hard gate, so this editor mounts while
                // the vault is still locked on every page load, and
                // `dekResolved` goes true with nothing resolved. Reading on
                // from here hands the ciphertext to the workbook parser, which
                // does not refuse it — SheetJS falls back to reading unknown
                // bytes as text and fills the grid with them (issue #157 in a
                // new place). Leave the spreadsheet untouched and unstarted;
                // `load()` reads again once the key lands.
                if (!dek && stored.byteLength > 0 && !looksLikeWorkbook(stored)) {
                    loadBlockedRef.current = true;
                    return;
                }
                // Saves are encrypted, so a file that already has a key ref
                // holds ciphertext — but one uploaded before this, or created
                // and not yet sealed, is still the plaintext workbook it
                // arrived as. Which it is comes off the bytes; no body at all
                // is neither, and decrypting that would report a new workbook
                // as an unreadable one.
                const plain = readStoredWorkbook(stored, dek);

                // A spreadsheet created here starts with no body at all: an
                // `.xlsx` is a zip, so the server writes no seed and the first
                // save below is what makes the file a real workbook. Reading
                // zero bytes as one would only raise "failed to open" on every
                // new spreadsheet.
                if (plain.byteLength === 0) {
                    setLoadCount(c => c + 1);
                    await queueSave();
                    return;
                }

                // The model packed into the workbook is the lossless copy; the
                // workbook itself is what Excel reads and what a file from
                // anywhere else arrives as. Preferring the model is what keeps
                // charts, conditional formats, column widths and cell styling
                // across a save — SheetJS carries none of them (issue #127).
                const model = await readNeutrinoModel(plain, 'sheets');
                if (model) {
                    applySheetFileJson(model);
                } else {
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
                }
                setLoadCount(c => c + 1);
            } catch {
                toast.error('Failed to open this file for editing');
            }
            return;
        }
        sheetRef.current = sheet;
        versionGuard.observe(sheet.contentVersion);
        setTitle(sheet.title);
        setYourRole(sheet.yourRole ?? 'owner');
        // True when the stored bytes read back as plaintext with a DEK in hand:
        // the default content written at sheet creation, or a spreadsheet saved
        // before E2EE. `readStoredBody` decides that from the bytes rather than
        // from `isNewEncryption`, which is blind to the case in the middle — a
        // sheet created and then reloaded before the sealing save landed keeps
        // its key ref and its plaintext body. Bytes that neither decrypt nor
        // look like plaintext throw out of here: that is ciphertext this key
        // cannot open, and it must not be overwritten.
        let serverHasPlaintextContent = false;
        // Set to true only when the try block completes without a download error.
        // Kept false on network failures so autosave never starts after a failed load.
        let loadOk = false;
        try {
            let raw: string;
            if (dek) {
                const blob = await storageApi.downloadFile(sheetId);
                const stored = new Uint8Array(await blob.arrayBuffer());
                const read = readStoredBody(stored, dek);
                raw = read.text;
                serverHasPlaintextContent = read.wasPlaintext;
            } else {
                raw = await driveReadContent(sheet.contentUrl);
            }
            applySheetFileJson(raw);
            loadOk = true;
        } catch {
            // empty sheet, start fresh — but do NOT start autosave if this was a
            // network/download failure; loadOk stays false and autosave is skipped
            // so we never overwrite existing server content with an empty file.
            //
            // With no key in hand it is also what a locked vault looks like: the
            // body read raw is ciphertext, which does not parse. Marked so the
            // load that follows the unlock reads it again rather than being
            // folded into this one.
            if (!dek) loadBlockedRef.current = true;
        }
        // Signal the autosave useEffect to (re-)start the interval with a fresh closure.
        // Guard: only start when content was successfully loaded OR when we know the
        // server holds plaintext content that needs to be encrypted (new file).
        if (loadOk || serverHasPlaintextContent) {
            setLoadCount(c => c + 1);
        }

        // Seal whatever the server is holding in the clear — the content seeded by
        // POST /api/v1/drive/files at creation, or a spreadsheet saved before E2EE.
        // For a sheet that is already ciphertext the read above decrypts and
        // serverHasPlaintextContent stays false, so this does not run.
        // Routed through queueSave (not called directly) so this request can
        // never overlap a save triggered moments later by a fast edit-then-navigate —
        // two autosave PUTs in flight at once have been observed to truncate the
        // second request's body in transit, which would silently drop the user's edit.
        if (serverHasPlaintextContent && dek) {
            await queueSave();
        }
    };

    /**
     * The load in flight, if any.
     *
     * The editor fires `load()` from an effect keyed on `dekResolved`, and for
     * a spreadsheet created a moment ago that flips true, back to false, and
     * true again as the key is minted — so the same file is asked for twice,
     * moments apart (issue #157). Handing the second caller the first one's
     * promise keeps its read from landing *after* the first one's opening save
     * and painting the blank workbook back over anything typed in between. A
     * later reload — a version restore — starts a fresh one, since nothing is
     * in flight by then.
     */
    const loadInFlightRef = useRef<Promise<void> | null>(null);

    /**
     * Set when a load stopped because the stored bytes need a key the session
     * did not have yet, and cleared by the load that replaces it.
     *
     * That load applied nothing, so deduplicating the next caller into it (see
     * `load`) would leave the spreadsheet permanently empty — the read that
     * *can* open the file never happening.
     */
    const loadBlockedRef = useRef(false);

    const startLoad = (): Promise<void> => {
        const inFlight = runLoad().finally(() => {
            if (loadInFlightRef.current === inFlight) loadInFlightRef.current = null;
        });
        loadInFlightRef.current = inFlight;
        return inFlight;
    };

    const load = (): Promise<void> => {
        const inFlight = loadInFlightRef.current;
        if (!inFlight) return startLoad();
        // A load is already running. Normally that *is* this load — but a load
        // that started before the vault unlocked reads bytes it cannot open and
        // applies nothing (see `loadBlockedRef`), and the caller arriving with
        // the key is the one that has to read them again. Chained rather than
        // concurrent: two reads of the same file racing each other is how the
        // blank workbook used to land on top of what was typed.
        return inFlight.catch(() => {}).then(() => {
            if (!loadBlockedRef.current) return;
            loadBlockedRef.current = false;
            return startLoad();
        });
    };

    const updateTitle = async (event: React.FocusEvent<HTMLElement>) => {
        const newTitle = (event.currentTarget as HTMLElement).innerHTML;
        setTitle(newTitle);
        if (officeMode) {
            // Both branches land on the same Drive rename endpoint; they differ
            // only in the local state they keep in step — the OOXML path tracks
            // the Drive file's metadata, the JSON one the loaded sheet.
            //
            // The extension goes back on: the title is what the user typed, and
            // the file still has to land on disk as a workbook Excel opens.
            const name = withOoxmlExtension(newTitle, 'sheets');
            if (officeFileMetaRef.current && name !== officeFileMetaRef.current.name) {
                officeFileMetaRef.current = { ...officeFileMetaRef.current, name };
                await filesystemApi.updateFile(sheetId, { name });
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
        /** True when this spreadsheet is stored as `.xlsx` rather than as JSON. */
        officeMode,
    };
}
