/**
 * Unit + light integration tests for sheetTemplates.ts (TDD red phase — module
 * does not exist yet).
 *
 * `SHEET_TEMPLATES` is a hand-authored catalog of 20 starter spreadsheet
 * templates for Sheets' "New" → "From template" gallery. Each entry has a
 * small `preview` grid (for the gallery card) decoupled from a `build()`
 * function that produces the full seeded `SheetFile` applied on creation.
 *
 * This file also exercises the combinator from sheetFileUtils.ts
 * (`sheetFileToSheetsData`) against every template's `build()` output, since
 * that's the exact pipeline a template goes through when a user picks it
 * (SheetEditor.tsx applies `sheetFileToSheetsData(template.build())` via
 * `sheets.replaceAllSheets`).
 *
 * See /Users/williamcherry/neutrino/agent_docs/plans/feature-sheets-template-gallery.md
 * for the full plan this test file is written against.
 */

import { describe, it, expect } from 'vitest';
import { SHEET_TEMPLATES, type SheetTemplate } from '../../app/(apps)/sheets/editor/templates/sheetTemplates';
import { sheetFileToSheetsData } from '../../app/(apps)/sheets/editor/hooks/sheetFileUtils';

// ── Structural sanity ────────────────────────────────────────────────────────

describe('SHEET_TEMPLATES — catalog shape', () => {
    it('contains exactly 20 templates', () => {
        const templates: SheetTemplate[] = SHEET_TEMPLATES;
        expect(templates).toHaveLength(20);
    });

    it('has unique, non-empty, kebab-case-ish ids with no spaces', () => {
        const ids = SHEET_TEMPLATES.map(t => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) {
            expect(id).toBeTruthy();
            expect(id).not.toMatch(/\s/);
            expect(id).toMatch(/^[a-z0-9-]+$/);
        }
    });

    it('has a non-empty name and description for every template', () => {
        for (const t of SHEET_TEMPLATES) {
            expect(t.name.trim().length).toBeGreaterThan(0);
            expect(t.description.trim().length).toBeGreaterThan(0);
        }
    });

    it('has a structurally sane preview grid for every template', () => {
        for (const t of SHEET_TEMPLATES) {
            expect(t.preview.headers.length).toBeGreaterThanOrEqual(3);
            for (const row of t.preview.rows) {
                expect(row).toHaveLength(t.preview.headers.length);
            }
        }
    });
});

// ── build() output ───────────────────────────────────────────────────────────

describe('SHEET_TEMPLATES — build() output', () => {
    it('every build() returns a SheetFile with at least one sheet with at least one non-empty cell', () => {
        for (const t of SHEET_TEMPLATES) {
            const file = t.build();
            expect(file.sheets.length).toBeGreaterThan(0);
            const hasNonEmptySheet = file.sheets.some(s => Object.keys(s.cells).length > 0);
            expect(hasNonEmptySheet).toBe(true);
        }
    });

    it('at least a handful of templates include a formula cell (raw starting with "=")', () => {
        const templatesWithFormulas = SHEET_TEMPLATES.filter(t => {
            const file = t.build();
            return file.sheets.some(s =>
                Object.values(s.cells).some(c => typeof c.raw === 'string' && c.raw.startsWith('='))
            );
        });
        // Deliberately not pinned to specific template ids/names — the plan
        // calls for formulas in totals/subtotals/amortization/KPI templates,
        // but exactly which ones is an implementation detail.
        expect(templatesWithFormulas.length).toBeGreaterThanOrEqual(3);
    });
});

// ── Integration with sheetFileUtils.sheetFileToSheetsData ───────────────────

describe('SHEET_TEMPLATES — integration with sheetFileToSheetsData', () => {
    it('every template, once converted via sheetFileToSheetsData, yields at least one sheet with at least one cell', () => {
        for (const t of SHEET_TEMPLATES) {
            const converted = sheetFileToSheetsData(t.build());
            expect(converted.length).toBeGreaterThan(0);
            const hasNonEmptySheet = converted.some(s => s.data.size > 0);
            expect(hasNonEmptySheet).toBe(true);
        }
    });
});

// ── Expected coverage (presence, not exact wording) ─────────────────────────

describe('SHEET_TEMPLATES — expected coverage', () => {
    // The task brief names 20 specific use-cases. We check that the catalog's
    // names/descriptions plausibly cover each concept via loose substring
    // matching, rather than hardcoding ids (which are an implementation
    // choice, e.g. "quote" vs "estimate").
    const expectedConcepts = [
        /budget/i,           // Monthly Budget / Annual Budget (2 entries)
        /expense/i,          // Expense Tracker
        /invoice/i,          // Invoice
        /quote|estimate/i,   // Quote/Estimate
        /project/i,          // Project Tracker
        /task/i,             // Task List
        /timesheet/i,        // Employee Timesheet
        /schedule/i,         // Employee Schedule
        /inventory/i,        // Inventory Management
        /sales pipeline|pipeline/i, // Sales Pipeline
        /crm|contact/i,      // CRM Contact List
        /cash flow/i,        // Cash Flow Statement
        /profit.*loss|p&l/i, // Profit & Loss Statement
        /amortization/i,     // Loan Amortization
        /calendar/i,         // Annual Calendar
        /gantt/i,            // Gantt Chart
        /kpi|dashboard/i,    // KPI Dashboard
        /retirement/i,       // Retirement Planner
        /investment|portfolio/i, // Investment Portfolio Tracker
    ];

    it('covers every named template concept from the brief', () => {
        const haystack = SHEET_TEMPLATES.map(t => `${t.name} ${t.description}`).join(' | ');
        for (const concept of expectedConcepts) {
            expect(haystack).toMatch(concept);
        }
    });
});
