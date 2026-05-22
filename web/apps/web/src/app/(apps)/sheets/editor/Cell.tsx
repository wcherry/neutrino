'use client';

import React from 'react';
import type { CellProps } from './types';
import { formatCellValue } from './utils';
import { numToAlpha } from './utils';
import styles from './page.module.css';

export const Cell = React.memo(function Cell(props: CellProps & { selected?: boolean; style?: React.CSSProperties }) {
    const cs = props.cellStyle;
    const borderCss: React.CSSProperties =
        cs?.borderStyle === 'thin'   ? { border: '1px solid #999' } :
        cs?.borderStyle === 'medium' ? { border: '2px solid #555' } :
        cs?.borderStyle === 'thick'  ? { border: '3px solid #111' } :
        {};
    const wrapCss: React.CSSProperties =
        cs?.wrapMode === 'wrap' ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden' } :
        cs?.wrapMode === 'clip' ? { whiteSpace: 'nowrap', overflow: 'hidden' } :
        { whiteSpace: 'nowrap', overflow: 'visible' };
    const mergedStyle: React.CSSProperties = {
        ...props.style,
        ...(cs?.fontFamily      ? { fontFamily: cs.fontFamily }             : {}),
        ...(cs?.fontSize        ? { fontSize: cs.fontSize }                 : {}),
        ...(cs?.fontWeight      ? { fontWeight: cs.fontWeight }             : {}),
        ...(cs?.fontStyle       ? { fontStyle: cs.fontStyle }               : {}),
        ...(cs?.textDecoration  ? { textDecoration: cs.textDecoration }     : {}),
        ...(cs?.color           ? { color: cs.color }                       : {}),
        ...(cs?.backgroundColor ? { backgroundColor: cs.backgroundColor }   : {}),
        ...(cs?.textAlign       ? { textAlign: cs.textAlign }               : {}),
        ...borderCss,
        ...wrapCss,
    };
    return (
        <div id={props.id} className={`${styles.cell}${props.selected ? ` ${styles.cellSelected}` : ''}`} data-type="cell" style={mergedStyle}>
            <span>{props.edit ? props.raw : formatCellValue(props.value ?? '', props.cellStyle)}</span>
        </div>
    );
});

export function RowHeaderCell(props: { value: number }) {
    const value = numToAlpha(props.value + 1);
    return (
        <div key={`row-${value}-container`} className={styles.headerRowCell} data-type="row-header-cell">
            <span id={`row-${value}`} className={styles.center} data-type="row-header-cell">{value}</span>
        </div>
    );
}

export function ColumnHeaderCell(props: { value: number }) {
    return (
        <div id={`row-${props.value + 1}-container`} className={styles.headerColumnCell}>
            <span id={`row-${props.value + 1}`} className={styles.center} data-type="column-header-cell">{props.value + 1}</span>
        </div>
    );
}
