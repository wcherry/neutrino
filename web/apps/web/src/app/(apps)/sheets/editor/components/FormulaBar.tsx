'use client';

import React, { useEffect, useRef } from 'react';
import type { CellProps } from '../types';
import { functionsList } from '../formula';
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
    const dropdownRef = useRef<HTMLDivElement>(null);

    const query = showFunctions && !showAllFunctions
        ? (currentCell?.raw ?? '').slice(1).toUpperCase()
        : '';
    const fns = (showFunctions || showAllFunctions) ? functionsList(query) : [];
    const isOpen = fns.length > 0 && (showFunctions || showAllFunctions);

    // Close dropdown on outside click
    useEffect(() => {
        if (!isOpen) return;
        const handle = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                // Only close the "all functions" panel via outside click — typing-triggered
                // showFunctions is managed by the input handler in useCellEditing.
                if (showAllFunctions) onToggleAllFunctions();
            }
        };
        document.addEventListener('mousedown', handle);
        return () => document.removeEventListener('mousedown', handle);
    }, [isOpen, showAllFunctions, onToggleAllFunctions]);

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
            <div className={styles.formulaInputWrapper} ref={dropdownRef}>
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
                    <div className={styles.functionDropdown}>
                        {fns.map(fn => (
                            <button
                                key={fn.name}
                                className={styles.functionItem}
                                onMouseDown={e => {
                                    e.preventDefault();
                                    onFunctionSelect(fn.name);
                                }}
                                type="button"
                            >
                                <span className={styles.functionSignature}>
                                    <span className={styles.functionName}>{fn.name}</span>
                                    {fn.signature.slice(fn.name.length)}
                                </span>
                                <span className={styles.functionDescription}>{fn.description}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
