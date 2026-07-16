/**
 * Component test for the Slides SlideEditor's font-family picker
 * (feature/custom-fonts plan, ~SlideEditor.tsx line 80, 1394-1395).
 *
 * Today SlideEditor.tsx imports `FONT_FAMILY_NAMES as FONT_FAMILIES` directly
 * from `@/constants/editor`. The plan wires it instead to
 * `const { fontFamilyNames } = useAvailableFonts()`, which merges the
 * built-ins with admin-uploaded custom fonts.
 *
 * Mirrors the mocking approach of __tests__/slides/officeMode.test.tsx
 * (heavy child/hook mocking so SlideEditor — which takes no props and owns
 * all its own state — can be rendered in isolation), but keeps the toolbar
 * components as pass-throughs (rather than stubbed to null) so the font
 * picker's rendered <select> can be inspected, and stubs SlideCanvas with a
 * button-per-element so a text element can be "clicked" to select it without
 * needing the real canvas' pointer-event geometry.
 *
 * Red phase: `@/hooks/useAvailableFonts` does not exist yet, and
 * SlideEditor.tsx has not been wired to it, so this test's mock of the hook
 * is inert today — the assertion expecting the mocked custom font to appear
 * in the font-family select fails until frontend-developer completes the
 * wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FONT_FAMILY_NAMES } from '@/constants/editor';

// ---------------------------------------------------------------------------
// All vi.mock() calls before the module under test is imported.
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'id' ? 'test-slide-id' : null) }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@neutrino/ui', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) =>
    React.createElement('button', { onClick }, children),
  Toolbar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ToolbarGroup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ToolbarDivider: () => <hr />,
  ToolbarButton: ({ children, onClick, title }: { children?: React.ReactNode; onClick?: () => void; title?: string }) => (
    <button onClick={onClick} title={title}>{children}</button>
  ),
  ToolbarSelect: ({
    children,
    value,
    onChange,
    title,
  }: {
    children?: React.ReactNode;
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
    title?: string;
  }) => (
    <select title={title} value={value} onChange={onChange}>
      {children}
    </select>
  ),
  ColorPickerPopover: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ZoomSlider: () => null,
  ShareButton: () => null,
  FillPicker: () => null,
  useToast: () => ({ warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('@neutrino/auth', () => ({
  useUser: () => null,
  useAuth: () => ({ user: null, isLoading: false }),
}));

const mockGetSlide = vi.fn();
const mockGetFileMetadata = vi.fn();
const mockDownloadFile = vi.fn();

vi.mock('@/lib/api', () => ({
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, code: string, message: string) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
      this.code = code;
    }
  },
  slidesApi: {
    getSlide: (...args: unknown[]) => mockGetSlide(...args),
    listThemes: vi.fn(() => Promise.resolve([])),
    autosaveEncryptedContent: vi.fn(() => Promise.resolve()),
    saveSlide: vi.fn(() => Promise.resolve()),
  },
  driveReadContent: vi.fn(() => Promise.resolve('')),
  driveAutosaveEncryptedContent: vi.fn(() => Promise.resolve()),
  storageApi: {
    getFileMetadata: (...args: unknown[]) => mockGetFileMetadata(...args),
    downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
  },
}));

vi.mock('@/app/(apps)/drive/ShareDialog', () => ({ ShareDialog: () => null }));

vi.mock('@/hooks/useSlidePresence', () => ({
  useSlidePresence: () => ({ remoteUsers: [], broadcastPresentation: vi.fn() }),
}));

vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef: { current: null },
    dekResolved: true,
    isNewEncryption: false,
  }),
}));

vi.mock('@neutrino/e2e-crypto', () => ({ decryptFile: vi.fn() }));

vi.mock('@/hooks/useSpellCheck', () => ({ useSpellCheck: () => ({ spellCheck: false }) }));

vi.mock('@/providers/FeatureFlagsProvider', () => ({
  useFeatureFlags: () => ({ slidesVideoEmbeds: false, officeInPlaceEditing: false }),
}));

const CUSTOM_FONT_OPTION = { label: 'My Custom Font', value: 'My Custom Font' };

vi.mock('@/hooks/useAvailableFonts', () => ({
  useAvailableFonts: () => ({
    fontFamilies: [],
    fontFamilyNames: [...FONT_FAMILY_NAMES, CUSTOM_FONT_OPTION],
    customFontFamilies: [],
    customFontFamilyNames: [CUSTOM_FONT_OPTION],
    loaded: true,
  }),
}));

vi.mock('@neutrino/sheet-embed', () => ({
  useSheetPasteInterceptor: () => ({ handlePaste: vi.fn(), dialogState: null }),
  PasteChoiceDialog: () => null,
}));

vi.mock('../../app/(apps)/slides/editor/InsertSheetDialog', () => ({ InsertSheetDialog: () => null }));
vi.mock('../../app/(apps)/slides/editor/InsertImageDialog', () => ({ InsertImageDialog: () => null }));
vi.mock('../../app/(apps)/slides/editor/InsertDiagramDialog', () => ({ InsertDiagramDialog: () => null }));

// Stub the canvas: render one button per element so a test can "select" the
// first (default-presentation) text element without depending on the real
// canvas' pointer-event/geometry implementation.
vi.mock('../../app/(apps)/slides/editor/SlideCanvas', () => ({
  default: ({
    slide,
    onSelectElement,
  }: {
    slide: { elements: { id: string; type: string }[] };
    onSelectElement: (id: string) => void;
  }) => (
    <div>
      {slide.elements.map((el, i) => (
        <button key={el.id} onClick={() => onSelectElement(el.id)}>
          {`select-element-${i}`}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../../app/(apps)/slides/editor/page.module.css', () => ({
  default: new Proxy({}, { get: (_, k) => String(k) }),
}));

// ---------------------------------------------------------------------------
// Module imports — after all vi.mock() calls
// ---------------------------------------------------------------------------

import { SlideEditor } from '../../app/(apps)/slides/editor/SlideEditor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
}

function renderSlideEditor() {
  const qc = makeQueryClient();
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(SlideEditor))
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SlideEditor — font-family picker (feature/custom-fonts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSlide.mockResolvedValue({ id: 'test-slide-id', title: 'Test deck', contentUrl: 'x' });
  });

  it('shows the font-family select once a text element is selected', async () => {
    renderSlideEditor();

    await waitFor(() => expect(mockGetSlide).toHaveBeenCalled());
    await userEvent.click(await screen.findByText('select-element-0'));

    expect(await screen.findByTitle('Font family')).toBeTruthy();
  });

  it('renders an option for every built-in font name', async () => {
    renderSlideEditor();

    await waitFor(() => expect(mockGetSlide).toHaveBeenCalled());
    await userEvent.click(await screen.findByText('select-element-0'));

    const select = await screen.findByTitle('Font family');
    const optionLabels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    for (const font of FONT_FAMILY_NAMES) {
      expect(optionLabels).toContain(font.label);
    }
  });

  it('renders an option for a custom font returned by useAvailableFonts', async () => {
    renderSlideEditor();

    await waitFor(() => expect(mockGetSlide).toHaveBeenCalled());
    await userEvent.click(await screen.findByText('select-element-0'));

    const select = await screen.findByTitle('Font family');
    const optionLabels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(optionLabels).toContain('My Custom Font');
  });
});
