'use client';

import React from 'react';
import styles from './MiniGridPreview.module.css';

interface MiniGridPreviewProps {
    headers: string[];
    rows: string[][];
}

/**
 * A small, pure/presentational spreadsheet-like grid used by the Sheets
 * "New from template" gallery cards. No state, no interactivity.
 */
export function MiniGridPreview({ headers, rows }: MiniGridPreviewProps): JSX.Element {
    return (
        <table className={styles.table}>
            <thead>
                <tr>
                    {headers.map((h, i) => (
                        <th key={i} className={styles.headerCell}>{h}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.map((r, ri) => (
                    <tr key={ri}>
                        {r.map((v, ci) => (
                            <td key={ci} className={styles.cell}>{v}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
