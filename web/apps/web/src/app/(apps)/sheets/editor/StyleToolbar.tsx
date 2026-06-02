'use client';

import { useState } from 'react';
import {
    Undo2, Redo2,
    AlignLeft, AlignCenter, AlignRight,
    Calendar,
    TableCellsMerge, TableCellsSplit,
    BarChart2,
} from 'lucide-react';
import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';
import type { CellStyle } from './types';
import { ColorPickerPopover, Toolbar, ToolbarGroup, ToolbarDivider, ToolbarButton, ToolbarSelect } from '@neutrino/ui';
import { FONT_FAMILIES } from '@/constants/editor';
import { CustomFormatDialog } from './CustomFormatDialog';

const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '60', '72'];

// Text overflows past the cell border (two full lines + one overflowing)
function WrapOverflowIcon() {
    return (
        <svg width="18" height="14" viewBox="0 0 18 14" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <line x1="1" y1="3"  x2="11" y2="3"  stroke="currentColor" strokeWidth="1.4"/>
            <line x1="1" y1="7"  x2="11" y2="7"  stroke="currentColor" strokeWidth="1.4"/>
            <line x1="1" y1="11" x2="17" y2="11" stroke="currentColor" strokeWidth="1.4"/>
            <line x1="11" y1="1" x2="11" y2="13" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" opacity="0.5"/>
        </svg>
    );
}

// Text wraps inside the cell (lines shorten and continue below)
function WrapWrapIcon() {
    return (
        <svg width="18" height="14" viewBox="0 0 18 14" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <line x1="1" y1="3"  x2="11" y2="3"  stroke="currentColor" strokeWidth="1.4"/>
            <line x1="1" y1="7"  x2="9"  y2="7"  stroke="currentColor" strokeWidth="1.4"/>
            <path d="M9 7 Q11 7 11 9" stroke="currentColor" strokeWidth="1.4" fill="none"/>
            <line x1="1" y1="11" x2="7"  y2="11" stroke="currentColor" strokeWidth="1.4"/>
            <line x1="11" y1="1" x2="11" y2="13" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" opacity="0.5"/>
        </svg>
    );
}

// Text is clipped at the cell border
function WrapClipIcon() {
    return (
        <svg width="18" height="14" viewBox="0 0 18 14" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <line x1="1" y1="3"  x2="11" y2="3"  stroke="currentColor" strokeWidth="1.4"/>
            <line x1="1" y1="7"  x2="11" y2="7"  stroke="currentColor" strokeWidth="1.4"/>
            <line x1="1" y1="11" x2="11" y2="11" stroke="currentColor" strokeWidth="1.4"/>
            <line x1="11" y1="1" x2="11" y2="13" stroke="currentColor" strokeWidth="1.8"/>
        </svg>
    );
}

function DecimalIncIcon() {
    return (
        <svg width="20" height="14" viewBox="0 0 20 14" fill="none" strokeLinecap="round">
            <circle cx="1.5" cy="11.5" r="1.5" fill="currentColor"/>
            <rect x="4" y="3" width="5.5" height="9" rx="1.8" stroke="currentColor" strokeWidth="1.3"/>
            <line x1="13" y1="3" x2="13" y2="11" stroke="currentColor" strokeWidth="1.4"/>
            <line x1="9.5" y1="7" x2="16.5" y2="7" stroke="currentColor" strokeWidth="1.4"/>
        </svg>
    );
}

function DecimalDecIcon() {
    return (
        <svg width="20" height="14" viewBox="0 0 20 14" fill="none" strokeLinecap="round">
            <circle cx="1.5" cy="11.5" r="1.5" fill="currentColor"/>
            <rect x="4" y="3" width="5.5" height="9" rx="1.8" stroke="currentColor" strokeWidth="1.3"/>
            <line x1="9.5" y1="7" x2="16.5" y2="7" stroke="currentColor" strokeWidth="1.4"/>
        </svg>
    );
}


export type StyleToolbarProps = {
    cellStyle?: CellStyle;
    onStyleChange: (style: Partial<CellStyle>) => void;
    disabled?: boolean;
    onUndo: () => void;
    onRedo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onMergeCells: () => void;
    isMerged: boolean;
    onInsertChart?: () => void;
};

export function StyleToolbar({ cellStyle, onStyleChange, disabled, onUndo, onRedo, canUndo, canRedo, onMergeCells, isMerged, onInsertChart }: StyleToolbarProps) {
    const flags = useFeatureFlags();
    const isBold          = cellStyle?.fontWeight    === 'bold';
    const isItalic        = cellStyle?.fontStyle     === 'italic';
    const isStrikethrough = cellStyle?.textDecoration === 'line-through';
    const [showFormatDialog, setShowFormatDialog] = useState(false);

    return (
        <Toolbar>
            {/* Undo / Redo */}
            <ToolbarGroup>
                <ToolbarButton onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)">
                    <Undo2 size={15} />
                </ToolbarButton>
                <ToolbarButton onClick={onRedo} disabled={!canRedo} title="Redo (⌘⇧Z)">
                    <Redo2 size={15} />
                </ToolbarButton>
            </ToolbarGroup>

            <ToolbarDivider />

            {/* Font family */}
            <ToolbarSelect
                value={cellStyle?.fontFamily ?? ''}
                onChange={e => onStyleChange({ fontFamily: e.target.value || undefined })}
                disabled={disabled}
                title="Font family"
                style={{ width: 120 }}
            >
                {FONT_FAMILIES.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                ))}
            </ToolbarSelect>

            {/* Font size */}
            <ToolbarSelect
                value={cellStyle?.fontSize ? cellStyle.fontSize.replace('pt', '') : '11'}
                onChange={e => onStyleChange({ fontSize: `${e.target.value}pt` })}
                disabled={disabled}
                title="Font size"
                style={{ width: 56 }}
            >
                {FONT_SIZES.map(s => (
                    <option key={s} value={s}>{s}</option>
                ))}
            </ToolbarSelect>

            <ToolbarDivider />

            {/* Bold / Italic / Strikethrough */}
            <ToolbarGroup>
                <ToolbarButton
                    active={isBold}
                    onClick={() => onStyleChange({ fontWeight: isBold ? 'normal' : 'bold' })}
                    disabled={disabled}
                    title="Bold (Ctrl+B)"
                    style={{ fontWeight: 'bold' }}
                >B</ToolbarButton>
                <ToolbarButton
                    active={isItalic}
                    onClick={() => onStyleChange({ fontStyle: isItalic ? 'normal' : 'italic' })}
                    disabled={disabled}
                    title="Italic (Ctrl+I)"
                    style={{ fontStyle: 'italic' }}
                >I</ToolbarButton>
                <ToolbarButton
                    active={isStrikethrough}
                    onClick={() => onStyleChange({ textDecoration: isStrikethrough ? 'none' : 'line-through' })}
                    disabled={disabled}
                    title="Strikethrough"
                    style={{ textDecoration: 'line-through' }}
                >S</ToolbarButton>
            </ToolbarGroup>

            <ToolbarDivider />

            {/* Font color / Background color */}
            <ToolbarGroup>
                <ColorPickerPopover
                    color={cellStyle?.color ?? '#000000'}
                    disabled={disabled}
                    onChange={hex => onStyleChange({ color: hex })}
                    title="Font Color"
                >
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1 }}>
                        <span style={{ fontWeight: 'bold', fontSize: 13 }}>A</span>
                        <span style={{ display: 'block', width: 14, height: 3, borderRadius: 2, backgroundColor: cellStyle?.color ?? '#000000' }} />
                    </span>
                </ColorPickerPopover>

                <ColorPickerPopover
                    color={cellStyle?.backgroundColor ?? '#ffffff'}
                    disabled={disabled}
                    onChange={hex => onStyleChange({ backgroundColor: hex })}
                    title="Background Color"
                >
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1 }}>
                        <span style={{ display: 'block', width: 14, height: 11, border: '1px solid rgba(0,0,0,0.15)', borderRadius: 2, backgroundColor: cellStyle?.backgroundColor ?? 'transparent' }} />
                        <span style={{ display: 'block', width: 14, height: 3, borderRadius: 2, backgroundColor: cellStyle?.backgroundColor ?? '#ffffff' }} />
                    </span>
                </ColorPickerPopover>
            </ToolbarGroup>

            <ToolbarDivider />

            {/* Alignment */}
            <ToolbarGroup>
                <ToolbarButton
                    active={cellStyle?.textAlign === 'left'}
                    onClick={() => onStyleChange({ textAlign: 'left' })}
                    disabled={disabled}
                    title="Align Left"
                ><AlignLeft size={15} /></ToolbarButton>
                <ToolbarButton
                    active={cellStyle?.textAlign === 'center'}
                    onClick={() => onStyleChange({ textAlign: 'center' })}
                    disabled={disabled}
                    title="Align Center"
                ><AlignCenter size={15} /></ToolbarButton>
                <ToolbarButton
                    active={cellStyle?.textAlign === 'right'}
                    onClick={() => onStyleChange({ textAlign: 'right' })}
                    disabled={disabled}
                    title="Align Right"
                ><AlignRight size={15} /></ToolbarButton>
            </ToolbarGroup>

            <ToolbarDivider />

            {/* Border style */}
            <ToolbarSelect
                value={cellStyle?.borderStyle ?? 'none'}
                onChange={e => onStyleChange({ borderStyle: e.target.value as CellStyle['borderStyle'] })}
                disabled={disabled}
                title="Border Style"
            >
                <option value="none">No Border</option>
                <option value="thin">Thin Border</option>
                <option value="medium">Medium Border</option>
                <option value="thick">Thick Border</option>
            </ToolbarSelect>

            {/* Wrap mode */}
            <ToolbarGroup>
                <ToolbarButton
                    active={!cellStyle?.wrapMode || cellStyle.wrapMode === 'overflow'}
                    onClick={() => onStyleChange({ wrapMode: 'overflow' })}
                    disabled={disabled}
                    title="Overflow"
                ><WrapOverflowIcon /></ToolbarButton>
                <ToolbarButton
                    active={cellStyle?.wrapMode === 'wrap'}
                    onClick={() => onStyleChange({ wrapMode: 'wrap' })}
                    disabled={disabled}
                    title="Wrap"
                ><WrapWrapIcon /></ToolbarButton>
                <ToolbarButton
                    active={cellStyle?.wrapMode === 'clip'}
                    onClick={() => onStyleChange({ wrapMode: 'clip' })}
                    disabled={disabled}
                    title="Clip"
                ><WrapClipIcon /></ToolbarButton>
            </ToolbarGroup>

            <ToolbarDivider />

            {/* Number formats */}
            <ToolbarGroup>
                <ToolbarButton
                    active={cellStyle?.numberFormat === 'currency'}
                    onClick={() => onStyleChange({ numberFormat: cellStyle?.numberFormat === 'currency' ? undefined : 'currency' })}
                    disabled={disabled}
                    title="Currency"
                    style={{ fontSize: 14, fontWeight: 600 }}
                >$</ToolbarButton>
                <ToolbarButton
                    active={cellStyle?.numberFormat === 'percent'}
                    onClick={() => onStyleChange({ numberFormat: cellStyle?.numberFormat === 'percent' ? undefined : 'percent' })}
                    disabled={disabled}
                    title="Percent"
                    style={{ fontSize: 13 }}
                >%</ToolbarButton>
                <ToolbarButton
                    active={cellStyle?.numberFormat === 'number'}
                    onClick={() => onStyleChange({ numberFormat: cellStyle?.numberFormat === 'number' ? undefined : 'number' })}
                    disabled={disabled}
                    title="Number"
                    style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}
                >#</ToolbarButton>
                <ToolbarButton
                    active={cellStyle?.numberFormat === 'date'}
                    onClick={() => onStyleChange({ numberFormat: cellStyle?.numberFormat === 'date' ? undefined : 'date' })}
                    disabled={disabled}
                    title="Date"
                ><Calendar size={15} /></ToolbarButton>
                <ToolbarButton
                    active={!!cellStyle?.customFormat}
                    onClick={() => setShowFormatDialog(true)}
                    disabled={disabled}
                    title="More formats…"
                    style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 600, width: 36 }}
                >123…</ToolbarButton>
            </ToolbarGroup>

            <ToolbarDivider />

            {/* Merge / Unmerge cells */}
            <ToolbarButton
                active={isMerged}
                onClick={onMergeCells}
                disabled={disabled}
                title={isMerged ? 'Unmerge Cells' : 'Merge Cells'}
            >{isMerged ? <TableCellsSplit size={15} /> : <TableCellsMerge size={15} />}</ToolbarButton>

            <ToolbarDivider />

            {/* Decimal places */}
            <ToolbarGroup>
                <ToolbarButton
                    onClick={() => onStyleChange({ decimalPlaces: Math.max(0, (cellStyle?.decimalPlaces ?? 0) - 1) })}
                    disabled={disabled || (cellStyle?.decimalPlaces ?? 0) <= 0}
                    title="Decrease decimal places"
                ><DecimalDecIcon /></ToolbarButton>
                <ToolbarButton
                    onClick={() => onStyleChange({ decimalPlaces: (cellStyle?.decimalPlaces ?? 0) + 1 })}
                    disabled={disabled}
                    title="Increase decimal places"
                ><DecimalIncIcon /></ToolbarButton>
            </ToolbarGroup>

            {flags.sheetsCharts && onInsertChart && (
                <>
                    <ToolbarDivider />
                    <ToolbarButton
                        onClick={onInsertChart}
                        title="Insert Chart"
                    >
                        <BarChart2 size={15} />
                    </ToolbarButton>
                </>
            )}

            {showFormatDialog && (
                <CustomFormatDialog
                    cellStyle={cellStyle}
                    onApply={onStyleChange}
                    onClose={() => setShowFormatDialog(false)}
                />
            )}
        </Toolbar>
    );
}
