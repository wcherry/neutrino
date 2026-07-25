'use client';

import React from 'react';
import type { TableStyle } from '../styles/tableStyles';
import { computeTableStylePatches } from '../styles/applyTableStyle';
import styles from './TableStylePreviewSwatch.module.css';

interface TableStylePreviewSwatchProps {
    style: TableStyle;
}

const PREVIEW_COLS = ['A', 'B', 'C', 'D'];
const PREVIEW_ROWS = [1, 2, 3, 4];

/**
 * A small, pure/presentational 4x4 preview of a TableStyle preset, used by
 * TableStyleGalleryModal cards. Renders the *actual* computed patches (via
 * computeTableStylePatches) over a synthetic A1:D4 range so the preview
 * always matches the real applied output.
 */
export function TableStylePreviewSwatch({ style }: TableStylePreviewSwatchProps): JSX.Element {
    const cells = new Set<string>();
    for (const row of PREVIEW_ROWS) {
        for (const col of PREVIEW_COLS) {
            cells.add(`${col}${row}`);
        }
    }
    const patches = computeTableStylePatches(style, cells);

    return (
        <table className={styles.table}>
            <tbody>
                {PREVIEW_ROWS.map((row) => (
                    <tr key={row}>
                        {PREVIEW_COLS.map((col) => {
                            const patch = patches.get(`${col}${row}`);
                            return (
                                <td
                                    key={col}
                                    className={styles.cell}
                                    style={{
                                        backgroundColor: patch?.backgroundColor,
                                        color: patch?.color,
                                        fontWeight: patch?.fontWeight,
                                    }}
                                >
                                    Aa
                                </td>
                            );
                        })}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
