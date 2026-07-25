/**
 * Component tests for TableStyleGalleryModal (TDD red phase — component does
 * not exist yet).
 *
 * `TableStyleGalleryModal({ open, onClose, onSelect })` mirrors
 * `SheetTemplatePickerModal.tsx`'s structure (one clickable card per catalog
 * entry) but for the 28-entry `TABLE_STYLES` catalog, with a
 * `TableStylePreviewSwatch` per card instead of a `MiniGridPreview`.
 *
 * `@neutrino/ui` is mocked the same way `SheetTemplatePickerModal.test.tsx`
 * mocks it, so these tests don't depend on framer-motion/portal timing in
 * jsdom — only on the `open`/`onClose` contract `Modal`/`ModalHeader`/
 * `ModalBody` expose.
 *
 * See /Users/williamcherry/neutrino/agent_docs/plans/feature-sheets-template-gallery.md
 * ("Continuation: Table styles gallery (28 presets)") for the full plan this
 * test file is written against.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TableStyleGalleryModal } from '../../app/(apps)/sheets/editor/components/TableStyleGalleryModal';
import { TABLE_STYLES } from '../../app/(apps)/sheets/editor/styles/tableStyles';

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

describe('TableStyleGalleryModal', () => {
    it('renders exactly one card per entry in TABLE_STYLES (28 total) when open', () => {
        render(<TableStyleGalleryModal open onClose={vi.fn()} onSelect={vi.fn()} />);
        // getByRole throws unless exactly one match, so this loop also proves
        // there is no ambiguity/duplication across the 28 cards.
        for (const s of TABLE_STYLES) {
            expect(cardButtonFor(s.name)).toBeInTheDocument();
        }
        expect(TABLE_STYLES).toHaveLength(28);
    });

    it('calls onSelect with the corresponding style object when a card is clicked', () => {
        const onSelect = vi.fn();
        render(<TableStyleGalleryModal open onClose={vi.fn()} onSelect={onSelect} />);
        const target = TABLE_STYLES[3];

        fireEvent.click(cardButtonFor(target.name));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith(target);
    });

    it('renders no style cards when open is false', () => {
        render(<TableStyleGalleryModal open={false} onClose={vi.fn()} onSelect={vi.fn()} />);
        for (const s of TABLE_STYLES) {
            expect(screen.queryByText(s.name)).not.toBeInTheDocument();
        }
    });
});
