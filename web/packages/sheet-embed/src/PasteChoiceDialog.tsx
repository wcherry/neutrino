'use client';

import React from 'react';
import type { CellValue } from './types';

// ---------------------------------------------------------------------------
// PasteChoiceDialog
//
// Small modal shown when the user pastes a Sheets selection into a Docs or
// Slides document. Offers two choices:
//   - "Paste as table"    — insert static HTML table from previewData
//   - "Paste as live view" — call onPasteAsEmbed() to create a named range
//                            and insert a live embed block
// ---------------------------------------------------------------------------

export interface PasteChoiceDialogProps {
  /** Preview data from the clipboard — shown as a mini table in the dialog. */
  previewData: CellValue[][];
  /** Called when the user chooses "Paste as table". */
  onPasteAsTable: () => void;
  /** Called when the user chooses "Paste as live view". */
  onPasteAsEmbed: () => void;
  /** Called when the user dismisses the dialog without choosing. */
  onClose: () => void;
}

export function PasteChoiceDialog({
  previewData,
  onPasteAsTable,
  onPasteAsEmbed,
  onClose,
}: PasteChoiceDialogProps) {
  return (
    <div style={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Paste from Sheets" data-testid="paste-choice-dialog">
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Paste from Sheets</div>

        {/* Preview mini-table */}
        {previewData.length > 0 && (
          <div style={styles.preview}>
            <table style={styles.previewTable}>
              <tbody>
                {previewData.slice(0, 5).map((row, ri) => (
                  <tr key={ri}>
                    {row.slice(0, 6).map((cell, ci) => (
                      <td key={ci} style={styles.previewCell}>
                        {cell !== null && cell !== undefined ? String(cell) : ''}
                      </td>
                    ))}
                    {row.length > 6 && (
                      <td style={{ ...styles.previewCell, color: 'var(--color-text-secondary, #999)' }}>
                        …
                      </td>
                    )}
                  </tr>
                ))}
                {previewData.length > 5 && (
                  <tr>
                    <td
                      colSpan={Math.min(previewData[0]?.length ?? 1, 7)}
                      style={{ ...styles.previewCell, textAlign: 'center', color: 'var(--color-text-secondary, #999)' }}
                    >
                      {previewData.length - 5} more row{previewData.length - 5 !== 1 ? 's' : ''}…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div style={styles.actions}>
          <button
            style={styles.btn}
            onClick={() => { onPasteAsTable(); onClose(); }}
            data-testid="paste-as-table-btn"
          >
            Paste as table
          </button>
          <button
            style={{ ...styles.btn, ...styles.btnPrimary }}
            onClick={() => { onPasteAsEmbed(); onClose(); }}
            data-testid="paste-as-live-btn"
          >
            Paste as live view
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  dialog: {
    background: 'var(--color-surface, #fff)',
    borderRadius: 8,
    padding: '20px 24px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
    minWidth: 320,
    maxWidth: 480,
    width: '90vw',
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--color-text, #111)',
    marginBottom: 14,
  },
  preview: {
    overflowX: 'auto',
    marginBottom: 16,
    border: '1px solid var(--color-border, #e0e0e0)',
    borderRadius: 4,
  },
  previewTable: {
    borderCollapse: 'collapse',
    width: '100%',
    fontSize: 12,
  },
  previewCell: {
    border: '1px solid var(--color-border, #e0e0e0)',
    padding: '3px 7px',
    whiteSpace: 'nowrap',
    maxWidth: 120,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color: 'var(--color-text, #333)',
  },
  actions: {
    display: 'flex',
    gap: 10,
    justifyContent: 'flex-end',
  },
  btn: {
    fontSize: 13,
    padding: '7px 16px',
    borderRadius: 5,
    border: '1px solid var(--color-border, #ccc)',
    background: 'var(--color-surface-raised, #f5f5f5)',
    cursor: 'pointer',
    color: 'var(--color-text, #333)',
  },
  btnPrimary: {
    background: '#1a73e8',
    borderColor: '#1a73e8',
    color: '#fff',
  },
};
