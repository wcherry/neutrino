'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sheetsApi, driveReadContent } from '@/lib/api';
import type { SheetEmbedAttrsShape, CellValue } from '@neutrino/sheet-embed';
import type { SheetFile, CellProps } from '../../sheets/editor/types';
import { computeCell, type SheetRef } from '../../sheets/editor/formula';
import styles from './page.module.css';

const PREVIEW_ROWS = 50;
const PREVIEW_COLS = 26;

interface Sel { row: number; col: number; }

interface Props {
  onInsert: (attrs: SheetEmbedAttrsShape) => void;
  onClose: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function colToLetter(col: number): string {
  let result = '';
  let n = col + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    result = String.fromCharCode(65 + r) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function selToRange(start: Sel, end: Sel): string {
  const r1 = Math.min(start.row, end.row);
  const c1 = Math.min(start.col, end.col);
  const r2 = Math.max(start.row, end.row);
  const c2 = Math.max(start.col, end.col);
  return `${colToLetter(c1)}${r1 + 1}:${colToLetter(c2)}${r2 + 1}`;
}

function parseRangeSel(range: string): { start: Sel; end: Sel } | null {
  const m = range.trim().match(/^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/);
  if (!m) return null;
  const colIdx = (s: string) =>
    s.toUpperCase().split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  const r1 = parseInt(m[2], 10) - 1;
  const c1 = colIdx(m[1]);
  const r2 = parseInt(m[4], 10) - 1;
  const c2 = colIdx(m[3]);
  if (r1 < 0 || r2 < r1 || c1 < 0 || c2 < c1) return null;
  return { start: { row: r1, col: c1 }, end: { row: r2, col: c2 } };
}

function parseRangeBounds(range: string) {
  const sel = parseRangeSel(range);
  if (!sel) return null;
  return { startRow: sel.start.row, startCol: sel.start.col, endRow: sel.end.row, endCol: sel.end.col };
}

// Build an evaluated cell map from SheetFile data (same two-pass logic as usePersistence).
function evaluateSheetFile(file: SheetFile): Map<string, CellProps>[] {
  const fileSheets = file.sheets ?? [];
  const rawMaps = fileSheets.map(s =>
    new Map(Object.values(s.cells).map(c => [
      c.id,
      { id: c.id, raw: c.raw, value: c.value, edit: false, cellStyle: c.cellStyle } as CellProps,
    ]))
  );
  const sheetRefs: SheetRef[] = fileSheets.map((s, i) => ({
    name: s.name ?? `Sheet ${i + 1}`,
    data: rawMaps[i],
  }));
  return rawMaps.map((rawMap, i) =>
    new Map([...rawMap.values()].map(c => {
      const { value, deps } = computeCell(c.raw || '', rawMap, sheetRefs.filter((_, j) => j !== i));
      return [c.id, { ...c, value, deps } as CellProps];
    }))
  );
}

// Build a 2-D grid of display values from an evaluated sheet map.
function buildGrid(dataMap: Map<string, CellProps>, numRows: number, numCols: number): (string | null)[][] {
  return Array.from({ length: numRows }, (_, r) =>
    Array.from({ length: numCols }, (_, c) => {
      const cell = dataMap.get(`${colToLetter(c)}${r + 1}`);
      return (cell?.value !== undefined && cell.value !== '') ? (cell.value ?? null) : null;
    })
  );
}

// Extract cachedData for a selection (same as doc paste: cell.value ?? null).
function extractCachedData(
  dataMap: Map<string, CellProps>,
  start: Sel,
  end: Sel,
): CellValue[][] {
  const r1 = Math.min(start.row, end.row);
  const c1 = Math.min(start.col, end.col);
  const r2 = Math.max(start.row, end.row);
  const c2 = Math.max(start.col, end.col);
  return Array.from({ length: r2 - r1 + 1 }, (_, dr) =>
    Array.from({ length: c2 - c1 + 1 }, (_, dc) => {
      const cell = dataMap.get(`${colToLetter(c1 + dc)}${r1 + dr + 1}`);
      return (cell?.value !== undefined && cell.value !== '') ? (cell.value ?? null) : null;
    })
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function InsertSheetDialog({ onInsert, onClose }: Props) {
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  const [selectedSheetTitle, setSelectedSheetTitle] = useState('');
  const [rangeInput, setRangeInput] = useState('');
  // Evaluated sheet data (all tabs), same logic as doc paste clipboard path
  const [sheetsMapData, setSheetsMapData] = useState<Map<string, CellProps>[]>([]);
  const [previewGrid, setPreviewGrid] = useState<(string | null)[][] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Drag selection
  const [dragSel, setDragSel] = useState<{ start: Sel; end: Sel } | null>(null);
  const isDragging = useRef(false);
  // Insert
  const [insertError, setInsertError] = useState<string | null>(null);
  const [inserting, setInserting] = useState(false);

  const { data: sheetsData, isLoading: sheetsLoading } = useQuery({
    queryKey: ['sheets'],
    queryFn: () => sheetsApi.listSheets(),
    staleTime: 30_000,
  });

  // Load the sheet content and evaluate formulas — same two-pass logic as
  // usePersistence and the doc paste clipboard path (cell.value, not raw formula).
  useEffect(() => {
    if (!selectedSheetId) {
      setPreviewGrid(null);
      setSheetsMapData([]);
      return;
    }
    setPreviewGrid(null);
    setSheetsMapData([]);
    setPreviewLoading(true);
    setDragSel(null);
    setRangeInput('');

    const aborted = { value: false };
    (async () => {
      try {
        const sheet = await sheetsApi.getSheet(selectedSheetId);
        const raw = await driveReadContent(sheet.contentUrl);
        const file = JSON.parse(raw) as SheetFile;
        const evaluated = evaluateSheetFile(file);
        if (aborted.value) return;
        setSheetsMapData(evaluated);
        const grid = buildGrid(evaluated[0] ?? new Map(), PREVIEW_ROWS, PREVIEW_COLS);
        setPreviewGrid(grid);
      } catch {
        if (!aborted.value) setPreviewGrid([]);
      } finally {
        if (!aborted.value) setPreviewLoading(false);
      }
    })();

    return () => { aborted.value = true; };
  }, [selectedSheetId]);

  // Global mouseup commits the drag selection into the range input.
  useEffect(() => {
    function onMouseUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      setDragSel(prev => {
        if (prev) setRangeInput(selToRange(prev.start, prev.end));
        return prev;
      });
    }
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, []);

  function isCellSelected(row: number, col: number): boolean {
    const sel = dragSel ?? parseRangeSel(rangeInput);
    if (!sel) return false;
    const r1 = Math.min(sel.start.row, sel.end.row);
    const c1 = Math.min(sel.start.col, sel.end.col);
    const r2 = Math.max(sel.start.row, sel.end.row);
    const c2 = Math.max(sel.start.col, sel.end.col);
    return row >= r1 && row <= r2 && col >= c1 && col <= c2;
  }

  async function handleInsert() {
    if (!selectedSheetId) { setInsertError('Select a sheet first.'); return; }
    const bounds = rangeInput.trim()
      ? parseRangeBounds(rangeInput.trim())
      : { startRow: 0, startCol: 0, endRow: 499, endCol: 25 };
    if (!bounds) { setInsertError('Invalid range. Use a format like A1:D10.'); return; }

    setInsertError(null);
    setInserting(true);
    try {
      const namedRange = await sheetsApi.createNamedRange(selectedSheetId, {
        sheetDbId: selectedSheetId,
        ...bounds,
      });

      // Build cachedData from frontend-evaluated values (same as doc paste path).
      const dataMap = sheetsMapData[0];
      const sel = rangeInput.trim() ? parseRangeSel(rangeInput.trim()) : null;
      const cachedData: CellValue[][] | null = (dataMap && sel)
        ? extractCachedData(dataMap, sel.start, sel.end)
        : null;

      onInsert({
        spreadsheetId: selectedSheetId,
        sheetId: namedRange.sheetId,
        namedRangeId: namedRange.id,
        cachedData,
        cachedAt: cachedData ? new Date().toISOString() : null,
        title: selectedSheetTitle || null,
      });
    } catch {
      setInsertError('Could not create embed. Check the spreadsheet and try again.');
    } finally {
      setInserting(false);
    }
  }

  // Trim preview to only show rows/cols that have data, plus a small buffer.
  const numRows = previewGrid
    ? Math.min(PREVIEW_ROWS, Math.max(10, previewGrid.findLastIndex(r => r.some(v => v !== null)) + 4))
    : 0;
  const numCols = previewGrid
    ? Math.min(PREVIEW_COLS, Math.max(5, Math.max(0, ...previewGrid.map(r => r.findLastIndex(v => v !== null))) + 3))
    : 0;

  return (
    <div className={styles.dialogOverlay} onClick={onClose}>
      <div className={styles.dialogBoxWide} onClick={(e) => e.stopPropagation()}>
        <div className={styles.dialogTitle}>Insert Sheet Embed</div>

        <div className={styles.sheetDialogLayout}>
          {/* Left: sheet list */}
          <div className={styles.sheetDialogLeft}>
            <div className={styles.sheetDialogLabel}>Your sheets</div>
            {sheetsLoading ? (
              <div className={styles.sheetDialogMuted}>Loading…</div>
            ) : (sheetsData?.sheets ?? []).length === 0 ? (
              <div className={styles.sheetDialogMuted}>No sheets found.</div>
            ) : (
              <div className={styles.sheetList}>
                {(sheetsData?.sheets ?? []).map((sheet) => (
                  <button
                    key={sheet.id}
                    className={`${styles.sheetListItem} ${selectedSheetId === sheet.id ? styles.sheetListItemActive : ''}`}
                    onClick={() => {
                      setSelectedSheetId(sheet.id);
                      setSelectedSheetTitle(sheet.title);
                      setInsertError(null);
                    }}
                  >
                    {sheet.title}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: range input + preview grid */}
          <div className={styles.sheetDialogRight}>
            <div className={styles.sheetDialogLabel}>Cell range</div>
            <input
              className={styles.dialogInput}
              type="text"
              placeholder="e.g. A1:D10 (leave blank for full sheet)"
              value={rangeInput}
              disabled={!selectedSheetId}
              onChange={(e) => { setRangeInput(e.target.value); setDragSel(null); setInsertError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && selectedSheetId) handleInsert();
                else if (e.key === 'Escape') onClose();
              }}
            />

            <div className={styles.sheetPreviewArea}>
              {!selectedSheetId ? (
                <div className={styles.sheetPreviewPlaceholder}>Select a sheet to preview</div>
              ) : previewLoading ? (
                <div className={styles.sheetPreviewPlaceholder}>Loading preview…</div>
              ) : previewGrid && previewGrid.length > 0 ? (
                <div className={styles.sheetPreviewTable}>
                  {/* Column headers */}
                  <div className={styles.sheetPreviewRow}>
                    <div className={styles.sheetPreviewCorner} />
                    {Array.from({ length: numCols }, (_, c) => (
                      <div key={c} className={styles.sheetPreviewColHeader}>{colToLetter(c)}</div>
                    ))}
                  </div>
                  {/* Data rows */}
                  {Array.from({ length: numRows }, (_, r) => (
                    <div key={r} className={styles.sheetPreviewRow}>
                      <div className={styles.sheetPreviewRowHeader}>{r + 1}</div>
                      {Array.from({ length: numCols }, (_, c) => (
                        <div
                          key={c}
                          className={`${styles.sheetPreviewCell} ${isCellSelected(r, c) ? styles.sheetPreviewCellSelected : ''}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            isDragging.current = true;
                            setDragSel({ start: { row: r, col: c }, end: { row: r, col: c } });
                          }}
                          onMouseEnter={() => {
                            if (!isDragging.current) return;
                            setDragSel(prev => prev ? { ...prev, end: { row: r, col: c } } : null);
                          }}
                        >
                          {previewGrid[r]?.[c] ?? ''}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : previewGrid ? (
                <div className={styles.sheetPreviewPlaceholder}>Sheet is empty</div>
              ) : (
                <div className={styles.sheetPreviewPlaceholder}>Preview unavailable</div>
              )}
            </div>

            {insertError && <p className={styles.sheetDialogError}>{insertError}</p>}
          </div>
        </div>

        <div className={styles.dialogActions}>
          <button className={styles.dialogCancelBtn} onClick={onClose}>Cancel</button>
          <button
            className={styles.dialogConfirmBtn}
            disabled={!selectedSheetId || inserting}
            onClick={handleInsert}
          >
            {inserting ? 'Inserting…' : 'Insert'}
          </button>
        </div>
      </div>
    </div>
  );
}
