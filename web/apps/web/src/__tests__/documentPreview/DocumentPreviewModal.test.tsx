/**
 * Unit tests for DocumentPreviewModal.
 *
 * Covers:
 *   - Modal shell: renders header with "Open in editor" button and close button
 *   - Closing: Escape key calls onClose
 *   - Closing: backdrop click calls onClose
 *   - Closing: X button click calls onClose
 *   - "Open in editor" button: calls router.push and then onClose
 *   - DocPreview: shows spinner while loading, then renders HTML content
 *   - NotePreview: renders paragraph, bullet, numbered, code, blockquote, task blocks
 *   - SheetPreview: renders cell values with column headers
 *   - SlidePreview: renders slide thumbnails
 *   - Sheet cell background colours are applied inline (not via CSS class)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── CSS module mocks ──────────────────────────────────────────────────────────

vi.mock(
  '../../components/DocumentPreviewModal/DocumentPreviewModal.module.css',
  () => ({ default: new Proxy({}, { get: (_t, key) => String(key) }) }),
);

// ── Slide editor imports (used in DocumentPreviewModal) ───────────────────────

vi.mock('../../app/(apps)/slides/editor/slideEditorHelpers', () => ({
  slideBackgroundStyle: vi.fn(() => ({ background: '#ffffff' })),
}));

vi.mock('../../app/(apps)/slides/editor/SlideCanvas', () => ({
  ShapeRenderer: () => <svg data-testid="shape-renderer" />,
}));

// ── Sheet formula (used in SheetPreview) ──────────────────────────────────────

vi.mock('../../app/(apps)/sheets/editor/formula', () => ({
  computeCell: vi.fn((raw: string) => ({ value: raw, deps: [] })),
}));

vi.mock('../../app/(apps)/sheets/editor/utils', () => ({
  numToAlpha: vi.fn((n: number) => String.fromCharCode(64 + n)),
}));

// ── API mocks ─────────────────────────────────────────────────────────────────

const mockGetDoc = vi.fn();
const mockGetSheet = vi.fn();
const mockGetSlide = vi.fn();
const mockGetNote = vi.fn();
const mockDriveReadContent = vi.fn();

vi.mock('../../lib/api', () => ({
  docsApi: { getDoc: (...args: unknown[]) => mockGetDoc(...args) },
  sheetsApi: { getSheet: (...args: unknown[]) => mockGetSheet(...args) },
  slidesApi: { getSlide: (...args: unknown[]) => mockGetSlide(...args) },
  notesApi: { getNote: (...args: unknown[]) => mockGetNote(...args) },
  driveReadContent: (...args: unknown[]) => mockDriveReadContent(...args),
}));

// ── React Query mock ──────────────────────────────────────────────────────────

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: vi.fn(actual.useQuery),
  };
});

import { useQuery } from '@tanstack/react-query';
const mockUseQuery = useQuery as ReturnType<typeof vi.fn>;

// ── Router mock ───────────────────────────────────────────────────────────────

const mockRouterPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

// ── Neutrino UI mocks ─────────────────────────────────────────────────────────

vi.mock('@neutrino/ui', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Spinner: ({ size }: { size: string }) => <div data-testid={`spinner-${size}`} />,
  Button: ({ children, onClick, icon }: { children: React.ReactNode; onClick?: () => void; icon?: React.ReactNode }) => (
    <button onClick={onClick}>
      {icon}
      {children}
    </button>
  ),
}));

// ── Block editor helpers mock ─────────────────────────────────────────────────

vi.mock('../../app/(apps)/notes/editor/blockEditorHelpers', () => ({
  parseBlocks: vi.fn((content: string) => {
    try {
      return JSON.parse(content);
    } catch {
      return [{ id: '1', type: 'paragraph', content }];
    }
  }),
  renderInline: vi.fn((text: string) => text),
}));

// ── Import subject ────────────────────────────────────────────────────────────

import { DocumentPreviewModal } from '../../components/DocumentPreviewModal';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDocContent() {
  return JSON.stringify({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Hello World' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Some body text.' }] },
    ],
  });
}

function makeSheetContent() {
  return JSON.stringify({
    sheets: [
      {
        name: 'Sheet1',
        cells: {
          A1: { id: 'A1', raw: 'Name' },
          B1: { id: 'B1', raw: 'Score' },
          A2: { id: 'A2', raw: 'Alice' },
          B2: { id: 'B2', raw: '95' },
        },
      },
    ],
  });
}

function makeSlideContent() {
  return JSON.stringify({
    slides: [
      {
        id: 'slide-1',
        background: { type: 'color', value: '#fff' },
        elements: [
          {
            id: 'el-1',
            type: 'text',
            x: 10, y: 30, w: 80, h: 20,
            content: 'Slide Title',
            style: { fontSize: 32, bold: true, italic: false, underline: false, color: '#000', align: 'center', fontFamily: 'sans-serif' },
          },
        ],
        notes: '',
        transition: 'none',
      },
    ],
    theme: {
      name: 'Default',
      primaryColor: '#0070f3',
      backgroundColor: '#ffffff',
      textColor: '#000000',
      accentColor: '#ff4081',
      fontFamily: 'sans-serif',
      defaultTransition: 'none',
    },
  });
}

function makeNoteContent() {
  return JSON.stringify([
    { id: '1', type: 'paragraph', content: 'Hello note' },
    { id: '2', type: 'bullet', content: 'A bullet' },
    { id: '3', type: 'numbered', content: 'A numbered item' },
    { id: '4', type: 'code', content: 'const x = 1;' },
    { id: '5', type: 'blockquote', content: 'A quote' },
    { id: '6', type: 'task', content: 'A task', checked: false },
    { id: '7', type: 'task', content: 'Done task', checked: true },
  ]);
}

// ── Shared query setup helpers ────────────────────────────────────────────────

function setupDocQueries() {
  mockUseQuery
    .mockReturnValueOnce({ data: { id: 'doc-1', contentUrl: '/api/v1/drive/files/doc-1/content' }, isLoading: false, isError: false })
    .mockReturnValueOnce({ data: makeDocContent(), isLoading: false, isError: false });
}

function setupSheetQueries() {
  mockUseQuery
    .mockReturnValueOnce({ data: { id: 'sheet-1', contentUrl: '/api/v1/drive/files/sheet-1/content' }, isLoading: false, isError: false })
    .mockReturnValueOnce({ data: makeSheetContent(), isLoading: false, isError: false });
}

function setupSlideQueries() {
  mockUseQuery
    .mockReturnValueOnce({ data: { id: 'slide-1', contentUrl: '/api/v1/drive/files/slide-1/content' }, isLoading: false, isError: false })
    .mockReturnValueOnce({ data: makeSlideContent(), isLoading: false, isError: false });
}

function setupNoteQuery() {
  mockUseQuery.mockReturnValueOnce({
    data: { id: 'note-1', title: 'My Note', content: makeNoteContent() },
    isLoading: false,
    isError: false,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DocumentPreviewModal — modal shell', () => {
  it('renders the "Open in editor" button', () => {
    setupDocQueries();
    render(<DocumentPreviewModal id="doc-1" kind="doc" onClose={vi.fn()} />);
    expect(screen.getByText('Open in editor')).toBeInTheDocument();
  });

  it('renders the close button', () => {
    setupDocQueries();
    render(<DocumentPreviewModal id="doc-1" kind="doc" onClose={vi.fn()} />);
    expect(screen.getByLabelText('Close preview')).toBeInTheDocument();
  });

  it('shows "Document preview" label for doc kind', () => {
    setupDocQueries();
    render(<DocumentPreviewModal id="doc-1" kind="doc" onClose={vi.fn()} />);
    expect(screen.getByText('Document preview')).toBeInTheDocument();
  });

  it('shows "Spreadsheet preview" label for sheet kind', () => {
    setupSheetQueries();
    render(<DocumentPreviewModal id="sheet-1" kind="sheet" onClose={vi.fn()} />);
    expect(screen.getByText('Spreadsheet preview')).toBeInTheDocument();
  });

  it('shows "Presentation preview" label for slide kind', () => {
    setupSlideQueries();
    render(<DocumentPreviewModal id="slide-1" kind="slide" onClose={vi.fn()} />);
    expect(screen.getByText('Presentation preview')).toBeInTheDocument();
  });

  it('shows "Note preview" label for note kind', () => {
    setupNoteQuery();
    render(<DocumentPreviewModal id="note-1" kind="note" onClose={vi.fn()} />);
    expect(screen.getByText('Note preview')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DocumentPreviewModal — closing', () => {
  it('calls onClose when X button is clicked', () => {
    const onClose = vi.fn();
    setupDocQueries();
    render(<DocumentPreviewModal id="doc-1" kind="doc" onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close preview'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    setupDocQueries();
    render(<DocumentPreviewModal id="doc-1" kind="doc" onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    setupDocQueries();
    const { container } = render(<DocumentPreviewModal id="doc-1" kind="doc" onClose={onClose} />);
    const backdrop = container.querySelector('[role="dialog"]');
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose when clicking inside the modal body (not backdrop)', () => {
    const onClose = vi.fn();
    setupDocQueries();
    const { container } = render(<DocumentPreviewModal id="doc-1" kind="doc" onClose={onClose} />);
    // Click the inner modal div (not the backdrop element itself)
    const modal = container.querySelector('.modal');
    fireEvent.click(modal!);
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DocumentPreviewModal — "Open in editor" navigation', () => {
  it('navigates to docs editor for doc kind', () => {
    const onClose = vi.fn();
    setupDocQueries();
    render(<DocumentPreviewModal id="doc-1" kind="doc" onClose={onClose} />);
    fireEvent.click(screen.getByText('Open in editor'));
    expect(mockRouterPush).toHaveBeenCalledWith('/docs/editor?id=doc-1');
    expect(onClose).toHaveBeenCalled();
  });

  it('navigates to sheets editor for sheet kind', () => {
    const onClose = vi.fn();
    setupSheetQueries();
    render(<DocumentPreviewModal id="sheet-1" kind="sheet" onClose={onClose} />);
    fireEvent.click(screen.getByText('Open in editor'));
    expect(mockRouterPush).toHaveBeenCalledWith('/sheets/editor?id=sheet-1');
  });

  it('navigates to slides editor for slide kind', () => {
    const onClose = vi.fn();
    setupSlideQueries();
    render(<DocumentPreviewModal id="slide-1" kind="slide" onClose={onClose} />);
    fireEvent.click(screen.getByText('Open in editor'));
    expect(mockRouterPush).toHaveBeenCalledWith('/slides/editor?id=slide-1');
  });

  it('navigates to notes editor for note kind', () => {
    const onClose = vi.fn();
    setupNoteQuery();
    render(<DocumentPreviewModal id="note-1" kind="note" onClose={onClose} />);
    fireEvent.click(screen.getByText('Open in editor'));
    expect(mockRouterPush).toHaveBeenCalledWith('/notes/editor?id=note-1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DocPreview', () => {
  it('shows spinner while content is loading', () => {
    mockUseQuery
      .mockReturnValueOnce({ data: { id: 'doc-1', contentUrl: '/content' }, isLoading: false, isError: false })
      .mockReturnValueOnce({ data: undefined, isLoading: true, isError: false });
    render(<DocumentPreviewModal id="doc-1" kind="doc" onClose={vi.fn()} />);
    expect(screen.getByTestId('spinner-lg')).toBeInTheDocument();
  });

  it('renders doc content HTML after loading', () => {
    setupDocQueries();
    const { container } = render(<DocumentPreviewModal id="doc-1" kind="doc" onClose={vi.fn()} />);
    const docContent = container.querySelector('h1');
    expect(docContent).not.toBeNull();
    expect(docContent?.textContent).toBe('Hello World');
  });

  it('renders paragraph text', () => {
    setupDocQueries();
    render(<DocumentPreviewModal id="doc-1" kind="doc" onClose={vi.fn()} />);
    expect(screen.getByText('Some body text.')).toBeInTheDocument();
  });

  it('shows error state when content fetch fails', () => {
    // First call: doc metadata; second call: content load with error
    mockUseQuery
      .mockReturnValueOnce({ data: { id: 'doc-1', contentUrl: '/content' }, isLoading: false, isError: false })
      .mockReturnValueOnce({ data: null, isLoading: false, isError: true });
    render(<DocumentPreviewModal id="doc-1" kind="doc" onClose={vi.fn()} />);
    expect(screen.getByText('Failed to load document preview.')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SheetPreview', () => {
  it('renders column headers', () => {
    setupSheetQueries();
    render(<DocumentPreviewModal id="sheet-1" kind="sheet" onClose={vi.fn()} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('renders cell values', () => {
    setupSheetQueries();
    render(<DocumentPreviewModal id="sheet-1" kind="sheet" onClose={vi.fn()} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Score')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('applies cell background color inline (not via CSS class)', () => {
    mockUseQuery
      .mockReturnValueOnce({ data: { id: 'sheet-1', contentUrl: '/content' }, isLoading: false, isError: false })
      .mockReturnValueOnce({
        data: JSON.stringify({
          sheets: [{
            name: 'Sheet1',
            cells: {
              A1: { id: 'A1', raw: 'Header', cellStyle: { backgroundColor: '#ff0000', color: '#ffffff' } },
            },
          }],
        }),
        isLoading: false,
        isError: false,
      });
    const { container } = render(<DocumentPreviewModal id="sheet-1" kind="sheet" onClose={vi.fn()} />);
    // Find the cell — it must have the background set as an inline style
    const cells = container.querySelectorAll('td');
    const headerCell = [...cells].find((td) => td.textContent === 'Header');
    expect(headerCell).not.toBeUndefined();
    expect(headerCell?.style.backgroundColor).toBe('rgb(255, 0, 0)');
    // Verify it is inline style, not a CSS class-based approach
    expect(headerCell?.getAttribute('style')).toContain('background-color');
  });

  it('shows empty state when sheet has no cells', () => {
    mockUseQuery
      .mockReturnValueOnce({ data: { id: 'sheet-1', contentUrl: '/content' }, isLoading: false, isError: false })
      .mockReturnValueOnce({
        data: JSON.stringify({ sheets: [{ name: 'Sheet1', cells: {} }] }),
        isLoading: false,
        isError: false,
      });
    render(<DocumentPreviewModal id="sheet-1" kind="sheet" onClose={vi.fn()} />);
    expect(screen.getByText('This spreadsheet is empty.')).toBeInTheDocument();
  });

  it('shows error state when content fetch fails', () => {
    mockUseQuery
      .mockReturnValueOnce({ data: { id: 'sheet-1', contentUrl: '/content' }, isLoading: false, isError: false })
      .mockReturnValueOnce({ data: null, isLoading: false, isError: true });
    render(<DocumentPreviewModal id="sheet-1" kind="sheet" onClose={vi.fn()} />);
    expect(screen.getByText('Failed to load spreadsheet preview.')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SlidePreview', () => {
  it('renders slide numbers', () => {
    setupSlideQueries();
    render(<DocumentPreviewModal id="slide-1" kind="slide" onClose={vi.fn()} />);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders text element content', () => {
    setupSlideQueries();
    render(<DocumentPreviewModal id="slide-1" kind="slide" onClose={vi.fn()} />);
    expect(screen.getByText('Slide Title')).toBeInTheDocument();
  });

  it('shows empty state when no slides exist', () => {
    mockUseQuery
      .mockReturnValueOnce({ data: { id: 'slide-1', contentUrl: '/content' }, isLoading: false, isError: false })
      .mockReturnValueOnce({
        data: JSON.stringify({ slides: [], theme: {} }),
        isLoading: false,
        isError: false,
      });
    render(<DocumentPreviewModal id="slide-1" kind="slide" onClose={vi.fn()} />);
    expect(screen.getByText('This presentation has no slides.')).toBeInTheDocument();
  });

  it('shows error state when content fetch fails', () => {
    mockUseQuery
      .mockReturnValueOnce({ data: { id: 'slide-1', contentUrl: '/content' }, isLoading: false, isError: false })
      .mockReturnValueOnce({ data: null, isLoading: false, isError: true });
    render(<DocumentPreviewModal id="slide-1" kind="slide" onClose={vi.fn()} />);
    expect(screen.getByText('Failed to load presentation preview.')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('NotePreview', () => {
  it('renders paragraph block content', () => {
    setupNoteQuery();
    render(<DocumentPreviewModal id="note-1" kind="note" onClose={vi.fn()} />);
    expect(screen.getByText('Hello note')).toBeInTheDocument();
  });

  it('renders bullet block content', () => {
    setupNoteQuery();
    render(<DocumentPreviewModal id="note-1" kind="note" onClose={vi.fn()} />);
    expect(screen.getByText('A bullet')).toBeInTheDocument();
  });

  it('renders numbered block content', () => {
    setupNoteQuery();
    render(<DocumentPreviewModal id="note-1" kind="note" onClose={vi.fn()} />);
    expect(screen.getByText('A numbered item')).toBeInTheDocument();
  });

  it('renders code block content', () => {
    setupNoteQuery();
    render(<DocumentPreviewModal id="note-1" kind="note" onClose={vi.fn()} />);
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  });

  it('renders blockquote content', () => {
    setupNoteQuery();
    render(<DocumentPreviewModal id="note-1" kind="note" onClose={vi.fn()} />);
    expect(screen.getByText('A quote')).toBeInTheDocument();
  });

  it('renders task block content', () => {
    setupNoteQuery();
    render(<DocumentPreviewModal id="note-1" kind="note" onClose={vi.fn()} />);
    expect(screen.getByText('A task')).toBeInTheDocument();
    expect(screen.getByText('Done task')).toBeInTheDocument();
  });

  it('applies strikethrough to completed tasks', () => {
    setupNoteQuery();
    const { container } = render(<DocumentPreviewModal id="note-1" kind="note" onClose={vi.fn()} />);
    // The "Done task" span should have the done class
    const spans = container.querySelectorAll('span');
    const doneSpan = [...spans].find((s) => s.textContent === 'Done task');
    expect(doneSpan?.className).toContain('noteTaskTextDone');
  });

  it('shows spinner while loading', () => {
    mockUseQuery.mockReturnValueOnce({ data: undefined, isLoading: true, isError: false });
    render(<DocumentPreviewModal id="note-1" kind="note" onClose={vi.fn()} />);
    expect(screen.getByTestId('spinner-lg')).toBeInTheDocument();
  });

  it('shows error state when note fetch fails', () => {
    mockUseQuery.mockReturnValueOnce({ data: undefined, isLoading: false, isError: true });
    render(<DocumentPreviewModal id="note-1" kind="note" onClose={vi.fn()} />);
    expect(screen.getByText('Failed to load note preview.')).toBeInTheDocument();
  });
});
