'use client';

import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Plus, Minus } from 'lucide-react';
import type { NoteMetaResponse } from '@/lib/api';
import type { TableBlockProps, TableData, TableStyle } from './blockEditorTypes';
import { TABLE_PRESETS, TABLE_STRUCTURE_OPTIONS } from './blockEditorConstants';
import { genId, renderInline } from './blockEditorHelpers';
import styles from './BlockEditor.module.css';

export default function TableBlock({ block, onTableChange, onDeleteTable, allNotes, onLinkClick }: TableBlockProps) {
  const [localData, setLocalData] = useState<TableData>(() => block.tableData!);
  const [editingCell, setEditingCell] = useState<{ rowId: string; cellId: string } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number; rowIndex: number | null; colIndex: number | null;
  } | null>(null);
  const [styleDialogOpen, setStyleDialogOpen] = useState(false);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const dragColRef = useRef<TableData | null>(null);
  const dragRowRef = useRef<TableData | null>(null);

  function commit(next: TableData) {
    setLocalData(next);
    onTableChange({ tableData: next });
  }

  function handleCellChange(rowId: string, cellId: string, content: string) {
    const next = {
      ...localData,
      rows: localData.rows.map((row) =>
        row.id === rowId
          ? { ...row, cells: row.cells.map((c) => (c.id === cellId ? { ...c, content } : c)) }
          : row
      ),
    };
    commit(next);
  }

  function handleColResizeMouseDown(colIndex: number, e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = localData.columns[colIndex].width;
    dragColRef.current = localData;

    function onMouseMove(ev: MouseEvent) {
      const newWidth = Math.max(60, startWidth + ev.clientX - startX);
      dragColRef.current = {
        ...dragColRef.current!,
        columns: dragColRef.current!.columns.map((col, i) =>
          i === colIndex ? { ...col, width: newWidth } : col
        ),
      };
      setLocalData({ ...dragColRef.current });
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (dragColRef.current) {
        onTableChange({ tableData: dragColRef.current });
        dragColRef.current = null;
      }
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function handleRowResizeMouseDown(rowIndex: number, e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = localData.rows[rowIndex].height ?? 36;
    dragRowRef.current = localData;

    function onMouseMove(ev: MouseEvent) {
      const newHeight = Math.max(28, startHeight + ev.clientY - startY);
      dragRowRef.current = {
        ...dragRowRef.current!,
        rows: dragRowRef.current!.rows.map((row, i) =>
          i === rowIndex ? { ...row, height: newHeight } : row
        ),
      };
      setLocalData({ ...dragRowRef.current });
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (dragRowRef.current) {
        onTableChange({ tableData: dragRowRef.current });
        dragRowRef.current = null;
      }
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function addRow() {
    const next = {
      ...localData,
      rows: [
        ...localData.rows,
        { id: genId(), cells: localData.columns.map(() => ({ id: genId(), content: '' })) },
      ],
    };
    commit(next);
  }

  function addColumn() {
    const next = {
      ...localData,
      columns: [...localData.columns, { id: genId(), width: 160 }],
      rows: localData.rows.map((row) => ({
        ...row,
        cells: [...row.cells, { id: genId(), content: '' }],
      })),
    };
    commit(next);
  }

  function removeRow(rowIndex: number) {
    if (localData.rows.length <= 1) return;
    commit({ ...localData, rows: localData.rows.filter((_, i) => i !== rowIndex) });
  }

  function removeColumn(colIndex: number) {
    if (localData.columns.length <= 1) return;
    commit({
      ...localData,
      columns: localData.columns.filter((_, i) => i !== colIndex),
      rows: localData.rows.map((row) => ({
        ...row,
        cells: row.cells.filter((_, i) => i !== colIndex),
      })),
    });
  }

  function toggleStyle(key: keyof TableStyle) {
    commit({ ...localData, style: { ...localData.style, [key]: !localData.style?.[key] } });
  }

  function selectPreset(id: string) {
    commit({ ...localData, style: { ...localData.style, preset: id || undefined } });
  }

  function insertRowAt(rowIndex: number, offset: 0 | 1) {
    const newRow = { id: genId(), cells: localData.columns.map(() => ({ id: genId(), content: '' })) };
    const rows = [...localData.rows];
    rows.splice(rowIndex + offset, 0, newRow);
    commit({ ...localData, rows });
  }

  function insertColumnAt(colIndex: number, offset: 0 | 1) {
    const cols = [...localData.columns];
    cols.splice(colIndex + offset, 0, { id: genId(), width: 160 });
    const rows = localData.rows.map((row) => {
      const cells = [...row.cells];
      cells.splice(colIndex + offset, 0, { id: genId(), content: '' });
      return { ...row, cells };
    });
    commit({ ...localData, columns: cols, rows });
  }

  function openCtxMenu(e: React.MouseEvent, rowIndex: number | null, colIndex: number | null) {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, rowIndex, colIndex });
  }

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    function handleDown(e: MouseEvent) {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    }
    document.addEventListener('mousedown', handleDown);
    return () => document.removeEventListener('mousedown', handleDown);
  }, [ctxMenu]);

  const st = localData.style;
  const numRows = localData.rows.length;
  const numCols = localData.columns.length;

  function getCellClasses(ri: number, ci: number): string {
    const isHeader = (st?.headerRow && ri === 0) || (st?.headerColumn && ci === 0);
    const isSummary = (st?.summaryRow && ri === numRows - 1) || (st?.summaryColumn && ci === numCols - 1);
    const isBanded = st?.bandedRows && ri % 2 === 1 && !isHeader;
    return [
      styles.tableCell,
      isSummary ? styles.tableCellSummary : isHeader ? styles.tableCellHeader : isBanded ? styles.tableCellBanded : '',
    ].filter(Boolean).join(' ');
  }

  function getCellStyle(ri: number, ci: number): React.CSSProperties {
    if (!st?.preset) return {};
    const preset = TABLE_PRESETS.find((p) => p.id === st!.preset);
    if (!preset) return {};
    const isHeader = (st?.headerRow && ri === 0) || (st?.headerColumn && ci === 0);
    const isSummary = (st?.summaryRow && ri === numRows - 1) || (st?.summaryColumn && ci === numCols - 1);
    const isBanded = st?.bandedRows && ri % 2 === 1 && !isHeader;
    if (isSummary) return { background: preset.summaryBg, color: preset.summaryColor };
    if (isHeader)  return { background: preset.headerBg,  color: preset.headerColor };
    if (isBanded)  return { background: preset.bandBg };
    return {};
  }

  const presetPicker = (
    <>
      <div className={styles.tablePresetPicker}>
        <button
          className={`${styles.tablePresetSwatch} ${!st?.preset ? styles.tablePresetSwatchActive : ''}`}
          onClick={() => selectPreset('')}
          title="None"
          type="button"
        >
          <span className={styles.tablePresetNoneLabel}>—</span>
        </button>
        {TABLE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            className={`${styles.tablePresetSwatch} ${st?.preset === preset.id ? styles.tablePresetSwatchActive : ''}`}
            onClick={() => selectPreset(preset.id)}
            title={preset.name}
            type="button"
            style={{ background: `linear-gradient(to bottom, ${preset.headerBg} 40%, ${preset.bandBg} 40%)` }}
          />
        ))}
      </div>
      <div className={styles.tableStructureToggles}>
        {TABLE_STRUCTURE_OPTIONS.map(({ key, label }) => (
          <label key={key} className={styles.tableStructureLabel}>
            <input type="checkbox" checked={!!st?.[key]} onChange={() => toggleStyle(key)} />
            {label}
          </label>
        ))}
      </div>
    </>
  );

  return (
    <div
      className={styles.tableWrapper}
      onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, rowIndex: null, colIndex: null }); }}
    >
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <colgroup>
            {/* Left column: row delete anchor (thin) */}
            <col style={{ width: 8, minWidth: 8 }} />
            {localData.columns.map((col) => (
              <col key={col.id} style={{ width: col.width, minWidth: col.width }} />
            ))}
            {/* Right column: add column anchor (thin) */}
            <col style={{ width: 8, minWidth: 8 }} />
          </colgroup>
          <thead>
            <tr className={styles.tableControlRow}>
              {/* Corner */}
              <th />
              {localData.columns.map((col, ci) => (
                <th key={col.id} className={styles.tableControlCell}>
                  {numCols > 1 && (
                    <button
                      className={styles.tableDeleteColBtn}
                      onClick={() => removeColumn(ci)}
                      title="Delete column"
                      type="button"
                    >
                      <Minus size={10} strokeWidth={2.5} />
                    </button>
                  )}
                </th>
              ))}
              {/* Corner */}
              <th />
            </tr>
          </thead>
          <tbody>
            {localData.rows.map((row, ri) => (
              <tr
                key={row.id}
                style={row.height ? { height: row.height } : undefined}
                className={styles.tableRow}
              >
                {/* Row delete anchor (left) */}
                <td className={styles.tableDeleteRowCell}>
                  {numRows > 1 && (
                    <button
                      className={styles.tableDeleteRowBtn}
                      onClick={() => removeRow(ri)}
                      title="Delete row"
                      type="button"
                    >
                      <Minus size={10} strokeWidth={2.5} />
                    </button>
                  )}
                </td>
                {row.cells.map((cell, ci) => {
                  const isEditing =
                    editingCell?.rowId === row.id && editingCell?.cellId === cell.id;
                  return (
                    <td
                      key={cell.id}
                      className={getCellClasses(ri, ci)}
                      style={getCellStyle(ri, ci)}
                      onContextMenu={(e) => openCtxMenu(e, ri, ci)}
                    >
                      {isEditing ? (
                        <textarea
                          className={styles.tableCellInput}
                          value={cell.content}
                          onChange={(e) => handleCellChange(row.id, cell.id, e.target.value)}
                          onBlur={() => setEditingCell(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') { e.currentTarget.blur(); }
                            if (e.key === 'Tab') {
                              e.preventDefault();
                              const nextCi = ci + 1;
                              const nextRi = nextCi >= numCols ? ri + 1 : ri;
                              const normCi = nextCi >= numCols ? 0 : nextCi;
                              const nextRow = localData.rows[nextRi];
                              if (nextRow) setEditingCell({ rowId: nextRow.id, cellId: nextRow.cells[normCi].id });
                              else setEditingCell(null);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <div
                          className={styles.tableCellView}
                          onClick={() => setEditingCell({ rowId: row.id, cellId: cell.id })}
                        >
                          {cell.content ? renderInline(cell.content, allNotes, onLinkClick) : null}
                        </div>
                      )}
                      {/* Column resize handle */}
                      <div
                        className={styles.colResizeHandle}
                        onMouseDown={(e) => handleColResizeMouseDown(ci, e)}
                      />
                      {/* Row resize handle (only on last data column) */}
                      {ci === numCols - 1 && (
                        <div
                          className={styles.rowResizeHandle}
                          onMouseDown={(e) => handleRowResizeMouseDown(ri, e)}
                        />
                      )}
                    </td>
                  );
                })}
                {/* Add column anchor — rowSpan spans all data rows so button centers vertically */}
                {ri === 0 && (
                  <td rowSpan={numRows} className={styles.tableAddColCell}>
                    <button
                      className={styles.tableAddColBtn}
                      onClick={addColumn}
                      title="Add column"
                      type="button"
                    >
                      <Plus size={10} strokeWidth={2.5} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {/* Add row anchor */}
            <tr className={styles.tableAddRowRow}>
              <td />
              <td colSpan={numCols} className={styles.tableAddRowCell}>
                <button
                  className={styles.tableAddRowBtn}
                  onClick={addRow}
                  title="Add row"
                  type="button"
                >
                  <Plus size={10} strokeWidth={2.5} />
                </button>
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {/* Context menu */}
      {ctxMenu && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          ref={ctxMenuRef}
          className={styles.tableCtxMenu}
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            className={styles.tableCtxItem}
            type="button"
            disabled={ctxMenu.rowIndex === null}
            onClick={() => { if (ctxMenu.rowIndex !== null) insertRowAt(ctxMenu.rowIndex, 0); setCtxMenu(null); }}
          >Insert Row Above</button>
          <button
            className={styles.tableCtxItem}
            type="button"
            disabled={ctxMenu.rowIndex === null}
            onClick={() => { if (ctxMenu.rowIndex !== null) insertRowAt(ctxMenu.rowIndex, 1); setCtxMenu(null); }}
          >Insert Row Below</button>
          <button
            className={styles.tableCtxItem}
            type="button"
            disabled={ctxMenu.colIndex === null}
            onClick={() => { if (ctxMenu.colIndex !== null) insertColumnAt(ctxMenu.colIndex, 0); setCtxMenu(null); }}
          >Insert Column Left</button>
          <button
            className={styles.tableCtxItem}
            type="button"
            disabled={ctxMenu.colIndex === null}
            onClick={() => { if (ctxMenu.colIndex !== null) insertColumnAt(ctxMenu.colIndex, 1); setCtxMenu(null); }}
          >Insert Column Right</button>
          <div className={styles.tableCtxDivider} />
          <button
            className={styles.tableCtxItem}
            type="button"
            disabled={ctxMenu.rowIndex === null || numRows <= 1}
            onClick={() => { if (ctxMenu.rowIndex !== null) removeRow(ctxMenu.rowIndex); setCtxMenu(null); }}
          >Delete Row</button>
          <button
            className={styles.tableCtxItem}
            type="button"
            disabled={ctxMenu.colIndex === null || numCols <= 1}
            onClick={() => { if (ctxMenu.colIndex !== null) removeColumn(ctxMenu.colIndex); setCtxMenu(null); }}
          >Delete Column</button>
          <button
            className={styles.tableCtxItem}
            type="button"
            onClick={() => { onDeleteTable(); setCtxMenu(null); }}
          >Delete Table</button>
          <div className={styles.tableCtxDivider} />
          <button
            className={`${styles.tableCtxItem} ${styles.tableCtxItemStyle}`}
            type="button"
            onClick={() => { setStyleDialogOpen(true); setCtxMenu(null); }}
          >Style…</button>
        </div>,
        document.body
      )}

      {/* Style dialog */}
      {styleDialogOpen && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div className={styles.tableStyleOverlay} onMouseDown={() => setStyleDialogOpen(false)}>
          <div
            className={styles.tableStyleDialog}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className={styles.tableStyleDialogHeader}>
              <span className={styles.tableStyleDialogTitle}>Table Style</span>
              <button
                className={styles.tableStyleDialogClose}
                type="button"
                onClick={() => setStyleDialogOpen(false)}
              >✕</button>
            </div>
            {presetPicker}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
