import { alphaToNum, numToAlpha } from './utils';
import type { CellProps, CFRule, CFSingleColorRule, CFStyle, CFVariable, CFHeatMapPreset, CFThemeToken } from './types';

// ── Formula evaluator (features 8 & 9: formula rules + relative/abs refs) ─────

type FVal = number | string | boolean | null;

interface FormulaCtx {
    data: Map<string, CellProps>;
    cellRow: number;  // 1-based row of the cell being evaluated
    cellCol: number;  // 1-based col of the cell being evaluated
    baseRow: number;  // 1-based row of the range anchor (first cell)
    baseCol: number;  // 1-based col of the range anchor
}

function cellFVal(data: Map<string, CellProps>, col: number, row: number): FVal {
    if (col < 1 || row < 1) return null;
    const cell = data.get(`${numToAlpha(col)}${row}`);
    const raw = cell?.value ?? cell?.raw ?? '';
    if (raw === '') return null;
    const n = Number(raw);
    if (!isNaN(n)) return n;
    if (raw.toLowerCase() === 'true') return true;
    if (raw.toLowerCase() === 'false') return false;
    return raw;
}

function rangeVals(data: Map<string, CellProps>, c1: number, r1: number, c2: number, r2: number): FVal[] {
    const vals: FVal[] = [];
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++)
        for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++)
            vals.push(cellFVal(data, c, r));
    return vals;
}

function fToNum(v: FVal): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') { const n = Number(v); return isNaN(n) ? 0 : n; }
    return 0;
}

function fEq(a: FVal, b: FVal): boolean {
    if (typeof a === 'string' && typeof b === 'string')
        return a.toLowerCase() === b.toLowerCase();
    if (typeof a === 'number' || typeof b === 'number')
        return fToNum(a) === fToNum(b);
    return a === b;
}

type Token =
    | { k: 'num'; v: number }
    | { k: 'str'; v: string }
    | { k: 'ref'; col: number; row: number; absCol: boolean; absRow: boolean }
    | { k: 'ident'; v: string }
    | { k: 'op'; v: string }
    | { k: 'lp' }
    | { k: 'rp' }
    | { k: 'comma' }
    | { k: 'colon' };

function tokenizeFormula(src: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < src.length) {
        if (/\s/.test(src[i])) { i++; continue; }
        const two = src.slice(i, i + 2);
        if (two === '<>' || two === '>=' || two === '<=') { tokens.push({ k: 'op', v: two }); i += 2; continue; }
        if ('+-*/=><&'.includes(src[i])) { tokens.push({ k: 'op', v: src[i] }); i++; continue; }
        if (src[i] === '(') { tokens.push({ k: 'lp' }); i++; continue; }
        if (src[i] === ')') { tokens.push({ k: 'rp' }); i++; continue; }
        if (src[i] === ',') { tokens.push({ k: 'comma' }); i++; continue; }
        if (src[i] === ':') { tokens.push({ k: 'colon' }); i++; continue; }
        if (src[i] === '"') {
            i++;
            let s = '';
            while (i < src.length && src[i] !== '"') {
                if (src[i] === '\\' && i + 1 < src.length) i++;
                s += src[i++];
            }
            if (i < src.length) i++;
            tokens.push({ k: 'str', v: s });
            continue;
        }
        if (/[0-9]/.test(src[i]) || (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
            const start = i;
            while (i < src.length && /[0-9.]/.test(src[i])) i++;
            if (i < src.length && (src[i] === 'e' || src[i] === 'E')) {
                i++;
                if (i < src.length && (src[i] === '+' || src[i] === '-')) i++;
                while (i < src.length && /[0-9]/.test(src[i])) i++;
            }
            tokens.push({ k: 'num', v: parseFloat(src.slice(start, i)) });
            continue;
        }
        if (src[i] === '$' || /[A-Za-z]/.test(src[i])) {
            let absCol = false;
            if (src[i] === '$') { absCol = true; i++; }
            const colStart = i;
            while (i < src.length && /[A-Za-z]/.test(src[i])) i++;
            const letters = src.slice(colStart, i);
            let absRow = false;
            if (i < src.length && src[i] === '$') { absRow = true; i++; }
            if (i < src.length && /[0-9]/.test(src[i])) {
                const rowStart = i;
                while (i < src.length && /[0-9]/.test(src[i])) i++;
                tokens.push({ k: 'ref', col: alphaToNum(letters.toUpperCase()), row: parseInt(src.slice(rowStart, i)), absCol, absRow });
            } else {
                tokens.push({ k: 'ident', v: letters.toUpperCase() });
            }
            continue;
        }
        i++;
    }
    return tokens;
}

function callBuiltIn(name: string, args: (FVal | FVal[])[], ctx: FormulaCtx): FVal {
    const flat = (v: FVal | FVal[] | undefined): FVal[] => {
        if (v === undefined) return [];
        return Array.isArray(v) ? v : [v];
    };
    const sa = (i: number): FVal => flat(args[i])[0] ?? null;
    const na = (i: number): number => fToNum(sa(i));
    const allVals = args.flatMap(a => flat(a));
    const allNums = allVals.filter((v): v is number => typeof v === 'number' && !isNaN(v));

    switch (name) {
        case 'AND': return args.every(a => flat(a).every(v => !!v));
        case 'OR':  return args.some(a => flat(a).some(v => !!v));
        case 'NOT': return !flat(args[0])[0];
        case 'IF': {
            const cond = flat(args[0])[0];
            return cond ? (sa(1)) : (sa(2));
        }
        case 'MOD': {
            const b = na(1);
            return b === 0 ? null : na(0) % b;
        }
        case 'ROW':    return ctx.cellRow;
        case 'COLUMN': return ctx.cellCol;
        case 'TODAY':  return Math.floor(Date.now() / 86400000) + 25569;
        case 'NOW':    return Date.now() / 86400000 + 25569;
        case 'SUM':    return allNums.reduce((a, b) => a + b, 0);
        case 'AVERAGE': return allNums.length === 0 ? null : allNums.reduce((a, b) => a + b, 0) / allNums.length;
        case 'MAX': return allNums.length === 0 ? null : Math.max(...allNums);
        case 'MIN': return allNums.length === 0 ? null : Math.min(...allNums);
        case 'COUNT':  return allNums.length;
        case 'COUNTA': return allVals.filter(v => v !== null && v !== '').length;
        case 'LEN':    return String(sa(0) ?? '').length;
        case 'TRIM':   return String(sa(0) ?? '').trim();
        case 'UPPER':  return String(sa(0) ?? '').toUpperCase();
        case 'LOWER':  return String(sa(0) ?? '').toLowerCase();
        case 'LEFT':  { const s = String(sa(0) ?? ''); return s.slice(0, Math.max(0, na(1) || 1)); }
        case 'RIGHT': { const s = String(sa(0) ?? ''); return s.slice(Math.max(0, s.length - (na(1) || 1))); }
        case 'MID':   { const s = String(sa(0) ?? ''); const st = na(1) - 1; return s.slice(Math.max(0, st), Math.max(0, st) + Math.max(0, na(2))); }
        case 'ISNUMBER': return typeof sa(0) === 'number';
        case 'ISBLANK':  { const v = sa(0); return v === null || v === ''; }
        case 'ISTEXT':   return typeof sa(0) === 'string';
        case 'ABS':    return Math.abs(na(0));
        case 'ROUND':  return parseFloat(na(0).toFixed(Math.max(0, na(1))));
        case 'FLOOR':  { const s = na(1) || 1; return s === 0 ? null : Math.floor(na(0) / s) * s; }
        case 'CEILING':{ const s = na(1) || 1; return s === 0 ? null : Math.ceil(na(0) / s) * s; }
        case 'CONCATENATE': return allVals.map(v => String(v ?? '')).join('');
        case 'EXACT':  return String(sa(0) ?? '') === String(sa(1) ?? '');
        case 'FIND':
        case 'SEARCH': {
            const needle = String(sa(0) ?? '').toLowerCase();
            const haystack = String(sa(1) ?? '').toLowerCase();
            const idx = haystack.indexOf(needle, Math.max(0, na(2) - 1));
            return idx === -1 ? null : idx + 1;
        }
        case 'SUBSTITUTE': {
            const text = String(sa(0) ?? '');
            const old  = String(sa(1) ?? '');
            const rep  = String(sa(2) ?? '');
            return old === '' ? text : text.split(old).join(rep);
        }
        default: return null;
    }
}

function evalFormula(formula: string, ctx: FormulaCtx): boolean {
    const src = formula.startsWith('=') ? formula.slice(1) : formula;
    const tokens = tokenizeFormula(src.trim());
    let pos = 0;

    const peek = (): Token | undefined => tokens[pos];
    const consume = (): Token => tokens[pos++];
    const expect = (k: string) => { if (peek()?.k === k) pos++; };

    function resolveRef(col: number, row: number, absCol: boolean, absRow: boolean): [number, number] {
        return [
            absCol ? col : col + (ctx.cellCol - ctx.baseCol),
            absRow ? row : row + (ctx.cellRow - ctx.baseRow),
        ];
    }

    function parseFormula(): FVal { return parseCompare(); }

    function parseCompare(): FVal {
        let left = parseConcat();
        while (true) {
            const t = peek();
            if (t?.k !== 'op') break;
            const op = t.v;
            if (!['<>', '>=', '<=', '>', '<', '='].includes(op)) break;
            pos++;
            const right = parseConcat();
            if (op === '=')  left = fEq(left, right);
            else if (op === '<>') left = !fEq(left, right);
            else if (op === '>')  left = fToNum(left) > fToNum(right);
            else if (op === '<')  left = fToNum(left) < fToNum(right);
            else if (op === '>=') left = fToNum(left) >= fToNum(right);
            else if (op === '<=') left = fToNum(left) <= fToNum(right);
        }
        return left;
    }

    function parseConcat(): FVal {
        let left = parseAddSub();
        while (peek()?.k === 'op' && (peek() as { k: 'op'; v: string }).v === '&') {
            pos++;
            const right = parseAddSub();
            left = String(left ?? '') + String(right ?? '');
        }
        return left;
    }

    function parseAddSub(): FVal {
        let left = parseMulDiv();
        while (peek()?.k === 'op') {
            const op = (peek() as { k: 'op'; v: string }).v;
            if (op !== '+' && op !== '-') break;
            pos++;
            const right = parseMulDiv();
            left = op === '+' ? fToNum(left) + fToNum(right) : fToNum(left) - fToNum(right);
        }
        return left;
    }

    function parseMulDiv(): FVal {
        let left = parseUnary();
        while (peek()?.k === 'op') {
            const op = (peek() as { k: 'op'; v: string }).v;
            if (op !== '*' && op !== '/') break;
            pos++;
            const right = parseUnary();
            if (op === '*') left = fToNum(left) * fToNum(right);
            else { const d = fToNum(right); left = d === 0 ? null : fToNum(left) / d; }
        }
        return left;
    }

    function parseUnary(): FVal {
        if (peek()?.k === 'op' && (peek() as { k: 'op'; v: string }).v === '-') { pos++; return -fToNum(parseAtom()); }
        if (peek()?.k === 'op' && (peek() as { k: 'op'; v: string }).v === '+') { pos++; return parseAtom(); }
        return parseAtom();
    }

    // Parse a single argument; if it's `ref:ref`, return the range as FVal[].
    function parseArg(): FVal | FVal[] {
        if (peek()?.k === 'ref') {
            const savedPos = pos;
            const t1 = consume() as { k: 'ref'; col: number; row: number; absCol: boolean; absRow: boolean };
            if (peek()?.k === 'colon') {
                pos++;
                if (peek()?.k === 'ref') {
                    const t2 = consume() as { k: 'ref'; col: number; row: number; absCol: boolean; absRow: boolean };
                    const [c1, r1] = resolveRef(t1.col, t1.row, t1.absCol, t1.absRow);
                    const [c2, r2] = resolveRef(t2.col, t2.row, t2.absCol, t2.absRow);
                    return rangeVals(ctx.data, c1, r1, c2, r2);
                }
            }
            pos = savedPos;
        }
        return parseFormula();
    }

    function parseAtom(): FVal {
        const t = peek();
        if (!t) return null;
        if (t.k === 'lp') { pos++; const v = parseFormula(); expect('rp'); return v; }
        if (t.k === 'num')  { pos++; return t.v; }
        if (t.k === 'str')  { pos++; return t.v; }
        if (t.k === 'ref')  {
            pos++;
            const [c, r] = resolveRef(t.col, t.row, t.absCol, t.absRow);
            return cellFVal(ctx.data, c, r);
        }
        if (t.k === 'ident') {
            const name = t.v;
            pos++;
            if (name === 'TRUE')  return true;
            if (name === 'FALSE') return false;
            if (peek()?.k === 'lp') {
                pos++;
                const args: (FVal | FVal[])[] = [];
                while (peek() && peek()?.k !== 'rp') {
                    args.push(parseArg());
                    if (peek()?.k === 'comma') pos++;
                }
                expect('rp');
                return callBuiltIn(name, args, ctx);
            }
            return null;
        }
        return null;
    }

    try {
        const result = parseFormula();
        if (typeof result === 'boolean') return result;
        if (typeof result === 'number') return result !== 0;
        if (typeof result === 'string') return result.toUpperCase() === 'TRUE';
        return false;
    } catch {
        return false;
    }
}

function rangeBase(range: string): [number, number] {
    const m = range.trim().match(/^([A-Z]+)(\d+)/i);
    if (!m) return [1, 1];
    return [alphaToNum(m[1].toUpperCase()), parseInt(m[2])];
}

export type CellCFResult = {
    style?: CFStyle;
    dataBar?: { pct: number; color: string; gradient: boolean };
    progressBar?: { pct: number; color: string; showLabel: boolean };
    icon?: string;
    themeToken?: CFThemeToken;
};

// Parses "A1:D10" or "A1" into a list of cell IDs.
export function expandRange(range: string): string[] {
    const m = range.trim().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i);
    if (!m) return [];
    const c1 = alphaToNum(m[1].toUpperCase());
    const r1 = parseInt(m[2]);
    const c2 = m[3] ? alphaToNum(m[3].toUpperCase()) : c1;
    const r2 = m[4] ? parseInt(m[4]) : r1;
    const ids: string[] = [];
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
        for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
            ids.push(`${numToAlpha(c)}${r}`);
        }
    }
    return ids;
}

function numericVal(cell: CellProps | undefined): number | null {
    const raw = cell?.value ?? cell?.raw ?? '';
    const n = parseFloat(String(raw));
    return isNaN(n) ? null : n;
}

function stringVal(cell: CellProps | undefined): string {
    return String(cell?.value ?? cell?.raw ?? '').toLowerCase();
}

function parseCellDate(cell: CellProps | undefined): Date | null {
    const raw = String(cell?.value ?? cell?.raw ?? '').trim();
    if (!raw) return null;
    // ISO date strings
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
    // Excel serial number
    const n = parseFloat(raw);
    if (!isNaN(n)) {
        // Excel epoch: Dec 30, 1899
        const ms = (n - 25569) * 86400000;
        const sd = new Date(ms);
        if (!isNaN(sd.getTime())) return sd;
    }
    return null;
}

function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function testDateCondition(cell: CellProps | undefined, condition: CFSingleColorRule['condition']): boolean {
    const cellDate = parseCellDate(cell);
    if (!cellDate) return false;
    const today = startOfDay(new Date());
    const cellDay = startOfDay(cellDate);
    const diffMs = cellDay.getTime() - today.getTime();
    const diffDays = Math.round(diffMs / 86400000);
    switch (condition) {
        case 'dateIsToday':    return diffDays === 0;
        case 'dateIsTomorrow': return diffDays === 1;
        case 'dateIsPastDue':  return diffDays < 0;
        case 'dateIsNextWeek': return diffDays >= 1 && diffDays <= 7;
        case 'dateIsThisMonth':
            return cellDate.getFullYear() === today.getFullYear() &&
                   cellDate.getMonth() === today.getMonth();
        default: return false;
    }
}

function testCondition(cell: CellProps | undefined, rule: CFSingleColorRule): boolean {
    const str = stringVal(cell);
    switch (rule.condition) {
        case 'isEmpty':      return str === '';
        case 'isNotEmpty':   return str !== '';
        case 'containsText': return rule.value ? str.includes(rule.value.toLowerCase()) : false;
        case 'equalTo':      return str === (rule.value ?? '').toLowerCase();
        case 'notEqualTo':   return str !== (rule.value ?? '').toLowerCase();
        case 'dateIsToday':
        case 'dateIsTomorrow':
        case 'dateIsPastDue':
        case 'dateIsNextWeek':
        case 'dateIsThisMonth':
            return testDateCondition(cell, rule.condition);
        default: {
            const n = numericVal(cell);
            if (n === null) return false;
            const v = parseFloat(rule.value ?? '');
            switch (rule.condition) {
                case 'greaterThan': return !isNaN(v) && n > v;
                case 'lessThan':    return !isNaN(v) && n < v;
                case 'between': {
                    const v2 = parseFloat(rule.value2 ?? '');
                    return !isNaN(v) && !isNaN(v2) && n >= Math.min(v, v2) && n <= Math.max(v, v2);
                }
            }
            return false;
        }
    }
}

function hexToRgb(hex: string): [number, number, number] | null {
    const h = hex.replace('#', '');
    if (h.length !== 6) return null;
    return [
        parseInt(h.substring(0, 2), 16),
        parseInt(h.substring(2, 4), 16),
        parseInt(h.substring(4, 6), 16),
    ];
}

function interpolateHex(from: string, to: string, t: number): string {
    const a = hexToRgb(from);
    const b = hexToRgb(to);
    if (!a || !b) return to;
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

const ICON_SETS = {
    trafficLights: ['🔴', '🟡', '🟢'],
    arrows:        ['↓', '→', '↑'],
    ratings:       ['⭐', '⭐⭐', '⭐⭐⭐'],
} as const;

// item 14: heat map color presets
export const HEAT_MAP_PRESETS: Record<CFHeatMapPreset, { low: string; mid?: string; high: string }> = {
    financial:   { low: '#f4cccc', mid: '#fff2cc', high: '#d9ead3' },
    performance: { low: '#e53935', mid: '#fdd835', high: '#43a047' },
    temperature: { low: '#4fc3f7', mid: '#ffffff', high: '#ef5350' },
};

// item 16: status indicator templates — map cell value → format
type StatusMap = Record<string, CFStyle>;
const STATUS_TEMPLATES: Record<string, StatusMap> = {
    projectStatus: {
        'not started': { backgroundColor: '#e8eaed', color: '#5f6368' },
        'in progress': { backgroundColor: '#cfe2ff', color: '#084298' },
        'blocked':     { backgroundColor: '#fce8e6', color: '#c5221f' },
        'done':        { backgroundColor: '#e6f4ea', color: '#137333' },
    },
    priority: {
        'low':      { backgroundColor: '#e6f4ea', color: '#137333' },
        'medium':   { backgroundColor: '#fef9e7', color: '#9c6500' },
        'high':     { backgroundColor: '#fce8e6', color: '#c5221f' },
        'critical': { backgroundColor: '#c5221f', color: '#ffffff', fontWeight: 'bold' },
    },
    approval: {
        'pending':  { backgroundColor: '#fef9e7', color: '#9c6500' },
        'approved': { backgroundColor: '#e6f4ea', color: '#137333' },
        'rejected': { backgroundColor: '#fce8e6', color: '#c5221f' },
    },
};

// item 18: theme token → CSS variable background/text pairs
const THEME_TOKEN_STYLES: Record<CFThemeToken, CFStyle> = {
    success: { backgroundColor: 'var(--color-success-bg, #e6f4ea)', color: 'var(--color-success, #137333)' },
    warning: { backgroundColor: 'var(--color-warning-bg, #fef9e7)', color: 'var(--color-warning, #9c6500)' },
    danger:  { backgroundColor: 'var(--color-danger-bg,  #fce8e6)', color: 'var(--color-danger,  #c5221f)' },
    info:    { backgroundColor: 'var(--color-info-bg,    #cfe2ff)', color: 'var(--color-info,    #084298)' },
};

function resolveColorScale(
    ids: string[],
    data: Map<string, CellProps>,
    lowColor: string,
    highColor: string,
    midColor: string | undefined,
): Map<string, string> {
    const vals = ids.map(id => numericVal(data.get(id)));
    const nums = vals.filter((v): v is number => v !== null);
    const out = new Map<string, string>();
    if (nums.length === 0) return out;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min;
    ids.forEach((id, i) => {
        const v = vals[i];
        if (v === null) return;
        const t = span === 0 ? 0.5 : (v - min) / span;
        let color: string;
        if (midColor) {
            color = t <= 0.5
                ? interpolateHex(lowColor, midColor, t * 2)
                : interpolateHex(midColor, highColor, (t - 0.5) * 2);
        } else {
            color = interpolateHex(lowColor, highColor, t);
        }
        out.set(id, color);
    });
    return out;
}

export function evaluateConditionalFormats(
    data: Map<string, CellProps>,
    rules: CFRule[],
    variables?: CFVariable[],
    // item 22: 1-based row numbers that are hidden by active column filters
    hiddenRows?: Set<number>,
): Map<string, CellCFResult> {
    const result = new Map<string, CellCFResult>();
    // item 13: track which cells have been stopped by a stopIfTrue rule
    const stopped = new Set<string>();

    const merge = (id: string, patch: CellCFResult) => {
        const existing = result.get(id) ?? {};
        result.set(id, {
            ...existing,
            ...patch,
            style: patch.style ? { ...existing.style, ...patch.style } : existing.style,
        });
    };

    const varMap = new Map<string, CFVariable>(variables?.map(v => [v.name, v]) ?? []);

    for (const cfRule of rules) {
        const { range, stopIfTrue } = cfRule;
        let rule = cfRule.rule;

        // item 19: resolve variable reference
        if (rule.kind === 'variable') {
            const resolved = varMap.get(rule.variableName);
            if (!resolved) continue;
            rule = resolved.rule;
        }

        const ids = expandRange(range);
        if (ids.length === 0) continue;

        // items 11-12: filter out cells already stopped; evaluate in rule order
        const activeIds = ids.filter(id => !stopped.has(id));
        if (activeIds.length === 0) continue;

        // ── per-rule evaluation ────────────────────────────────────────────────
        const fired = new Set<string>(); // cells that fired for stopIfTrue tracking

        if (rule.kind === 'singleColor') {
            for (const id of activeIds) {
                if (testCondition(data.get(id), rule)) {
                    merge(id, { style: rule.format });
                    fired.add(id);
                }
            }

        } else if (rule.kind === 'colorScale') {
            const colorMap = resolveColorScale(activeIds, data, rule.minColor, rule.maxColor, rule.midColor);
            colorMap.forEach((color, id) => { merge(id, { style: { backgroundColor: color } }); fired.add(id); });

        } else if (rule.kind === 'heatMap') {
            // item 14: use preset colors if not overridden
            const preset = HEAT_MAP_PRESETS[rule.preset];
            const low  = rule.lowColor  || preset.low;
            const high = rule.highColor || preset.high;
            const mid  = rule.midColor  ?? preset.mid;
            const colorMap = resolveColorScale(activeIds, data, low, high, mid);
            colorMap.forEach((color, id) => { merge(id, { style: { backgroundColor: color } }); fired.add(id); });

        } else if (rule.kind === 'dataBar') {
            const vals = activeIds.map(id => numericVal(data.get(id)));
            const nums = vals.filter((v): v is number => v !== null);
            if (nums.length === 0) continue;
            const min = Math.min(0, ...nums);
            const max = Math.max(...nums);
            const span = max - min;
            activeIds.forEach((id, i) => {
                const v = vals[i];
                if (v === null) return;
                const pct = span === 0 ? 50 : Math.max(2, Math.min(100, ((v - min) / span) * 100));
                merge(id, { dataBar: { pct, color: rule.color, gradient: rule.gradient } });
                fired.add(id);
            });

        } else if (rule.kind === 'progressBar') {
            // item 15: progress bar with explicit min/max
            const span = rule.maxValue - rule.minValue;
            for (const id of activeIds) {
                const v = numericVal(data.get(id));
                if (v === null) continue;
                const pct = span === 0 ? 0 : Math.max(0, Math.min(100, ((v - rule.minValue) / span) * 100));
                merge(id, { progressBar: { pct, color: rule.color, showLabel: rule.showLabel } });
                fired.add(id);
            }

        } else if (rule.kind === 'iconSet') {
            const vals = activeIds.map(id => numericVal(data.get(id)));
            const nums = vals.filter((v): v is number => v !== null);
            if (nums.length === 0) continue;
            const min = Math.min(...nums);
            const max = Math.max(...nums);
            const span = max - min;
            const icons = ICON_SETS[rule.iconSet];
            activeIds.forEach((id, i) => {
                const v = vals[i];
                if (v === null) return;
                const t = span === 0 ? 0.5 : (v - min) / span;
                const tier = t < 0.33 ? 0 : t < 0.67 ? 1 : 2;
                merge(id, { icon: icons[tier] });
                fired.add(id);
            });

        } else if (rule.kind === 'duplicates' || rule.kind === 'uniques') {
            const counts = new Map<string, number>();
            for (const id of activeIds) {
                const v = stringVal(data.get(id));
                if (v !== '') counts.set(v, (counts.get(v) ?? 0) + 1);
            }
            for (const id of activeIds) {
                const v = stringVal(data.get(id));
                if (v === '') continue;
                const isDuplicate = (counts.get(v) ?? 0) > 1;
                const matches = rule.kind === 'duplicates' ? isDuplicate : !isDuplicate;
                if (matches) { merge(id, { style: rule.format }); fired.add(id); }
            }

        } else if (rule.kind === 'topBottom') {
            // item 22: filter to visible rows when visibleOnly is set
            const candidateIds = rule.visibleOnly && hiddenRows
                ? activeIds.filter(id => {
                    const row = parseInt(id.match(/\d+$/)?.[0] ?? '0');
                    return !hiddenRows.has(row);
                })
                : activeIds;
            const withVals = candidateIds
                .map(id => ({ id, v: numericVal(data.get(id)) }))
                .filter((x): x is { id: string; v: number } => x.v !== null);
            if (withVals.length === 0) continue;
            const sorted = [...withVals].sort((a, b) => a.v - b.v);
            const count = rule.type === 'percent'
                ? Math.max(1, Math.ceil(withVals.length * Math.min(100, Math.max(0, rule.value)) / 100))
                : Math.max(0, Math.min(Math.round(rule.value), withVals.length));
            if (count === 0) continue;
            const cutoff = rule.direction === 'top'
                ? sorted[sorted.length - count].v
                : sorted[count - 1].v;
            for (const { id, v } of withVals) {
                const qualifies = rule.direction === 'top' ? v >= cutoff : v <= cutoff;
                if (qualifies) { merge(id, { style: rule.format }); fired.add(id); }
            }

        } else if (rule.kind === 'average') {
            // item 22: filter to visible rows when visibleOnly is set
            const candidateIds = rule.visibleOnly && hiddenRows
                ? activeIds.filter(id => {
                    const row = parseInt(id.match(/\d+$/)?.[0] ?? '0');
                    return !hiddenRows.has(row);
                })
                : activeIds;
            const vals = candidateIds.map(id => numericVal(data.get(id)));
            const nums = vals.filter((v): v is number => v !== null);
            if (nums.length === 0) continue;
            const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
            // Still apply highlights to all activeIds (visible + hidden), just compute avg from visible
            activeIds.forEach(id => {
                const v = numericVal(data.get(id));
                if (v === null) return;
                const qualifies = rule.direction === 'above' ? v > avg : v < avg;
                if (qualifies) { merge(id, { style: rule.format }); fired.add(id); }
            });

        } else if (rule.kind === 'formula') {
            const [baseCol, baseRow] = rangeBase(range);
            for (const id of activeIds) {
                const m = id.match(/^([A-Z]+)(\d+)$/);
                if (!m) continue;
                const cellCol = alphaToNum(m[1]);
                const cellRow = parseInt(m[2]);
                const ctx: FormulaCtx = { data, cellRow, cellCol, baseRow, baseCol };
                if (evalFormula(rule.formula, ctx)) { merge(id, { style: rule.format }); fired.add(id); }
            }

        } else if (rule.kind === 'statusIndicator') {
            // item 16: map cell value to preset style
            const templateMap = STATUS_TEMPLATES[rule.template] ?? {};
            for (const id of activeIds) {
                const v = stringVal(data.get(id));
                const fmt = templateMap[v];
                if (fmt) { merge(id, { style: fmt }); fired.add(id); }
            }

        } else if (rule.kind === 'themeColor') {
            // item 18: theme-aware semantic color tokens
            for (const id of activeIds) {
                if (testCondition(data.get(id), { ...rule, kind: 'singleColor', format: {} })) {
                    merge(id, { style: THEME_TOKEN_STYLES[rule.token], themeToken: rule.token });
                    fired.add(id);
                }
            }
        }

        // item 13: mark cells as stopped if this rule fires and stopIfTrue is set
        if (stopIfTrue) {
            fired.forEach(id => stopped.add(id));
        }
    }

    return result;
}
