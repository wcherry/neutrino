'use client';

import React, { useState, useCallback } from 'react';
import { Plus, Trash2, X, ChevronUp, ChevronDown, Save, FolderOpen, Sparkles, Wand2 } from 'lucide-react';
import { ColorPickerPopover } from '@neutrino/ui';
import { HEAT_MAP_PRESETS, expandRange } from './conditionalFormatting';
import type { CellProps } from './types';
import type {
    CFRule, CFRuleSpec, CFStyle, CFConditionType, CFTopBottomRule, CFAverageRule,
    CFFormulaRule, CFProgressBarRule, CFStatusIndicatorRule, CFHeatMapRule,
    CFThemeColorRule, CFVariable, CFTemplate, CFThemeToken, CFHeatMapPreset,
    CFStatusIndicatorTemplate,
} from './types';

const CF_TEMPLATES_KEY = 'neutrino:sheets:cf-templates';
const CF_VARIABLES_KEY  = 'neutrino:sheets:cf-variables';

// ── Item 21: column-type detection ────────────────────────────────────────────

type ColumnType = 'currency' | 'percentage' | 'date' | 'numeric' | 'status-project' | 'status-priority' | 'status-approval' | 'unknown';

const STATUS_SETS: Record<string, ColumnType> = {
    'not started': 'status-project', 'in progress': 'status-project',
    'blocked': 'status-project', 'done': 'status-project',
    'low': 'status-priority', 'medium': 'status-priority',
    'high': 'status-priority', 'critical': 'status-priority',
    'pending': 'status-approval', 'approved': 'status-approval', 'rejected': 'status-approval',
};

function detectColumnType(data: Map<string, CellProps>, range: string): ColumnType {
    const ids = expandRange(range);
    if (ids.length === 0) return 'unknown';
    const cells = ids.map(id => data.get(id)).filter(Boolean) as CellProps[];
    const filled = cells.filter(c => (c.value ?? c.raw ?? '').trim() !== '');
    if (filled.length === 0) return 'unknown';

    // numberFormat style is the strongest signal
    const fmtCounts: Record<string, number> = {};
    for (const c of filled) {
        const fmt = c.cellStyle?.numberFormat;
        if (fmt) fmtCounts[fmt] = (fmtCounts[fmt] ?? 0) + 1;
    }
    const topFmt = Object.entries(fmtCounts).sort((a, b) => b[1] - a[1])[0];
    if (topFmt && topFmt[1] > filled.length * 0.4) {
        if (topFmt[0] === 'currency')  return 'currency';
        if (topFmt[0] === 'percent')   return 'percentage';
        if (topFmt[0] === 'date')      return 'date';
    }

    // Analyze raw values
    const statusTypeCounts: Record<string, number> = {};
    let numCount = 0, dateCount = 0, currCount = 0, pctCount = 0;

    for (const c of filled) {
        const raw = String(c.value ?? c.raw ?? '').trim();
        const lower = raw.toLowerCase();
        if (STATUS_SETS[lower]) {
            const t = STATUS_SETS[lower];
            statusTypeCounts[t] = (statusTypeCounts[t] ?? 0) + 1;
            continue;
        }
        if (raw.startsWith('$')) { currCount++; continue; }
        if (raw.endsWith('%'))   { pctCount++;  continue; }
        if (!isNaN(parseFloat(raw)) && raw !== '') { numCount++; continue; }
        if (!isNaN(Date.parse(raw)) && raw.length >= 8) { dateCount++; continue; }
    }

    const n = filled.length;
    if (currCount > n * 0.4) return 'currency';
    if (pctCount  > n * 0.4) return 'percentage';
    if (dateCount > n * 0.4) return 'date';

    const topStatus = Object.entries(statusTypeCounts).sort((a, b) => b[1] - a[1])[0];
    if (topStatus && topStatus[1] > n * 0.3) return topStatus[0] as ColumnType;

    if (numCount > n * 0.5) return 'numeric';
    return 'unknown';
}

type Suggestion = {
    label: string;
    description: string;
    icon: string;
    buildRule: (range: string) => CFRule;
};

function makeSuggestions(type: ColumnType): Suggestion[] {
    const id = () => Math.random().toString(36).slice(2, 10);
    switch (type) {
        case 'currency':
            return [
                {
                    label: 'Profit / Loss',
                    description: 'Green for positive, red for negative values',
                    icon: '💰',
                    buildRule: (range) => ({ id: id(), range, rule: { kind: 'colorScale', minColor: '#f4cccc', midColor: '#ffffff', maxColor: '#b7e1cd' } }),
                },
                {
                    label: 'Budget overrun',
                    description: 'Red when value exceeds 0',
                    icon: '⚠️',
                    buildRule: (range) => ({ id: id(), range, rule: { kind: 'singleColor', condition: 'greaterThan', value: '0', format: { backgroundColor: '#fce8e6', color: '#c5221f' } } }),
                },
                {
                    label: 'Color scale',
                    description: 'Gradient from low (red) to high (green)',
                    icon: '🌈',
                    buildRule: (range) => ({ id: id(), range, rule: { kind: 'colorScale', minColor: '#f4cccc', maxColor: '#b7e1cd' } }),
                },
            ];
        case 'percentage':
            return [
                {
                    label: 'Progress bar',
                    description: 'Visual bar for 0–100% values',
                    icon: '📊',
                    buildRule: (range) => ({ id: id(), range, rule: { kind: 'progressBar', minValue: 0, maxValue: 100, color: '#4285f4', showLabel: true } }),
                },
                {
                    label: 'Color scale',
                    description: 'Red → yellow → green gradient',
                    icon: '🌈',
                    buildRule: (range) => ({ id: id(), range, rule: { kind: 'colorScale', minColor: '#f4cccc', midColor: '#ffe599', maxColor: '#b7e1cd' } }),
                },
                {
                    label: 'Below target',
                    description: 'Red when below 50%',
                    icon: '🎯',
                    buildRule: (range) => ({ id: id(), range, rule: { kind: 'singleColor', condition: 'lessThan', value: '50', format: { backgroundColor: '#fce8e6', color: '#c5221f' } } }),
                },
            ];
        case 'date':
            return [
                {
                    label: 'Past due',
                    description: 'Red for dates in the past',
                    icon: '📅',
                    buildRule: (range) => ({ id: id(), range, rule: { kind: 'singleColor', condition: 'dateIsPastDue', format: { backgroundColor: '#fce8e6', color: '#c5221f' } } }),
                },
                {
                    label: 'Due today',
                    description: 'Yellow for today\'s date',
                    icon: '🔔',
                    buildRule: (range) => ({ id: id(), range, rule: { kind: 'singleColor', condition: 'dateIsToday', format: { backgroundColor: '#fef9e7', color: '#9c6500' } } }),
                },
                {
                    label: 'Due next week',
                    description: 'Blue for dates within 7 days',
                    icon: '📆',
                    buildRule: (range) => ({ id: id(), range, rule: { kind: 'singleColor', condition: 'dateIsNextWeek', format: { backgroundColor: '#cfe2ff', color: '#084298' } } }),
                },
            ];
        case 'status-project':
            return [
                {
                    label: 'Project status',
                    description: 'Color-code Not Started / In Progress / Blocked / Done',
                    icon: '📋',
                    buildRule: (range) => ({ id: id(), range, rule: { kind: 'statusIndicator', template: 'projectStatus' as CFStatusIndicatorTemplate } }),
                },
            ];
        case 'status-priority':
            return [
                {
                    label: 'Priority levels',
                    description: 'Color-code Low / Medium / High / Critical',
                    icon: '🚨',
                    buildRule: (range) => ({ id: id(), range, rule: { kind: 'statusIndicator', template: 'priority' as CFStatusIndicatorTemplate } }),
                },
            ];
        case 'status-approval':
            return [
                {
                    label: 'Approval status',
                    description: 'Color-code Pending / Approved / Rejected',
                    icon: '✅',
                    buildRule: (range) => ({ id: id(), range, rule: { kind: 'statusIndicator', template: 'approval' as CFStatusIndicatorTemplate } }),
                },
            ];
        case 'numeric':
            return [
                {
                    label: 'Top 10',
                    description: 'Highlight the 10 highest values',
                    icon: '🏆',
                    buildRule: (range) => ({ id: id(), range, rule: { kind: 'topBottom', direction: 'top', type: 'n', value: 10, format: { backgroundColor: '#fce8b2', color: '#7d4c00' } } }),
                },
                {
                    label: 'Color scale',
                    description: 'Gradient from low to high values',
                    icon: '🌈',
                    buildRule: (range) => ({ id: id(), range, rule: { kind: 'colorScale', minColor: '#f4cccc', maxColor: '#b7e1cd' } }),
                },
                {
                    label: 'Above average',
                    description: 'Highlight values above the mean',
                    icon: '📈',
                    buildRule: (range) => ({ id: id(), range, rule: { kind: 'average', direction: 'above', format: { backgroundColor: '#b7e1cd', color: '#0f5132' } } }),
                },
            ];
        default:
            return [];
    }
}

// ── Item 23: AI rule builder helpers ─────────────────────────────────────────

function readAiSettings(): { provider: string; apiKey: string } {
    try {
        return { provider: 'gemini', apiKey: '', ...JSON.parse(localStorage.getItem('neutrino.ai.settings') ?? '{}') };
    } catch { return { provider: 'gemini', apiKey: '' }; }
}

async function callAiRuleBuilder(description: string): Promise<{ rule: CFRuleSpec; explanation: string }> {
    const { provider, apiKey } = readAiSettings();
    const systemPrompt = `You are a spreadsheet conditional formatting expert. Convert a user's natural language description into a conditional formatting rule.

Return ONLY a single valid JSON object — no markdown, no code fences, no explanation outside the JSON.

Supported rule formats:

Formula rule (use for complex logic):
{"kind":"formula","formula":"=<formula>","format":{"backgroundColor":"#hex","color":"#hex"},"explanation":"<one sentence>"}

Single-color rule (use for simple conditions):
{"kind":"singleColor","condition":"greaterThan|lessThan|equalTo|notEqualTo|between|containsText|isEmpty|isNotEmpty|dateIsToday|dateIsTomorrow|dateIsPastDue|dateIsNextWeek|dateIsThisMonth","value":"<optional>","value2":"<optional, for between>","format":{"backgroundColor":"#hex","color":"#hex"},"explanation":"<one sentence>"}

Color guide: danger/overdue → bg #fce8e6 text #c5221f; warning → bg #fef9e7 text #9c6500; success/good → bg #e6f4ea text #137333; info → bg #cfe2ff text #084298.

Formulas start with = and evaluate to TRUE/FALSE. Use TODAY() for date math, column letters like A1, $A1 for absolute columns.`;

    const res = await fetch('/api/ai/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: apiKey || undefined, systemPrompt, userMessage: description }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `AI error ${res.status}`);
    }
    const { text } = await res.json() as { text: string };

    // Strip potential markdown code fences
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned) as { kind: string; explanation?: string } & Record<string, unknown>;
    const { explanation = '', ...ruleFields } = parsed;
    return { rule: ruleFields as CFRuleSpec, explanation };
}

function loadTemplates(): CFTemplate[] {
    try { return JSON.parse(localStorage.getItem(CF_TEMPLATES_KEY) ?? '[]'); } catch { return []; }
}
function saveTemplates(t: CFTemplate[]): void {
    localStorage.setItem(CF_TEMPLATES_KEY, JSON.stringify(t));
}
function loadVariables(): CFVariable[] {
    try { return JSON.parse(localStorage.getItem(CF_VARIABLES_KEY) ?? '[]'); } catch { return []; }
}
function saveVariables(v: CFVariable[]): void {
    localStorage.setItem(CF_VARIABLES_KEY, JSON.stringify(v));
}

type Props = {
    rules: CFRule[];
    selectionRange?: string;
    onUpdate: (rules: CFRule[]) => void;
    onClose: () => void;
    // item 21: cell data for column-type detection
    data?: Map<string, CellProps>;
};

type EditingRule = {
    id: string;
    range: string;
    rule: CFRuleSpec;
    stopIfTrue?: boolean;
};

function makeId(): string {
    return Math.random().toString(36).slice(2, 10);
}

function defaultRule(): EditingRule {
    return {
        id: makeId(),
        range: 'A1:A100',
        rule: {
            kind: 'singleColor',
            condition: 'greaterThan',
            value: '0',
            format: { backgroundColor: '#b7e1cd', color: '#0f5132' },
        },
    };
}

const CONDITION_LABELS: Record<CFConditionType, string> = {
    greaterThan:    'Greater than',
    lessThan:       'Less than',
    equalTo:        'Equal to',
    notEqualTo:     'Not equal to',
    between:        'Between',
    containsText:   'Contains text',
    isEmpty:        'Is empty',
    isNotEmpty:     'Is not empty',
    dateIsToday:    'Date is today',
    dateIsTomorrow: 'Date is tomorrow',
    dateIsPastDue:  'Date is past due',
    dateIsNextWeek: 'Date is next week',
    dateIsThisMonth:'Date is this month',
};

const KIND_LABELS: Record<string, string> = {
    singleColor:     'Single color',
    colorScale:      'Color scale',
    heatMap:         'Heat map',
    dataBar:         'Data bar',
    progressBar:     'Progress bar',
    iconSet:         'Icon set',
    duplicates:      'Highlight duplicates',
    uniques:         'Highlight uniques',
    topBottom:       'Top / Bottom',
    average:         'Above / Below average',
    formula:         'Custom formula',
    statusIndicator: 'Status indicator',
    themeColor:      'Theme-aware color',
    variable:        'Named variable',
};

const THEME_TOKEN_LABELS: Record<CFThemeToken, string> = {
    success: 'Success (green)',
    warning: 'Warning (yellow)',
    danger:  'Danger (red)',
    info:    'Info (blue)',
};

const HEAT_MAP_PRESET_LABELS: Record<CFHeatMapPreset, string> = {
    financial:   'Financial (red → yellow → green)',
    performance: 'Performance (red → yellow → green, vivid)',
    temperature: 'Temperature (blue → white → red)',
};

const STATUS_TEMPLATE_LABELS: Record<CFStatusIndicatorTemplate, string> = {
    projectStatus: 'Project status (Not Started / In Progress / Blocked / Done)',
    priority:      'Priority (Low / Medium / High / Critical)',
    approval:      'Approval (Pending / Approved / Rejected)',
};

// ── RuleEditor ────────────────────────────────────────────────────────────────

function RuleEditor({ rule: editing, variables, onChange }: {
    rule: EditingRule;
    variables: CFVariable[];
    onChange: (r: EditingRule) => void;
}) {
    const { rule } = editing;

    const setRange = (range: string) => onChange({ ...editing, range });
    const setRule  = (r: CFRuleSpec)  => onChange({ ...editing, rule: r });
    const setStopIfTrue = (v: boolean) => onChange({ ...editing, stopIfTrue: v });

    const setKind = (kind: string) => {
        switch (kind) {
            case 'singleColor':
                setRule({ kind: 'singleColor', condition: 'greaterThan', value: '0', format: { backgroundColor: '#b7e1cd', color: '#0f5132' } }); break;
            case 'colorScale':
                setRule({ kind: 'colorScale', minColor: '#f4cccc', maxColor: '#b7e1cd' }); break;
            case 'heatMap': {
                const p = HEAT_MAP_PRESETS.financial;
                setRule({ kind: 'heatMap', preset: 'financial', lowColor: p.low, highColor: p.high, midColor: p.mid });
                break;
            }
            case 'dataBar':
                setRule({ kind: 'dataBar', color: '#4285f4', gradient: true }); break;
            case 'progressBar':
                setRule({ kind: 'progressBar', minValue: 0, maxValue: 100, color: '#4285f4', showLabel: true }); break;
            case 'iconSet':
                setRule({ kind: 'iconSet', iconSet: 'trafficLights' }); break;
            case 'duplicates':
                setRule({ kind: 'duplicates', format: { backgroundColor: '#fce8b2', color: '#7d4c00' } }); break;
            case 'uniques':
                setRule({ kind: 'uniques', format: { backgroundColor: '#d9ead3', color: '#274e13' } }); break;
            case 'topBottom':
                setRule({ kind: 'topBottom', direction: 'top', type: 'n', value: 10, format: { backgroundColor: '#fce8b2', color: '#7d4c00' } }); break;
            case 'average':
                setRule({ kind: 'average', direction: 'above', format: { backgroundColor: '#b7e1cd', color: '#0f5132' } }); break;
            case 'formula':
                setRule({ kind: 'formula', formula: '=', format: { backgroundColor: '#cfe2ff', color: '#084298' } }); break;
            case 'statusIndicator':
                setRule({ kind: 'statusIndicator', template: 'projectStatus' }); break;
            case 'themeColor':
                setRule({ kind: 'themeColor', condition: 'greaterThan', value: '0', token: 'success' }); break;
            case 'variable':
                setRule({ kind: 'variable', variableName: variables[0]?.name ?? '' }); break;
        }
    };

    const setFormat = (patch: Partial<CFStyle>) => {
        if (rule.kind !== 'singleColor' && rule.kind !== 'duplicates' && rule.kind !== 'uniques' &&
            rule.kind !== 'topBottom' && rule.kind !== 'average' && rule.kind !== 'formula') return;
        setRule({ ...rule, format: { ...rule.format, ...patch } } as CFRuleSpec);
    };

    const currentFormat: CFStyle | undefined =
        (rule.kind === 'singleColor' || rule.kind === 'duplicates' || rule.kind === 'uniques' ||
         rule.kind === 'topBottom' || rule.kind === 'average' || rule.kind === 'formula')
            ? rule.format : undefined;

    return (
        <div style={ruleEditorStyle}>
            {/* Range */}
            <label style={labelStyle}>Apply to range</label>
            <input
                style={inputStyle}
                value={editing.range}
                onChange={e => setRange(e.target.value)}
                placeholder="e.g. A1:D100"
                spellCheck={false}
            />

            {/* Rule kind */}
            <label style={labelStyle}>Format cells if</label>
            <select
                style={{ ...inputStyle, cursor: 'pointer' }}
                value={rule.kind}
                onChange={e => setKind(e.target.value)}
            >
                {Object.entries(KIND_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                ))}
            </select>

            {/* Condition (singleColor) */}
            {rule.kind === 'singleColor' && (
                <>
                    <select
                        style={{ ...inputStyle, marginTop: 6, cursor: 'pointer' }}
                        value={rule.condition}
                        onChange={e => setRule({ ...rule, condition: e.target.value as CFConditionType })}
                    >
                        {Object.entries(CONDITION_LABELS).map(([k, label]) => (
                            <option key={k} value={k}>{label}</option>
                        ))}
                    </select>
                    {rule.condition !== 'isEmpty' && rule.condition !== 'isNotEmpty' &&
                     !rule.condition.startsWith('dateIs') && (
                        <input
                            style={{ ...inputStyle, marginTop: 6 }}
                            value={rule.value ?? ''}
                            onChange={e => setRule({ ...rule, value: e.target.value })}
                            placeholder="Value"
                        />
                    )}
                    {rule.condition === 'between' && (
                        <input
                            style={{ ...inputStyle, marginTop: 6 }}
                            value={rule.value2 ?? ''}
                            onChange={e => setRule({ ...rule, value2: e.target.value })}
                            placeholder="And value"
                        />
                    )}
                </>
            )}

            {/* Color scale options */}
            {rule.kind === 'colorScale' && (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
                    <ColorStop label="Min" color={rule.minColor} onChange={c => setRule({ ...rule, minColor: c })} />
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <span style={smallLabelStyle}>Mid (opt)</span>
                        <ColorPickerPopover color={rule.midColor ?? '#ffe599'} onChange={c => setRule({ ...rule, midColor: c })}>
                            <ColorSwatch color={rule.midColor ?? '#ffe599'} dashed={!rule.midColor} />
                        </ColorPickerPopover>
                        {rule.midColor && (
                            <button style={clearBtnStyle} onClick={() => setRule({ ...rule, midColor: undefined })}>×</button>
                        )}
                    </div>
                    <ColorStop label="Max" color={rule.maxColor} onChange={c => setRule({ ...rule, maxColor: c })} />
                </div>
            )}

            {/* Heat map options (item 14) */}
            {rule.kind === 'heatMap' && (
                <>
                    <select
                        style={{ ...inputStyle, marginTop: 8, cursor: 'pointer' }}
                        value={rule.preset}
                        onChange={e => {
                            const p = e.target.value as CFHeatMapPreset;
                            const preset = HEAT_MAP_PRESETS[p];
                            setRule({ kind: 'heatMap', preset: p, lowColor: preset.low, highColor: preset.high, midColor: preset.mid });
                        }}
                    >
                        {Object.entries(HEAT_MAP_PRESET_LABELS).map(([k, label]) => (
                            <option key={k} value={k}>{label}</option>
                        ))}
                    </select>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
                        <ColorStop label="Low"  color={rule.lowColor}         onChange={c => setRule({ ...rule, lowColor: c })} />
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <span style={smallLabelStyle}>Mid</span>
                            <ColorPickerPopover color={rule.midColor ?? '#ffffff'} onChange={c => setRule({ ...rule, midColor: c })}>
                                <ColorSwatch color={rule.midColor ?? '#ffffff'} dashed={!rule.midColor} />
                            </ColorPickerPopover>
                        </div>
                        <ColorStop label="High" color={rule.highColor}        onChange={c => setRule({ ...rule, highColor: c })} />
                    </div>
                </>
            )}

            {/* Data bar options */}
            {rule.kind === 'dataBar' && (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
                    <ColorStop label="Color" color={rule.color} onChange={c => setRule({ ...rule, color: c })} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={rule.gradient} onChange={e => setRule({ ...rule, gradient: e.target.checked })} />
                        Gradient
                    </label>
                </div>
            )}

            {/* Progress bar options (item 15) */}
            {rule.kind === 'progressBar' && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <label style={{ ...smallLabelStyle, width: 60 }}>Min value</label>
                        <input type="number" style={{ ...inputStyle, width: 80 }}
                            value={rule.minValue}
                            onChange={e => setRule({ ...rule, minValue: Number(e.target.value) } as CFProgressBarRule)} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <label style={{ ...smallLabelStyle, width: 60 }}>Max value</label>
                        <input type="number" style={{ ...inputStyle, width: 80 }}
                            value={rule.maxValue}
                            onChange={e => setRule({ ...rule, maxValue: Number(e.target.value) } as CFProgressBarRule)} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <ColorStop label="Color" color={rule.color} onChange={c => setRule({ ...rule, color: c } as CFProgressBarRule)} />
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                            <input type="checkbox" checked={rule.showLabel} onChange={e => setRule({ ...rule, showLabel: e.target.checked } as CFProgressBarRule)} />
                            Show % label
                        </label>
                    </div>
                </div>
            )}

            {/* Icon set options */}
            {rule.kind === 'iconSet' && (
                <select
                    style={{ ...inputStyle, marginTop: 8, cursor: 'pointer' }}
                    value={rule.iconSet}
                    onChange={e => setRule({ ...rule, iconSet: e.target.value as typeof rule.iconSet })}
                >
                    <option value="trafficLights">Traffic lights (🔴 🟡 🟢)</option>
                    <option value="arrows">Arrows (↓ → ↑)</option>
                    <option value="ratings">Ratings (⭐ ⭐⭐ ⭐⭐⭐)</option>
                </select>
            )}

            {/* Top/Bottom options */}
            {rule.kind === 'topBottom' && (
                <>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                        <select style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}
                            value={rule.direction}
                            onChange={e => setRule({ ...rule, direction: e.target.value as CFTopBottomRule['direction'] })}>
                            <option value="top">Top</option>
                            <option value="bottom">Bottom</option>
                        </select>
                        <input type="number" min={1} style={{ ...inputStyle, width: 64 }}
                            value={rule.value}
                            onChange={e => setRule({ ...rule, value: Math.max(1, Number(e.target.value)) })} />
                        <select style={{ ...inputStyle, width: 'auto', cursor: 'pointer' }}
                            value={rule.type}
                            onChange={e => setRule({ ...rule, type: e.target.value as CFTopBottomRule['type'] })}>
                            <option value="n">items</option>
                            <option value="percent">%</option>
                        </select>
                    </div>
                    {/* item 22 */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, cursor: 'pointer', color: 'var(--color-text-secondary, #555)' }}>
                        <input type="checkbox" checked={!!rule.visibleOnly}
                            onChange={e => setRule({ ...rule, visibleOnly: e.target.checked } as CFTopBottomRule)} />
                        Visible rows only (respects active filters)
                    </label>
                </>
            )}

            {/* Above/Below average options */}
            {rule.kind === 'average' && (
                <>
                    <select style={{ ...inputStyle, marginTop: 8, cursor: 'pointer' }}
                        value={rule.direction}
                        onChange={e => setRule({ ...rule, direction: e.target.value as CFAverageRule['direction'] })}>
                        <option value="above">Above average</option>
                        <option value="below">Below average</option>
                    </select>
                    {/* item 22 */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, cursor: 'pointer', color: 'var(--color-text-secondary, #555)' }}>
                        <input type="checkbox" checked={!!rule.visibleOnly}
                            onChange={e => setRule({ ...rule, visibleOnly: e.target.checked } as CFAverageRule)} />
                        Visible rows only (respects active filters)
                    </label>
                </>
            )}

            {/* Custom formula */}
            {rule.kind === 'formula' && (
                <>
                    <input
                        style={{ ...inputStyle, marginTop: 8, fontFamily: 'monospace' }}
                        value={rule.formula}
                        onChange={e => setRule({ ...rule, formula: e.target.value } as CFFormulaRule)}
                        placeholder="=A1>B1"
                        spellCheck={false}
                    />
                    <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--color-text-secondary, #888)' }}>
                        Formula must evaluate to TRUE/FALSE. Use $ to fix references (e.g. =$D1=&ldquo;Done&rdquo;).
                    </p>
                </>
            )}

            {/* Status indicator (item 16) */}
            {rule.kind === 'statusIndicator' && (
                <>
                    <select style={{ ...inputStyle, marginTop: 8, cursor: 'pointer' }}
                        value={rule.template}
                        onChange={e => setRule({ ...rule, template: e.target.value as CFStatusIndicatorTemplate })}>
                        {Object.entries(STATUS_TEMPLATE_LABELS).map(([k, label]) => (
                            <option key={k} value={k}>{label}</option>
                        ))}
                    </select>
                    <StatusIndicatorPreview template={rule.template as CFStatusIndicatorRule['template']} />
                </>
            )}

            {/* Theme color (item 18) */}
            {rule.kind === 'themeColor' && (
                <>
                    <select style={{ ...inputStyle, marginTop: 6, cursor: 'pointer' }}
                        value={rule.condition}
                        onChange={e => setRule({ ...rule, condition: e.target.value as CFConditionType } as CFThemeColorRule)}>
                        {Object.entries(CONDITION_LABELS).map(([k, label]) => (
                            <option key={k} value={k}>{label}</option>
                        ))}
                    </select>
                    {rule.condition !== 'isEmpty' && rule.condition !== 'isNotEmpty' &&
                     !rule.condition.startsWith('dateIs') && (
                        <input style={{ ...inputStyle, marginTop: 6 }}
                            value={rule.value ?? ''}
                            onChange={e => setRule({ ...rule, value: e.target.value } as CFThemeColorRule)}
                            placeholder="Value" />
                    )}
                    <select style={{ ...inputStyle, marginTop: 6, cursor: 'pointer' }}
                        value={rule.token}
                        onChange={e => setRule({ ...rule, token: e.target.value as CFThemeToken } as CFThemeColorRule)}>
                        {Object.entries(THEME_TOKEN_LABELS).map(([k, label]) => (
                            <option key={k} value={k}>{label}</option>
                        ))}
                    </select>
                </>
            )}

            {/* Variable reference (item 19) */}
            {rule.kind === 'variable' && (
                variables.length === 0 ? (
                    <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--color-text-secondary, #888)' }}>
                        No variables defined yet. Use the Variables tab to create one.
                    </p>
                ) : (
                    <select style={{ ...inputStyle, marginTop: 8, cursor: 'pointer' }}
                        value={rule.variableName}
                        onChange={e => setRule({ kind: 'variable', variableName: e.target.value })}>
                        {variables.map(v => (
                            <option key={v.name} value={v.name}>{v.name}{v.description ? ` — ${v.description}` : ''}</option>
                        ))}
                    </select>
                )
            )}

            {/* Format style picker (singleColor / duplicates / uniques / topBottom / average / formula) */}
            {currentFormat && (
                <div style={{ marginTop: 12 }}>
                    <label style={labelStyle}>Formatting style</label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <ColorStop label="Fill" color={currentFormat.backgroundColor ?? '#ffffff'} onChange={c => setFormat({ backgroundColor: c })} />
                        <ColorStop label="Text" color={currentFormat.color ?? '#000000'} onChange={c => setFormat({ color: c })} />
                        <FormatToggle label="B" active={currentFormat.fontWeight === 'bold'} style={{ fontWeight: 'bold' }}
                            onClick={() => setFormat({ fontWeight: currentFormat.fontWeight === 'bold' ? 'normal' : 'bold' })} />
                        <FormatToggle label="I" active={currentFormat.fontStyle === 'italic'} style={{ fontStyle: 'italic' }}
                            onClick={() => setFormat({ fontStyle: currentFormat.fontStyle === 'italic' ? 'normal' : 'italic' })} />
                        <FormatToggle label="U" active={currentFormat.textDecoration === 'underline'} style={{ textDecoration: 'underline' }}
                            onClick={() => setFormat({ textDecoration: currentFormat.textDecoration === 'underline' ? 'none' : 'underline' })} />
                    </div>
                    <div style={{
                        marginTop: 10, padding: '4px 10px', borderRadius: 4, display: 'inline-block',
                        backgroundColor: currentFormat.backgroundColor ?? 'transparent',
                        color: currentFormat.color ?? '#000000',
                        fontWeight: currentFormat.fontWeight ?? 'normal',
                        fontStyle: currentFormat.fontStyle ?? 'normal',
                        textDecoration: currentFormat.textDecoration ?? 'none',
                        border: '1px solid rgba(0,0,0,0.12)',
                        fontSize: 12,
                    }}>
                        Preview
                    </div>
                </div>
            )}

            {/* item 13: stop if true */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 11, cursor: 'pointer', color: 'var(--color-text-secondary, #555)' }}>
                <input type="checkbox" checked={!!editing.stopIfTrue} onChange={e => setStopIfTrue(e.target.checked)} />
                Stop if true (don&apos;t evaluate lower-priority rules for matching cells)
            </label>
        </div>
    );
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function ColorStop({ label, color, onChange }: { label: string; color: string; onChange: (c: string) => void }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={smallLabelStyle}>{label}</span>
            <ColorPickerPopover color={color} onChange={onChange}>
                <ColorSwatch color={color} />
            </ColorPickerPopover>
        </div>
    );
}

function ColorSwatch({ color, dashed }: { color: string; dashed?: boolean }) {
    return (
        <div style={{
            width: 24, height: 24, borderRadius: 4,
            backgroundColor: color,
            border: dashed ? '2px dashed #aaa' : '1px solid rgba(0,0,0,0.2)',
            cursor: 'pointer',
        }} />
    );
}

function FormatToggle({ label, active, style, onClick }: {
    label: string; active: boolean; style?: React.CSSProperties; onClick: () => void;
}) {
    return (
        <button onClick={onClick} style={{
            width: 28, height: 28, borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 13,
            backgroundColor: active ? 'var(--color-primary, #1a73e8)' : 'var(--color-surface-2, #f1f3f4)',
            color: active ? '#fff' : 'inherit',
            ...style,
        }}>
            {label}
        </button>
    );
}

const STATUS_PREVIEW_DATA: Record<CFStatusIndicatorTemplate, Array<{ label: string; bg: string; fg: string }>> = {
    projectStatus: [
        { label: 'Not Started', bg: '#e8eaed', fg: '#5f6368' },
        { label: 'In Progress', bg: '#cfe2ff', fg: '#084298' },
        { label: 'Blocked',     bg: '#fce8e6', fg: '#c5221f' },
        { label: 'Done',        bg: '#e6f4ea', fg: '#137333' },
    ],
    priority: [
        { label: 'Low',      bg: '#e6f4ea', fg: '#137333' },
        { label: 'Medium',   bg: '#fef9e7', fg: '#9c6500' },
        { label: 'High',     bg: '#fce8e6', fg: '#c5221f' },
        { label: 'Critical', bg: '#c5221f', fg: '#ffffff' },
    ],
    approval: [
        { label: 'Pending',  bg: '#fef9e7', fg: '#9c6500' },
        { label: 'Approved', bg: '#e6f4ea', fg: '#137333' },
        { label: 'Rejected', bg: '#fce8e6', fg: '#c5221f' },
    ],
};

function StatusIndicatorPreview({ template }: { template: CFStatusIndicatorTemplate }) {
    const items = STATUS_PREVIEW_DATA[template] ?? [];
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {items.map(it => (
                <span key={it.label} style={{
                    padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 500,
                    backgroundColor: it.bg, color: it.fg,
                }}>
                    {it.label}
                </span>
            ))}
        </div>
    );
}

// ── Variables panel (item 19) ─────────────────────────────────────────────────

type VarPanelProps = { variables: CFVariable[]; onChange: (v: CFVariable[]) => void };

function VariablesPanel({ variables, onChange }: VarPanelProps) {
    const [newName, setNewName] = useState('');
    const [newDesc, setNewDesc] = useState('');

    const addVariable = () => {
        const name = newName.trim();
        if (!name || variables.some(v => v.name === name)) return;
        const rule: CFVariable['rule'] = { kind: 'singleColor', condition: 'greaterThan', value: '0', format: { backgroundColor: '#b7e1cd', color: '#0f5132' } };
        onChange([...variables, { name, description: newDesc.trim() || undefined, rule }]);
        setNewName(''); setNewDesc('');
    };

    return (
        <div style={{ padding: '8px 12px' }}>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary, #888)', margin: '0 0 8px' }}>
                Named variables let you define a rule once and reuse it across multiple ranges.
            </p>
            {variables.map((v, i) => (
                <div key={v.name} style={{ ...ruleEditorStyle, marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 600, fontSize: 12 }}>{v.name}</span>
                        <button style={clearBtnStyle} title="Delete variable"
                            onClick={() => onChange(variables.filter((_, j) => j !== i))}>
                            <Trash2 size={13} />
                        </button>
                    </div>
                    {v.description && <p style={{ margin: '2px 0 4px', fontSize: 10, color: 'var(--color-text-secondary, #888)' }}>{v.description}</p>}
                    <span style={{ fontSize: 10, color: 'var(--color-text-secondary, #888)' }}>{KIND_LABELS[v.rule.kind] ?? v.rule.kind}</span>
                </div>
            ))}
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={labelStyle}>New variable name</label>
                <input style={inputStyle} value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. HighRevenue" />
                <input style={{ ...inputStyle, marginTop: 4 }} value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description (optional)" />
                <button style={{ ...addBtnStyle, marginTop: 4, alignSelf: 'flex-start' }} onClick={addVariable}>
                    <Plus size={13} style={{ marginRight: 4 }} /> Add variable
                </button>
                <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--color-text-secondary, #888)' }}>
                    After adding, use a &ldquo;Named variable&rdquo; rule to apply it to any range.
                </p>
            </div>
        </div>
    );
}

// ── Templates panel (item 20) ─────────────────────────────────────────────────

type TemplatePanelProps = {
    templates: CFTemplate[];
    editingRules: EditingRule[];
    onApply: (t: CFTemplate) => void;
    onDelete: (id: string) => void;
    onSave: (name: string) => void;
};

function TemplatesPanel({ templates, editingRules, onApply, onDelete, onSave }: TemplatePanelProps) {
    const [newName, setNewName] = useState('');

    return (
        <div style={{ padding: '8px 12px' }}>
            <p style={{ fontSize: 11, color: 'var(--color-text-secondary, #888)', margin: '0 0 8px' }}>
                Save the current rules as a template to reuse across sheets.
            </p>
            {templates.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--color-text-secondary, #888)', textAlign: 'center', marginTop: 16 }}>
                    No saved templates.
                </p>
            )}
            {templates.map(t => (
                <div key={t.id} style={{ ...ruleEditorStyle, marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 12, flexGrow: 1 }}>{t.name}</span>
                        <span style={{ fontSize: 10, color: 'var(--color-text-secondary, #888)' }}>{t.rules.length} rule{t.rules.length !== 1 ? 's' : ''}</span>
                        <button style={{ ...clearBtnStyle, padding: '2px 4px' }} title="Apply template"
                            onClick={() => onApply(t)}>
                            <FolderOpen size={13} />
                        </button>
                        <button style={{ ...clearBtnStyle, padding: '2px 4px' }} title="Delete template"
                            onClick={() => onDelete(t.id)}>
                            <Trash2 size={13} />
                        </button>
                    </div>
                </div>
            ))}
            <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input style={{ ...inputStyle, flex: 1 }} value={newName} onChange={e => setNewName(e.target.value)}
                    placeholder="Template name" disabled={editingRules.length === 0} />
                <button
                    style={{
                        ...primaryBtnStyle, display: 'flex', alignItems: 'center', gap: 4,
                        opacity: (!newName.trim() || editingRules.length === 0) ? 0.5 : 1,
                    }}
                    disabled={!newName.trim() || editingRules.length === 0}
                    onClick={() => { onSave(newName.trim()); setNewName(''); }}
                >
                    <Save size={12} /> Save
                </button>
            </div>
        </div>
    );
}

// ── Item 21: Smart suggestions panel ─────────────────────────────────────────

function SmartSuggestions({ suggestions, onApply }: {
    suggestions: Suggestion[];
    onApply: (rule: CFRule) => void;
}) {
    if (suggestions.length === 0) return null;
    return (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border, #e8eaed)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                <Sparkles size={13} style={{ color: 'var(--color-primary, #1a73e8)' }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary, #555)' }}>
                    Suggestions for this column
                </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {suggestions.map(s => (
                    <button
                        key={s.label}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                            borderRadius: 6, border: '1px solid var(--color-border, #e0e0e0)',
                            background: 'var(--color-surface, #fff)', cursor: 'pointer', textAlign: 'left',
                        }}
                        onClick={() => onApply(s.buildRule('A1:A100'))}
                    >
                        <span style={{ fontSize: 16 }}>{s.icon}</span>
                        <div>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{s.label}</div>
                            <div style={{ fontSize: 10, color: 'var(--color-text-secondary, #888)' }}>{s.description}</div>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}

// ── Item 23: AI rule builder panel ────────────────────────────────────────────

function AiRuleBuilderPanel({ selectionRange, onAddRule }: {
    selectionRange?: string;
    onAddRule: (rule: CFRule) => void;
}) {
    const [prompt, setPrompt] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [preview, setPreview] = useState<{ rule: CFRuleSpec; explanation: string } | null>(null);

    const generate = useCallback(async () => {
        if (!prompt.trim()) return;
        setLoading(true);
        setError(null);
        setPreview(null);
        try {
            const result = await callAiRuleBuilder(prompt.trim());
            setPreview(result);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to generate rule');
        } finally {
            setLoading(false);
        }
    }, [prompt]);

    const applyRule = () => {
        if (!preview) return;
        const id = Math.random().toString(36).slice(2, 10);
        onAddRule({ id, range: selectionRange ?? 'A1:A100', rule: preview.rule });
        setPreview(null);
        setPrompt('');
    };

    return (
        <div style={{ padding: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Wand2 size={14} style={{ color: 'var(--color-primary, #1a73e8)' }} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>Describe your rule in plain English</span>
            </div>
            <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--color-text-secondary, #888)' }}>
                Examples: &ldquo;Highlight cells where revenue is over 10,000&rdquo;, &ldquo;Red for customers who haven&apos;t ordered in 90 days&rdquo;, &ldquo;Yellow for tasks due this week&rdquo;
            </p>
            <textarea
                style={{
                    ...inputStyle, resize: 'vertical', minHeight: 72, fontFamily: 'inherit',
                    lineHeight: 1.4,
                }}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="e.g. Highlight overdue tasks in red"
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
            />
            <button
                style={{
                    ...primaryBtnStyle, marginTop: 8, display: 'flex', alignItems: 'center', gap: 5,
                    opacity: (!prompt.trim() || loading) ? 0.6 : 1,
                }}
                disabled={!prompt.trim() || loading}
                onClick={generate}
            >
                <Wand2 size={12} />
                {loading ? 'Generating…' : 'Generate rule'}
            </button>

            {error && (
                <div style={{
                    marginTop: 10, padding: '8px 10px', borderRadius: 4, fontSize: 12,
                    backgroundColor: '#fce8e6', color: '#c5221f',
                }}>
                    {error}
                    {error.includes('API key') && (
                        <span> Configure it in <strong>Settings → AI Assistant</strong>.</span>
                    )}
                </div>
            )}

            {preview && (
                <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 6, border: '1px solid var(--color-border, #e0e0e0)', background: 'var(--color-surface-2, #f8f9fa)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary, #555)' }}>Generated rule</span>
                        <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 10, background: '#e6f4ea', color: '#137333' }}>
                            {preview.rule.kind}
                        </span>
                    </div>
                    <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--color-text, #000)' }}>
                        {preview.explanation}
                    </p>
                    {preview.rule.kind === 'formula' && (
                        <code style={{ display: 'block', fontSize: 11, padding: '4px 6px', background: 'var(--color-surface, #fff)', borderRadius: 4, border: '1px solid var(--color-border, #ddd)', marginBottom: 8 }}>
                            {preview.rule.formula}
                        </code>
                    )}
                    {'format' in preview.rule && preview.rule.format && (
                        <div style={{
                            display: 'inline-block', padding: '3px 10px', borderRadius: 4, fontSize: 12,
                            backgroundColor: (preview.rule.format as CFStyle).backgroundColor ?? 'transparent',
                            color: (preview.rule.format as CFStyle).color ?? '#000',
                            border: '1px solid rgba(0,0,0,0.1)', marginBottom: 8,
                        }}>
                            Preview
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button style={primaryBtnStyle} onClick={applyRule}>Add to rules</button>
                        <button style={secondaryBtnStyle} onClick={() => setPreview(null)}>Discard</button>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

type TabId = 'rules' | 'variables' | 'templates' | 'ai';

export function ConditionalFormattingDialog({ rules, selectionRange, onUpdate, onClose, data }: Props) {
    const [editingRules, setEditingRules] = useState<EditingRule[]>(() =>
        rules.length > 0 ? rules.map(r => ({ ...r })) : []
    );
    const [expandedId, setExpandedId] = useState<string | null>(
        rules.length > 0 ? rules[0].id : null
    );
    const [activeTab, setActiveTab] = useState<TabId>('rules');
    const [variables, setVariables] = useState<CFVariable[]>(() => loadVariables());
    const [templates, setTemplates] = useState<CFTemplate[]>(() => loadTemplates());

    // item 21: detect column type from selection and build suggestions
    const suggestions: Suggestion[] = React.useMemo(() => {
        if (!data || !selectionRange) return [];
        const type = detectColumnType(data, selectionRange);
        return makeSuggestions(type);
    }, [data, selectionRange]);

    const addRule = (preset?: CFRule) => {
        const r: EditingRule = preset
            ? { ...preset, range: selectionRange ?? preset.range }
            : (() => { const d = defaultRule(); if (selectionRange) d.range = selectionRange; return d; })();
        setEditingRules(prev => [...prev, r]);
        setExpandedId(r.id);
        setActiveTab('rules');
    };

    const deleteRule = (id: string) => {
        setEditingRules(prev => prev.filter(r => r.id !== id));
        if (expandedId === id) setExpandedId(null);
    };

    const updateRule = (updated: EditingRule) => {
        setEditingRules(prev => prev.map(r => r.id === updated.id ? updated : r));
    };

    // item 12: move rule up/down in priority order
    const moveRule = (id: string, dir: -1 | 1) => {
        setEditingRules(prev => {
            const idx = prev.findIndex(r => r.id === id);
            if (idx === -1) return prev;
            const next = idx + dir;
            if (next < 0 || next >= prev.length) return prev;
            const copy = [...prev];
            [copy[idx], copy[next]] = [copy[next], copy[idx]];
            return copy;
        });
    };

    const handleDone = () => {
        onUpdate(editingRules.map(r => ({ id: r.id, range: r.range, rule: r.rule, stopIfTrue: r.stopIfTrue })));
        onClose();
    };

    const handleVariablesChange = (v: CFVariable[]) => {
        setVariables(v);
        saveVariables(v);
    };

    const handleSaveTemplate = (name: string) => {
        const t: CFTemplate = {
            id: makeId(),
            name,
            rules: editingRules.map(r => ({ range: r.range, rule: r.rule, stopIfTrue: r.stopIfTrue })),
        };
        const updated = [...templates, t];
        setTemplates(updated);
        saveTemplates(updated);
    };

    const handleApplyTemplate = (t: CFTemplate) => {
        const newRules: EditingRule[] = t.rules.map(r => ({
            id: makeId(),
            range: selectionRange ?? r.range,
            rule: r.rule,
            stopIfTrue: r.stopIfTrue,
        }));
        setEditingRules(prev => [...prev, ...newRules]);
    };

    const handleDeleteTemplate = (id: string) => {
        const updated = templates.filter(t => t.id !== id);
        setTemplates(updated);
        saveTemplates(updated);
    };

    return (
        <div style={overlayStyle}>
            <div style={panelStyle}>
                {/* Header */}
                <div style={headerStyle}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Conditional formatting</span>
                    <button style={closeBtnStyle} onClick={onClose} title="Close">
                        <X size={16} />
                    </button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border, #e0e0e0)' }}>
                    {(['rules', 'ai', 'variables', 'templates'] as TabId[]).map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} style={{
                            flex: 1, padding: '8px 2px', border: 'none', cursor: 'pointer', fontSize: 11,
                            background: 'none', fontWeight: activeTab === tab ? 600 : 'normal',
                            color: activeTab === tab ? 'var(--color-primary, #1a73e8)' : 'var(--color-text-secondary, #555)',
                            borderBottom: activeTab === tab ? '2px solid var(--color-primary, #1a73e8)' : '2px solid transparent',
                        }}>
                            {tab === 'rules'     ? `Rules (${editingRules.length})` :
                             tab === 'ai'        ? '✨ AI' :
                             tab === 'variables' ? `Vars (${variables.length})` :
                                                   `Templates (${templates.length})`}
                        </button>
                    ))}
                </div>

                {/* Tab content */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {activeTab === 'rules' && (
                        <>
                        {/* item 21: smart suggestions above the rule list */}
                        <SmartSuggestions suggestions={suggestions} onApply={addRule} />
                        <div style={{ padding: '8px 12px' }}>
                            {editingRules.length === 0 && suggestions.length === 0 && (
                                <p style={{ color: 'var(--color-text-secondary, #888)', fontSize: 12, textAlign: 'center', marginTop: 24 }}>
                                    No rules yet. Click &ldquo;Add rule&rdquo; below.
                                </p>
                            )}
                            {editingRules.length === 0 && suggestions.length > 0 && (
                                <p style={{ color: 'var(--color-text-secondary, #888)', fontSize: 12, textAlign: 'center', marginTop: 12 }}>
                                    Apply a suggestion above or click &ldquo;Add rule&rdquo; to create a custom rule.
                                </p>
                            )}
                            {editingRules.map((r, idx) => (
                                <div key={r.id}>
                                    {/* item 11/12: rule row with priority controls */}
                                    <div style={ruleRowStyle} onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginRight: 2 }}>
                                            <button style={iconBtnStyle} title="Move up" disabled={idx === 0}
                                                onClick={e => { e.stopPropagation(); moveRule(r.id, -1); }}>
                                                <ChevronUp size={11} />
                                            </button>
                                            <button style={iconBtnStyle} title="Move down" disabled={idx === editingRules.length - 1}
                                                onClick={e => { e.stopPropagation(); moveRule(r.id, 1); }}>
                                                <ChevronDown size={11} />
                                            </button>
                                        </div>
                                        <span style={{ fontSize: 12, flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            <strong>{KIND_LABELS[r.rule.kind] ?? r.rule.kind}</strong>
                                            <span style={{ color: 'var(--color-text-secondary, #666)', marginLeft: 6 }}>{r.range}</span>
                                            {r.stopIfTrue && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--color-primary, #1a73e8)' }}>⏹ stop</span>}
                                        </span>
                                        <button style={{ ...clearBtnStyle, padding: '2px 4px' }}
                                            onClick={e => { e.stopPropagation(); deleteRule(r.id); }}
                                            title="Delete rule">
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                    {expandedId === r.id && (
                                        <RuleEditor rule={r} variables={variables} onChange={updateRule} />
                                    )}
                                </div>
                            ))}
                        </div>
                        </>
                    )}

                    {activeTab === 'ai' && (
                        <AiRuleBuilderPanel selectionRange={selectionRange} onAddRule={addRule} />
                    )}

                    {activeTab === 'variables' && (
                        <VariablesPanel variables={variables} onChange={handleVariablesChange} />
                    )}

                    {activeTab === 'templates' && (
                        <TemplatesPanel
                            templates={templates}
                            editingRules={editingRules}
                            onApply={handleApplyTemplate}
                            onDelete={handleDeleteTemplate}
                            onSave={handleSaveTemplate}
                        />
                    )}
                </div>

                {/* Footer */}
                {activeTab === 'rules' && (
                    <div style={footerStyle}>
                        <button style={addBtnStyle} onClick={() => addRule()}>
                            <Plus size={13} style={{ marginRight: 4 }} />
                            Add rule
                        </button>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button style={secondaryBtnStyle} onClick={onClose}>Cancel</button>
                            <button style={primaryBtnStyle} onClick={handleDone}>Done</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 600,
    color: 'var(--color-text-secondary, #555)', marginBottom: 4, marginTop: 10,
};

const smallLabelStyle: React.CSSProperties = {
    fontSize: 10, color: 'var(--color-text-tertiary, #888)',
};

const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '5px 8px',
    border: '1px solid var(--color-border, #ddd)', borderRadius: 4,
    fontSize: 12, background: 'var(--color-surface, #fff)',
    color: 'var(--color-text, #000)',
};

const clearBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--color-text-secondary, #555)', fontSize: 14, padding: 0,
};

const iconBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer', padding: 1,
    color: 'var(--color-text-secondary, #888)', display: 'flex', alignItems: 'center',
    lineHeight: 1,
};

const ruleEditorStyle: React.CSSProperties = {
    padding: '10px 12px', border: '1px solid var(--color-border, #e0e0e0)',
    borderRadius: 6, background: 'var(--color-surface-2, #f8f9fa)',
    marginBottom: 8,
};

const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 200,
    pointerEvents: 'none',
};

const panelStyle: React.CSSProperties = {
    position: 'absolute', right: 0, top: 0, bottom: 0,
    width: 340, display: 'flex', flexDirection: 'column',
    background: 'var(--color-surface, #fff)',
    borderLeft: '1px solid var(--color-border, #e0e0e0)',
    boxShadow: '-4px 0 16px rgba(0,0,0,0.1)',
    pointerEvents: 'all',
};

const headerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 14px', borderBottom: '1px solid var(--color-border, #e0e0e0)',
};

const closeBtnStyle: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--color-text-secondary, #555)', display: 'flex', padding: 2,
};

const ruleRowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 4px', cursor: 'pointer', borderRadius: 4,
    marginBottom: 2,
};

const footerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 12px', borderTop: '1px solid var(--color-border, #e0e0e0)',
};

const addBtnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', background: 'none', border: 'none',
    cursor: 'pointer', fontSize: 12, color: 'var(--color-primary, #1a73e8)',
    padding: '4px 6px', borderRadius: 4, fontWeight: 600,
};

const primaryBtnStyle: React.CSSProperties = {
    padding: '5px 14px', borderRadius: 4, border: 'none', cursor: 'pointer',
    background: 'var(--color-primary, #1a73e8)', color: '#fff', fontSize: 12, fontWeight: 600,
};

const secondaryBtnStyle: React.CSSProperties = {
    padding: '5px 14px', borderRadius: 4,
    border: '1px solid var(--color-border, #ddd)', cursor: 'pointer',
    background: 'transparent', fontSize: 12,
    color: 'var(--color-text, #000)',
};
