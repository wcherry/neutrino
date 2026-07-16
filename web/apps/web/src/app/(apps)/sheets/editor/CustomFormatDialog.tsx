'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { CellStyle } from './types';
import { applyCustomFormat } from './utils';

type Category = 'number' | 'currency' | 'percent' | 'datetime';

type Preset = {
    label: string;
    customFormat: string;
    numberFormat: CellStyle['numberFormat'];
    decimalPlaces?: number;
};

const PRESETS: Record<Category, Preset[]> = {
    number: [
        { label: '1,234',       customFormat: '#,##0',       numberFormat: 'number', decimalPlaces: 0 },
        { label: '1,234.0',     customFormat: '#,##0.0',     numberFormat: 'number', decimalPlaces: 1 },
        { label: '1,234.00',    customFormat: '#,##0.00',    numberFormat: 'number', decimalPlaces: 2 },
        { label: '1,234.000',   customFormat: '#,##0.000',   numberFormat: 'number', decimalPlaces: 3 },
        { label: '1,234.0000',  customFormat: '#,##0.0000',  numberFormat: 'number', decimalPlaces: 4 },
        { label: '1234',        customFormat: '0',           numberFormat: 'number', decimalPlaces: 0 },
        { label: '1234.00',     customFormat: '0.00',        numberFormat: 'number', decimalPlaces: 2 },
    ],
    currency: [
        { label: '$1,234.00',   customFormat: '"$"#,##0.00',   numberFormat: 'currency', decimalPlaces: 2 },
        { label: '$1,234',      customFormat: '"$"#,##0',      numberFormat: 'currency', decimalPlaces: 0 },
        { label: '$1,234.0',    customFormat: '"$"#,##0.0',    numberFormat: 'currency', decimalPlaces: 1 },
        { label: '$1,234.000',  customFormat: '"$"#,##0.000',  numberFormat: 'currency', decimalPlaces: 3 },
        { label: '$1,234.0000', customFormat: '"$"#,##0.0000', numberFormat: 'currency', decimalPlaces: 4 },
    ],
    percent: [
        { label: '75%',     customFormat: '0%',    numberFormat: 'percent', decimalPlaces: 0 },
        { label: '75.0%',   customFormat: '0.0%',  numberFormat: 'percent', decimalPlaces: 1 },
        { label: '75.00%',  customFormat: '0.00%', numberFormat: 'percent', decimalPlaces: 2 },
        { label: '75.000%', customFormat: '0.000%',numberFormat: 'percent', decimalPlaces: 3 },
    ],
    datetime: [
        { label: '11/1/2025',         customFormat: 'M/D/yyyy',       numberFormat: 'date' },
        { label: '11/01/2025',        customFormat: 'MM/DD/yyyy',     numberFormat: 'date' },
        { label: 'Nov 2025',          customFormat: 'mmm yyyy',       numberFormat: 'date' },
        { label: 'November 1, 2025',  customFormat: 'mmmm D, yyyy',   numberFormat: 'date' },
        { label: '1-Nov-25',          customFormat: 'D-mmm-yy',       numberFormat: 'date' },
        { label: 'Sat, 1 Nov 2025',      customFormat: 'ddd, D mmm yyyy',  numberFormat: 'date' },
        { label: 'Saturday, 1 Nov 2025', customFormat: 'dddd, D mmm yyyy', numberFormat: 'date' },
        { label: '1:30 PM',    customFormat: 'h:mm AM/PM',    numberFormat: 'time' },
        { label: '1:30:00 PM', customFormat: 'h:mm:ss AM/PM', numberFormat: 'time' },
        { label: '13:30',      customFormat: 'hh:mm',         numberFormat: 'time' },
        { label: '13:30:00',   customFormat: 'hh:mm:ss',      numberFormat: 'time' },
        { label: '11/1/2025 1:30 PM',        customFormat: 'M/D/yyyy h:mm AM/PM',     numberFormat: 'datetime' },
        { label: '11/1/2025 13:30',          customFormat: 'M/D/yyyy hh:mm',          numberFormat: 'datetime' },
        { label: 'November 1, 2025 1:30 PM', customFormat: 'mmmm D, yyyy h:mm AM/PM', numberFormat: 'datetime' },
    ],
};

const SAMPLE_NUMBER = '1234.5678';
const SAMPLE_DATETIME = '2025-11-01T13:30:00Z';

function categoryLabel(c: Category): string {
    return { number: 'Number', currency: 'Currency', percent: 'Percent', datetime: 'Date & Time' }[c];
}

function sampleValue(category: Category): string {
    return category === 'datetime' ? SAMPLE_DATETIME : SAMPLE_NUMBER;
}

// Cells formatted before Date/Time were merged into one category may still carry
// numberFormat 'date' or 'time' individually — route them to the merged tab.
function toCategory(nf?: CellStyle['numberFormat']): Category {
    if (nf === 'date' || nf === 'time' || nf === 'datetime') return 'datetime';
    if (nf === 'currency' || nf === 'percent') return nf;
    return 'number';
}

export type CustomFormatDialogProps = {
    cellStyle?: CellStyle;
    onApply: (style: Partial<CellStyle>) => void;
    onClose: () => void;
};

export function CustomFormatDialog({ cellStyle, onApply, onClose }: CustomFormatDialogProps) {
    const initialCategory: Category = toCategory(cellStyle?.numberFormat);
    const [category, setCategory] = useState<Category>(initialCategory);
    const [customInput, setCustomInput] = useState(cellStyle?.customFormat ?? PRESETS[initialCategory][0].customFormat);
    const [selectedPreset, setSelectedPreset] = useState<string | null>(
        cellStyle?.customFormat ?? PRESETS[initialCategory][0].customFormat
    );
    const overlayRef = useRef<HTMLDivElement>(null);

    // Switch category → reset to first preset
    function handleCategoryChange(c: Category) {
        setCategory(c);
        const first = PRESETS[c][0].customFormat;
        setCustomInput(first);
        setSelectedPreset(first);
    }

    function handlePresetClick(preset: Preset) {
        setSelectedPreset(preset.customFormat);
        setCustomInput(preset.customFormat);
    }

    function handleCustomInputChange(v: string) {
        setCustomInput(v);
        setSelectedPreset(null);
    }

    function handleApply() {
        // Find matching preset for numberFormat + decimalPlaces
        const allPresets = Object.values(PRESETS).flat();
        const match = allPresets.find(p => p.customFormat === customInput);
        onApply({
            numberFormat: match?.numberFormat ?? category,
            decimalPlaces: match?.decimalPlaces,
            customFormat: customInput || undefined,
        });
        onClose();
    }

    // Dismiss on overlay click
    function handleOverlayClick(e: React.MouseEvent) {
        if (e.target === overlayRef.current) onClose();
    }

    // Preview
    const preview = customInput
        ? (() => { try { return applyCustomFormat(sampleValue(category), customInput); } catch { return '—'; } })()
        : sampleValue(category);

    return createPortal(
        <div
            ref={overlayRef}
            onClick={handleOverlayClick}
            style={{
                position: 'fixed', inset: 0, zIndex: 10000,
                background: 'rgba(0,0,0,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
        >
            <div style={{
                background: '#fff', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                width: 380, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
                overflow: 'hidden', fontFamily: 'sans-serif', fontSize: 13, color: '#222',
            }}>
                {/* Header */}
                <div style={{ padding: '14px 18px 10px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Custom Format</span>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#888', lineHeight: 1, padding: '0 2px' }}>×</button>
                </div>

                {/* Category tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid #eee', padding: '0 18px' }}>
                    {(['number', 'currency', 'percent', 'datetime'] as Category[]).map(c => (
                        <button
                            key={c}
                            onClick={() => handleCategoryChange(c)}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                padding: '8px 12px', fontSize: 12, fontWeight: category === c ? 600 : 400,
                                color: category === c ? 'rgb(0,90,220)' : '#555',
                                borderBottom: category === c ? '2px solid rgb(0,90,220)' : '2px solid transparent',
                                marginBottom: -1,
                            }}
                        >{categoryLabel(c)}</button>
                    ))}
                </div>

                {/* Preset list */}
                <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
                    {PRESETS[category].map(preset => (
                        <div
                            key={preset.customFormat}
                            onClick={() => handlePresetClick(preset)}
                            style={{
                                padding: '7px 18px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
                                background: selectedPreset === preset.customFormat ? 'rgba(0,100,255,0.07)' : 'transparent',
                                color: selectedPreset === preset.customFormat ? 'rgb(0,90,220)' : '#222',
                                fontWeight: selectedPreset === preset.customFormat ? 500 : 400,
                            }}
                        >
                            <span>{preset.label}</span>
                            <span style={{ color: '#999', fontSize: 11, fontFamily: 'monospace' }}>{preset.customFormat}</span>
                        </div>
                    ))}
                </div>

                {/* Custom format input */}
                <div style={{ padding: '10px 18px', borderTop: '1px solid #eee' }}>
                    <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 4 }}>Custom format string</label>
                    <input
                        value={customInput}
                        onChange={e => handleCustomInputChange(e.target.value)}
                        placeholder='e.g. #,##0.00 or mmm yyyy'
                        style={{
                            width: '100%', boxSizing: 'border-box', padding: '6px 8px',
                            border: '1px solid #d0d0d0', borderRadius: 5, fontSize: 12,
                            fontFamily: 'monospace', outline: 'none',
                        }}
                    />
                </div>

                {/* Preview */}
                <div style={{ padding: '6px 18px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#666' }}>Preview:</span>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{preview}</span>
                </div>

                {/* Footer */}
                <div style={{ padding: '10px 18px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button
                        onClick={onClose}
                        style={{ padding: '6px 16px', border: '1px solid #d0d0d0', borderRadius: 6, background: '#f5f5f7', cursor: 'pointer', fontSize: 12 }}
                    >Cancel</button>
                    <button
                        onClick={handleApply}
                        style={{ padding: '6px 16px', border: 'none', borderRadius: 6, background: 'rgb(0,90,220)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}
                    >Apply</button>
                </div>
            </div>
        </div>,
        document.body
    );
}
