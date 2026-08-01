'use client';

import React, { useRef } from 'react';
import type { CellProps } from '../types';
import { functionsList } from '../formula';
import { FunctionHelper } from './FunctionHelper';
import styles from '../page.module.css';

type Props = {
    addressDisplay: string;
    currentCell: CellProps | undefined;
    showFunctions: boolean;
    showAllFunctions: boolean;
    formulaPickMode: boolean;
    formulaInputRef: React.RefObject<HTMLInputElement>;
    onTextChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    onFocus: (event: React.FocusEvent<HTMLInputElement>) => void;
    onMouseDown: (event: React.MouseEvent<HTMLInputElement>) => void;
    onBlur: (event: React.FocusEvent<HTMLInputElement>) => void;
    onToggleAllFunctions: () => void;
    onFunctionSelect: (fnName: string) => void;
    /** Formula inputs contain non-natural-language text; spell check is off by default. */
    spellCheck?: boolean;
    readOnly?: boolean;
};

export function FormulaBar({
    addressDisplay,
    currentCell,
    showFunctions,
    showAllFunctions,
    formulaPickMode,
    formulaInputRef,
    onTextChange,
    onKeyDown,
    onFocus,
    onMouseDown,
    onBlur,
    onToggleAllFunctions,
    onFunctionSelect,
    spellCheck = false,
    readOnly = false,
}: Props) {
    const wrapperRef = useRef<HTMLDivElement>(null);

    const query = showFunctions && !showAllFunctions
        ? (currentCell?.raw ?? '').slice(1).toUpperCase()
        : '';
    const fns = (showFunctions || showAllFunctions) ? functionsList(query) : [];
    const isOpen = fns.length > 0 && (showFunctions || showAllFunctions);

    return (
        <div className={styles.formulaBar}>
            <span className={styles.cellAddress}>{addressDisplay}</span>
            <button
                className={`${styles.fxButton} ${showAllFunctions ? styles.fxButtonActive : ''}`}
                onClick={onToggleAllFunctions}
                title="Show all functions"
                type="button"
            >
                <i>f</i>(x)
            </button>
            <div className={styles.formulaInputWrapper} ref={wrapperRef}>
                <input
                    ref={formulaInputRef}
                    type="text"
                    className={`${styles.formulaInput}${formulaPickMode ? ` ${styles.formulaInputPickMode}` : ''}`}
                    value={currentCell?.raw ?? ''}
                    spellCheck={spellCheck}
                    readOnly={readOnly}
                    onChange={readOnly ? undefined : onTextChange}
                    onKeyDown={readOnly ? undefined : onKeyDown}
                    onFocus={readOnly ? undefined : onFocus}
                    onMouseDown={readOnly ? undefined : onMouseDown}
                    onBlur={readOnly ? undefined : onBlur}
                    data-testid="formula-bar-input"
                />
                {formulaPickMode && (
                    <span className={styles.formulaPickHint} aria-live="polite">
                        Click a cell or drag a range to insert reference
                    </span>
                )}
                {isOpen && (
                    <FunctionHelper
                        functions={fns}
                        anchorCellId={currentCell?.id}
                        fallbackRef={wrapperRef}
                        onSelect={onFunctionSelect}
                        // Only the "all functions" panel closes on an outside click —
                        // typing-triggered showFunctions is managed by useCellEditing.
                        onDismiss={showAllFunctions ? onToggleAllFunctions : undefined}
                    />
                )}
            </div>
        </div>
    );
}
