/**
 * Integration-level tests for the Blank/Template "New" flow in
 * ExportDialogs.tsx. The Blank-vs-Template choice itself lives as two
 * submenu items ("Blank" / "Template") under "New" in HamburgerMenu.tsx —
 * each opens its dialog state directly (`new` / `new-template-gallery`).
 * These tests cover what's left inside ExportDialogs: the template gallery
 * and the naming dialog for a template-derived sheet.
 *
 * ASSUMPTION: `ExportDialogs` is a controlled component — `hamburgerDialog`
 * is owned by its parent (SheetEditor.tsx) and `setHamburgerDialog` is how
 * it requests a transition. The "selected template" (chosen from the
 * gallery) is tracked as *internal* component state inside `ExportDialogs`,
 * mirroring how `newTitle`/`duplicateTitle` are already local `useState` in
 * this file. We therefore test the gallery→naming-dialog handoff end-to-end
 * within a single mounted instance: render with
 * `hamburgerDialog="new-template-gallery"`, click a template card (asserting
 * the resulting `setHamburgerDialog` call), then `rerender` the *same*
 * instance with `hamburgerDialog="new-template-name"` (simulating the parent
 * applying that state change) and assert the name input defaults to the
 * selected template's name. `rerender` on the same element preserves
 * component instance state, which is what makes this observable without a
 * dedicated "selected template" prop.
 *
 * See /Users/williamcherry/neutrino/agent_docs/plans/feature-sheets-template-gallery.md
 * for the full plan this test file is written against.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ExportDialogs } from '../../app/(apps)/sheets/editor/components/ExportDialogs';
import { SHEET_TEMPLATES } from '../../app/(apps)/sheets/editor/templates/sheetTemplates';

// `@neutrino/ui` is mocked the same way this repo's other component tests
// mock it (see EventDetail.test.tsx) so the SheetTemplatePickerModal rendered
// inside the 'new-template-gallery' dialog state doesn't depend on
// framer-motion/portal timing in jsdom.
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

// ExportDialogs statically imports ShareDialog for the (unrelated, untested
// here) 'share' dialog state; stub it out so mounting ExportDialogs doesn't
// pull in the drive-sharing UI's own dependency chain.
vi.mock('../../app/(apps)/drive/ShareDialog', () => ({
    ShareDialog: () => null,
}));

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type ExportDialogsProps = React.ComponentProps<typeof ExportDialogs>;

function baseProps(overrides: Partial<ExportDialogsProps> = {}): ExportDialogsProps {
    return {
        hamburgerDialog: null,
        setHamburgerDialog: vi.fn(),
        hamburgerDeleteConfirm: false,
        setHamburgerDeleteConfirm: vi.fn(),
        sheetId: 'sheet-1',
        title: 'Untitled',
        sheetNames: ['Sheet 1'],
        csvExportOptions: null,
        setCsvExportOptions: vi.fn(),
        doExportCsv: vi.fn(),
        xlsxExportOptions: null,
        setXlsxExportOptions: vi.fn(),
        doExportXlsx: vi.fn(),
        printOptions: null,
        setPrintOptions: vi.fn(),
        doPrint: vi.fn(),
        htmlExportOptions: null,
        setHtmlExportOptions: vi.fn(),
        doExportHtml: vi.fn(),
        onCreateNew: vi.fn(async () => {}),
        onDuplicate: vi.fn(async () => {}),
        onDelete: vi.fn(async () => {}),
        onImportSheet: vi.fn(async () => {}),
        onImportTab: vi.fn(async () => {}),
        onCreateFromTemplate: vi.fn(async () => {}),
        ...overrides,
    } as ExportDialogsProps;
}

describe('ExportDialogs — Blank/Template "New" flow', () => {
    it('selecting a template card in the gallery transitions to the naming dialog', () => {
        const setHamburgerDialog = vi.fn();
        render(<ExportDialogs {...baseProps({ hamburgerDialog: 'new-template-gallery', setHamburgerDialog })} />);

        const target = SHEET_TEMPLATES[0];
        fireEvent.click(screen.getByRole('button', { name: new RegExp(escapeRegExp(target.name)) }));

        expect(setHamburgerDialog).toHaveBeenCalledWith('new-template-name');
    });

    it('the naming dialog defaults the name field to the selected template\'s name, and Create calls onCreateFromTemplate with the trimmed name', () => {
        const setHamburgerDialog = vi.fn();
        const onCreateFromTemplate = vi.fn(async () => {});
        const props = baseProps({
            hamburgerDialog: 'new-template-gallery',
            setHamburgerDialog,
            onCreateFromTemplate,
        });

        const { rerender } = render(<ExportDialogs {...props} />);

        const target = SHEET_TEMPLATES[0];
        fireEvent.click(screen.getByRole('button', { name: new RegExp(escapeRegExp(target.name)) }));
        expect(setHamburgerDialog).toHaveBeenCalledWith('new-template-name');

        // Simulate the parent applying the requested dialog transition — the
        // same mounted ExportDialogs instance is re-rendered (not remounted),
        // so any internal "selected template" state survives.
        rerender(<ExportDialogs {...props} hamburgerDialog="new-template-name" />);

        expect(screen.getByDisplayValue(target.name)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /create/i }));

        expect(onCreateFromTemplate).toHaveBeenCalledWith(target, target.name);
    });
});
