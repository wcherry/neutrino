/**
 * Tests that usePersistence shows a toast with a settings help link when
 * save() or updateTitle() is called but the encryption key (DEK) is
 * unavailable.
 *
 * Both code paths check `!dekRef.current` and call `toast.warning()` before
 * attempting any network call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useRef } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// All vi.mock() calls declared before the module under test is imported.
// ---------------------------------------------------------------------------

const mockWarning = vi.fn();

vi.mock('@neutrino/ui', () => ({
  useToast: () => ({
    warning: mockWarning,
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// No-DEK mock — dekRef.current is always null
vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef: { current: null },
    dekResolved: true,
    autosave: vi.fn(),
    createVersion: vi.fn(),
    isAutosaving: false,
    isCreatingVersion: false,
    autosaveError: null,
    createVersionError: null,
  }),
}));

vi.mock('@/lib/api', () => ({
  sheetsApi: {
    getSheet: vi.fn(() =>
      Promise.resolve({
        id: 'sheet-test-id',
        title: 'Test Sheet',
        contentUrl: '/api/v1/drive/files/sheet-test-id',
        contentWriteUrl: '/api/v1/drive/files/sheet-test-id/versions',
        folderId: null,
        createdAt: '',
        updatedAt: '',
      })
    ),
    autosaveEncryptedContent: vi.fn(() => Promise.resolve()),
    autosaveContent: vi.fn(() => Promise.resolve()),
  },
  driveReadContent: vi.fn(() => Promise.resolve(JSON.stringify({ sheets: [] }))),
  driveCreateVersion: vi.fn(() => Promise.resolve()),
  driveCreateEncryptedVersion: vi.fn(() => Promise.resolve()),
  storageApi: {
    downloadFile: vi.fn(() => Promise.resolve(new Blob())),
  },
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  decryptFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module imports — after all vi.mock() calls
// ---------------------------------------------------------------------------

import { usePersistence } from '../../app/(apps)/sheets/editor/hooks/usePersistence';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/**
 * Wrapper component that calls usePersistence with all required stubs and
 * exposes `save` and `updateTitle` via a ref so tests can invoke them.
 */
interface HarnessRef {
  save: () => Promise<void>;
  updateTitle: (e: React.FocusEvent<HTMLElement>) => Promise<void>;
  load: () => Promise<void>;
}

function PersistenceHarness({ harnessRef }: { harnessRef: React.MutableRefObject<HarnessRef | null> }) {
  const dirtyRef = useRef<boolean>(false);
  const sheetsDataRef = useRef<Map<string, unknown>[]>([new Map()]);
  const sheetsColWidthsRef = useRef<Map<number, number>[]>([new Map()]);
  const sheetsRowHeightsRef = useRef<Map<number, number>[]>([new Map()]);
  const activeSheetIndexRef = useRef<number>(0);
  const sheetNamesRef = useRef<string[]>(['Sheet 1']);
  const sheetColorsRef = useRef<(string | null)[]>([null]);

  const result = usePersistence({
    sheetId: 'sheet-test-id',
    dirtyRef: dirtyRef as React.MutableRefObject<boolean>,
    sheetsDataRef: sheetsDataRef as React.MutableRefObject<Map<string, unknown>[]>,
    sheetsColWidthsRef,
    sheetsRowHeightsRef,
    activeSheetIndexRef,
    sheetNamesRef,
    sheetColorsRef,
    flushActiveSheet: vi.fn(),
    setData: vi.fn(),
    setColWidths: vi.fn(),
    setRowHeights: vi.fn(),
    setSheetNames: vi.fn(),
    setSheetColors: vi.fn(),
  } as Parameters<typeof usePersistence>[0]);

  harnessRef.current = {
    save: result.save,
    updateTitle: result.updateTitle,
    load: result.load,
  };

  return null;
}

function renderHarness() {
  const qc = makeQueryClient();
  const harnessRef = React.createRef<HarnessRef | null>() as React.MutableRefObject<HarnessRef | null>;

  render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(PersistenceHarness, { harnessRef })
    )
  );

  return harnessRef;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePersistence — encryption warning toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('save() shows a toast with a settings link when DEK is unavailable', async () => {
    const harnessRef = renderHarness();

    // Populate sheetRef via load() so save() passes the early-return guard
    await act(async () => {
      await harnessRef.current!.load();
    });

    await act(async () => {
      await harnessRef.current!.save();
    });

    await waitFor(() => expect(mockWarning).toHaveBeenCalled(), { timeout: 3000 });

    const message = mockWarning.mock.calls[0][0] as React.ReactNode;
    const { getByRole } = render(React.createElement(React.Fragment, null, message));
    expect(getByRole('link')).toHaveAttribute('href', '/settings?tab=advanced');
  });

  it('updateTitle() shows a toast with a settings link when DEK is unavailable', async () => {
    const harnessRef = renderHarness();

    // Populate sheetRef via load() so updateTitle() passes its guard
    await act(async () => {
      await harnessRef.current!.load();
    });

    // Build a synthetic FocusEvent whose currentTarget.innerHTML differs from
    // the current title ('Test Sheet') so updateTitle() does not bail out early.
    const fakeEl = document.createElement('div');
    fakeEl.innerHTML = 'Renamed Sheet';
    const fakeEvent = { currentTarget: fakeEl } as unknown as React.FocusEvent<HTMLElement>;

    await act(async () => {
      await harnessRef.current!.updateTitle(fakeEvent);
    });

    await waitFor(() => expect(mockWarning).toHaveBeenCalled(), { timeout: 3000 });

    const message = mockWarning.mock.calls[0][0] as React.ReactNode;
    const { getByRole } = render(React.createElement(React.Fragment, null, message));
    expect(getByRole('link')).toHaveAttribute('href', '/settings?tab=advanced');
  });
});
