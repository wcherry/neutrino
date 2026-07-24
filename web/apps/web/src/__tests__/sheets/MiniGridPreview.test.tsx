/**
 * Component tests for MiniGridPreview (TDD red phase — component does not
 * exist yet).
 *
 * `MiniGridPreview({ headers, rows })` renders a small, pure/presentational
 * table used by the Sheets "New from template" gallery cards: one header row
 * plus data rows, each cell its own element, no interactivity or internal
 * state.
 *
 * See /Users/williamcherry/neutrino/agent_docs/plans/feature-sheets-template-gallery.md
 * for the full plan this test file is written against.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MiniGridPreview } from '../../app/(apps)/sheets/editor/components/MiniGridPreview';

describe('MiniGridPreview', () => {
    const headers = ['Item', 'Qty', 'Price'];
    const rows = [
        ['Widget', '3', '9.99'],
        ['Gadget', '1', '19.99'],
    ];

    it('renders all header text', () => {
        render(<MiniGridPreview headers={headers} rows={rows} />);
        for (const h of headers) {
            expect(screen.getByText(h)).toBeInTheDocument();
        }
    });

    it('renders all row cell text', () => {
        render(<MiniGridPreview headers={headers} rows={rows} />);
        for (const row of rows) {
            for (const cell of row) {
                expect(screen.getByText(cell)).toBeInTheDocument();
            }
        }
    });

    it('renders the correct number of header cells', () => {
        const { container } = render(<MiniGridPreview headers={headers} rows={rows} />);
        // Header cells should each contain exactly one header's text; assert by
        // count of distinct header text nodes rather than a specific tag/role,
        // since the implementation may use <table><th> or styled <div>s.
        for (const h of headers) {
            expect(screen.getAllByText(h)).toHaveLength(1);
        }
        expect(container).toBeTruthy();
    });

    it('renders the correct number of body rows', () => {
        render(<MiniGridPreview headers={headers} rows={rows} />);
        // Every row's first cell should appear exactly once.
        expect(screen.getAllByText('Widget')).toHaveLength(1);
        expect(screen.getAllByText('Gadget')).toHaveLength(1);
    });

    it('handles an empty rows array without throwing, rendering headers only', () => {
        expect(() => render(<MiniGridPreview headers={headers} rows={[]} />)).not.toThrow();
        for (const h of headers) {
            expect(screen.getByText(h)).toBeInTheDocument();
        }
        expect(screen.queryByText('Widget')).not.toBeInTheDocument();
    });
});
