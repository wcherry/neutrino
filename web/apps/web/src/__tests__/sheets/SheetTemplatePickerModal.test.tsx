/**
 * Component tests for SheetTemplatePickerModal (TDD red phase — component
 * does not exist yet).
 *
 * `SheetTemplatePickerModal({ open, onClose, onSelect, busy })` mirrors the
 * Diagrams app's `TemplatePickerModal.tsx` structurally (one clickable card
 * per catalog entry, disabled while `busy`), but for Sheets' 20-entry
 * `SHEET_TEMPLATES` catalog, with a live `MiniGridPreview` per card instead
 * of an icon.
 *
 * `@neutrino/ui` is mocked the same way this repo's other component tests
 * mock it (see EventDetail.test.tsx) so these tests don't depend on
 * framer-motion/portal timing in jsdom — only on the `open`/`onClose` contract
 * `Modal`/`ModalHeader`/`ModalBody` expose.
 *
 * See /Users/williamcherry/neutrino/agent_docs/plans/feature-sheets-template-gallery.md
 * for the full plan this test file is written against.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { SheetTemplatePickerModal } from '../../app/(apps)/sheets/editor/components/SheetTemplatePickerModal';
import { SHEET_TEMPLATES } from '../../app/(apps)/sheets/editor/templates/sheetTemplates';

vi.mock('@neutrino/ui', () => ({
    Modal: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
        open ? <div data-testid="modal">{children}</div> : null,
    ModalHeader: ({ title, onClose }: { title?: string; onClose?: () => void }) => (
        <div>
            <span>{title}</span>
            {onClose && <button onClick={onClose}>close</button>}
        </div>
    ),
    ModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cardButtonFor(name: string): HTMLElement {
    return screen.getByRole('button', { name: new RegExp(escapeRegExp(name)) });
}

describe('SheetTemplatePickerModal', () => {
    it('renders exactly one card per entry in SHEET_TEMPLATES (20 total) when open', () => {
        render(<SheetTemplatePickerModal open onClose={vi.fn()} onSelect={vi.fn()} />);
        // getByRole throws unless exactly one match, so this loop also proves
        // there is no ambiguity/duplication across the 20 cards.
        for (const t of SHEET_TEMPLATES) {
            expect(cardButtonFor(t.name)).toBeInTheDocument();
        }
        expect(SHEET_TEMPLATES).toHaveLength(20);
    });

    it("renders each template's name and description text", () => {
        render(<SheetTemplatePickerModal open onClose={vi.fn()} onSelect={vi.fn()} />);
        for (const t of SHEET_TEMPLATES) {
            expect(screen.getByText(t.name)).toBeInTheDocument();
            expect(screen.getByText(t.description)).toBeInTheDocument();
        }
    });

    it('calls onSelect with the corresponding template object when a card is clicked', () => {
        const onSelect = vi.fn();
        render(<SheetTemplatePickerModal open onClose={vi.fn()} onSelect={onSelect} />);
        const target = SHEET_TEMPLATES[3];

        fireEvent.click(cardButtonFor(target.name));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith(target);
    });

    it('disables cards when busy is true, and clicking does not call onSelect', () => {
        const onSelect = vi.fn();
        render(<SheetTemplatePickerModal open onClose={vi.fn()} onSelect={onSelect} busy />);
        const target = SHEET_TEMPLATES[0];
        const btn = cardButtonFor(target.name);

        expect(btn).toBeDisabled();
        fireEvent.click(btn);

        expect(onSelect).not.toHaveBeenCalled();
    });

    it('renders no template cards when open is false', () => {
        render(<SheetTemplatePickerModal open={false} onClose={vi.fn()} onSelect={vi.fn()} />);
        for (const t of SHEET_TEMPLATES) {
            expect(screen.queryByText(t.name)).not.toBeInTheDocument();
        }
    });
});
