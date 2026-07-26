'use client';

import React from 'react';
import { Ban } from 'lucide-react';
import type { TableStyle } from '../styles/tableStyles';
import type { CellStyle } from '../types';
import { computeTableStylePatches } from '../styles/applyTableStyle';
import styles from './TableStylePreviewSwatch.module.css';

interface TableStylePreviewSwatchProps {
    style: TableStyle;
}

const PREVIEW_COLS = ['A', 'B', 'C', 'D'];
const PREVIEW_ROWS = [1, 2, 3, 4];

// Mirrors Cell.tsx's border rendering rule exactly, so this thumbnail always
// matches the real applied grid output. Duplicated here (rather than
// extracted to a shared util) to avoid touching Cell.tsx, which is owned by
// a parallel task landing the per-side border patch shape at the same time.
type BorderWidth = CellStyle['borderStyle'];

function sideLine(width: BorderWidth | undefined): string {
    switch (width) {
        case 'thin':
            return '1px solid #999';
        case 'medium':
            return '2px solid #555';
        case 'thick':
            return '3px solid #111';
        case 'none':
        default:
            return 'none';
    }
}

function borderCssForPatch(patch: Partial<CellStyle> | undefined): React.CSSProperties {
    if (!patch) return { border: 'none' };

    const hasPerSide =
        patch.borderTop !== undefined ||
        patch.borderRight !== undefined ||
        patch.borderBottom !== undefined ||
        patch.borderLeft !== undefined;

    if (hasPerSide) {
        return {
            borderTop: sideLine(patch.borderTop),
            borderRight: sideLine(patch.borderRight),
            borderBottom: sideLine(patch.borderBottom),
            borderLeft: sideLine(patch.borderLeft),
        };
    }

    // Legacy fallback: uniform borderStyle on all four sides.
    const uniform = sideLine(patch.borderStyle);
    return { border: uniform };
}

function RegularPreview({ style }: { style: Extract<TableStyle, { kind: 'regular' }> }): JSX.Element {
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
                                        ...borderCssForPatch(patch),
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

// The "Blank" entry clears all formatting rather than applying a color
// scheme, so it gets a visually distinct placeholder rather than reusing the
// colored-swatch rendering: a plain, unfilled 4x4 grid with light dashed
// outlines (signaling "structure only, no style applied") plus a muted
// slashed-circle icon overlay so it reads as "none" at a glance, not just
// another (accidentally blank-looking) color choice.
function BlankPreview(): JSX.Element {
    return (
        <div className={styles.blankWrap}>
            <table className={`${styles.table} ${styles.blankTable}`}>
                <tbody>
                    {PREVIEW_ROWS.map((row) => (
                        <tr key={row}>
                            {PREVIEW_COLS.map((col) => (
                                <td key={col} className={styles.blankCell}>
                                    Aa
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            <Ban className={styles.blankIcon} aria-hidden="true" size={20} strokeWidth={1.5} />
        </div>
    );
}

/**
 * A small, pure/presentational 4x4 preview of a TableStyle preset, used by
 * TableStyleGalleryModal cards. For 'regular' styles it renders the *actual*
 * computed patches (via computeTableStylePatches) over a synthetic A1:D4
 * range, including real per-side border treatment, so the preview always
 * matches the real applied output. The 'blank' entry (clears formatting) has
 * no header/band/border concept to preview and gets a distinct placeholder.
 */
export function TableStylePreviewSwatch({ style }: TableStylePreviewSwatchProps): JSX.Element {
    if (style.kind === 'blank') {
        return <BlankPreview />;
    }
    return <RegularPreview style={style} />;
}
