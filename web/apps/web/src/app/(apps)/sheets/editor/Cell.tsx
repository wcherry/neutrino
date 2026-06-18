'use client';

import React from 'react';
import type { CellProps } from './types';
import type { CellCFResult } from './conditionalFormatting';
import { formatCellValue } from './utils';
import { numToAlpha } from './utils';
import styles from './page.module.css';

export const Cell = React.memo(function Cell(props: CellProps & {
    selected?: boolean;
    style?: React.CSSProperties;
    cfResult?: CellCFResult;
}) {
    const cs = props.cellStyle;
    const cf = props.cfResult;
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
        // CF style overrides cell style (CF takes precedence over manual formatting)
        ...(cf?.style?.backgroundColor ? { backgroundColor: cf.style.backgroundColor } : {}),
        ...(cf?.style?.color           ? { color: cf.style.color }                     : {}),
        ...(cf?.style?.fontWeight      ? { fontWeight: cf.style.fontWeight }            : {}),
        ...(cf?.style?.fontStyle       ? { fontStyle: cf.style.fontStyle }              : {}),
        ...(cf?.style?.textDecoration  ? { textDecoration: cf.style.textDecoration }    : {}),
        // data/progress bars need a positioning context
        ...(cf?.dataBar || cf?.progressBar ? { position: 'relative' } : {}),
    };
    const content = props.edit ? props.raw : formatCellValue(props.value ?? '', props.cellStyle);
    const hasBar = cf?.dataBar || cf?.progressBar;
    return (
        <div id={props.id} className={`${styles.cell}${props.selected ? ` ${styles.cellSelected}` : ''}`} data-type="cell" style={mergedStyle}>
            {cf?.dataBar && (
                <div
                    style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0,
                        width: `${cf.dataBar.pct}%`,
                        background: cf.dataBar.gradient
                            ? `linear-gradient(to right, ${cf.dataBar.color}cc, ${cf.dataBar.color}44)`
                            : `${cf.dataBar.color}88`,
                        pointerEvents: 'none', zIndex: 0,
                    }}
                />
            )}
            {/* item 15: progress bar — shows filled + unfilled portions with optional % label */}
            {cf?.progressBar && (
                <>
                    <div style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0,
                        width: `${cf.progressBar.pct}%`,
                        background: cf.progressBar.color,
                        opacity: 0.35,
                        pointerEvents: 'none', zIndex: 0,
                    }} />
                    <div style={{
                        position: 'absolute', left: `${cf.progressBar.pct}%`, top: 0, right: 0, bottom: 0,
                        background: `${cf.progressBar.color}22`,
                        pointerEvents: 'none', zIndex: 0,
                    }} />
                </>
            )}
            <span style={{ position: hasBar ? 'relative' : undefined, zIndex: hasBar ? 1 : undefined, display: 'flex', height: '100%', alignItems: cs?.verticalAlign === 'top' ? 'flex-start' : cs?.verticalAlign === 'bottom' ? 'flex-end' : 'center', gap: 3, justifyContent: cs?.textAlign === 'center' ? 'center' : cs?.textAlign === 'right' ? 'flex-end' : undefined }}>
                {cf?.icon && <span style={{ marginRight: 3, fontSize: '0.85em' }}>{cf.icon}</span>}
                {content}
                {cf?.progressBar?.showLabel && (
                    <span style={{ fontSize: '0.78em', opacity: 0.7, marginLeft: 2 }}>{Math.round(cf.progressBar.pct)}%</span>
                )}
            </span>
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
