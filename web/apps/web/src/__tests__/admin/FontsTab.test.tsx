/**
 * The admin console's Fonts tab (issue #207).
 *
 * The tab's job is to turn one drop into many installs, so what is worth
 * pinning down is what would be wrong *quietly*: that a family archive becomes
 * one row per font with a readable name already in it, that unticking a row
 * means that font is not uploaded at all, that an edited name is the name the
 * server is given, and that one font failing does not take the rest of the
 * family down with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const listFonts = vi.fn();
const uploadFont = vi.fn();
const deleteFont = vi.fn();

vi.mock('@neutrino/api-admin', () => ({
  adminApi: {
    uploadFont: (...a: unknown[]) => uploadFont(...a),
    deleteFont: (...a: unknown[]) => deleteFont(...a),
  },
  fontsApi: {
    list: (...a: unknown[]) => listFonts(...a),
  },
}));

vi.mock('@neutrino/api-core', () => ({
  ApiClientError: class ApiClientError extends Error {},
}));

/**
 * `DropZone` is mocked down to a bare file input: the drag-and-drop surface is
 * its own component's concern, and what this tab does with the files is not.
 */
vi.mock('@neutrino/ui', () => ({
  Spinner: () => <div data-testid="spinner" />,
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <input
      type="file"
      aria-label="drop zone"
      onChange={(e) => onFiles(Array.from(e.target.files ?? []))}
    />
  ),
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

import JSZip from 'jszip';
import { FontsTab } from '@/app/(apps)/admin/FontsTab';

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderTab() {
  return render(
    <QueryClientProvider client={makeQC()}>
      <FontsTab />
    </QueryClientProvider>,
  );
}

function bytes(size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * 2654435761) % 256;
  return out;
}

async function zipOf(name: string, files: Record<string, Uint8Array>): Promise<File> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], name, { type: 'application/zip' });
}

/**
 * Hands the tab a drop, as `DropZone` would.
 *
 * Wrapped in `act` because reading the archive is asynchronous: the state
 * updates that follow it land after the change event has returned.
 */
async function drop(files: File[]) {
  const input = screen.getByLabelText('drop zone') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => {
    fireEvent.change(input);
  });
}

/** The row for a candidate, found by the checkbox that installs it. */
function rowFor(path: string): HTMLElement {
  return screen.getByLabelText(`Install ${path}`).closest('tr') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  listFonts.mockResolvedValue([]);
  uploadFont.mockResolvedValue({ id: 'f1', displayName: 'x', format: 'ttf', fileUrl: '' });
  deleteFont.mockResolvedValue(undefined);
});

describe('FontsTab', () => {
  it('turns a family archive into one named row per font', async () => {
    renderTab();
    await screen.findByText('No custom fonts uploaded yet.');

    await drop([
      await zipOf('Roboto.zip', {
        'Roboto/Roboto-Regular.ttf': bytes(100),
        'Roboto/Roboto-BoldItalic.ttf': bytes(110),
        'Roboto/OFL.txt': bytes(20),
      }),
    ]);

    await waitFor(() => expect(screen.getByText('2 of 2 selected')).toBeTruthy());
    expect(
      (screen.getByLabelText('Display name for Roboto/Roboto-BoldItalic.ttf') as HTMLInputElement)
        .value,
    ).toBe('Roboto Bold Italic');
    // The licence is not a font and is not a problem worth reporting either.
    expect(screen.queryByText(/OFL\.txt/)).toBeNull();
  });

  it('uploads only the ticked fonts, under the names shown', async () => {
    renderTab();
    await screen.findByText('No custom fonts uploaded yet.');

    await drop([
      await zipOf('Roboto.zip', {
        'Roboto-Regular.ttf': bytes(100),
        'Roboto-Bold.ttf': bytes(110),
      }),
    ]);
    await waitFor(() => expect(screen.getByText('2 of 2 selected')).toBeTruthy());

    fireEvent.click(within(rowFor('Roboto-Bold.ttf')).getByRole('checkbox'));
    await waitFor(() => expect(screen.getByText('1 of 2 selected')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Install font' }));

    await waitFor(() => expect(uploadFont).toHaveBeenCalledTimes(1));
    const [file, name] = uploadFont.mock.calls[0];
    expect((file as File).name).toBe('Roboto-Regular.ttf');
    expect(name).toBe('Roboto Regular');
  });

  it('sends an overridden name rather than the generated one', async () => {
    renderTab();
    await screen.findByText('No custom fonts uploaded yet.');

    await drop([new File([bytes(50)], 'AkzidenzGrotesk-Bd.otf', { type: 'font/otf' })]);
    await waitFor(() => expect(screen.getByText('1 of 1 selected')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Display name for AkzidenzGrotesk-Bd.otf'), {
      target: { value: 'Akzidenz Grotesk Bold' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Install font' }));

    await waitFor(() => expect(uploadFont).toHaveBeenCalledTimes(1));
    expect(uploadFont.mock.calls[0][1]).toBe('Akzidenz Grotesk Bold');
  });

  it('will not install a row whose name has been cleared', async () => {
    renderTab();
    await screen.findByText('No custom fonts uploaded yet.');

    await drop([new File([bytes(50)], 'Inter-Regular.woff2', { type: 'font/woff2' })]);
    await waitFor(() => expect(screen.getByText('1 of 1 selected')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Display name for Inter-Regular.woff2'), {
      target: { value: '  ' },
    });

    await waitFor(() => expect(screen.getByText('0 of 1 selected')).toBeTruthy());
    expect(screen.getByText('A display name is required.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /^Install/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('keeps the rest of the family when one font fails, and retries just that one', async () => {
    renderTab();
    await screen.findByText('No custom fonts uploaded yet.');

    await drop([
      await zipOf('Roboto.zip', {
        'Roboto-Regular.ttf': bytes(100),
        'Roboto-Bold.ttf': bytes(110),
      }),
    ]);
    await waitFor(() => expect(screen.getByText('2 of 2 selected')).toBeTruthy());

    uploadFont.mockImplementation((file: File) =>
      file.name === 'Roboto-Bold.ttf'
        ? Promise.reject(new Error('Unsupported font format'))
        : Promise.resolve({ id: 'f1' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Install 2 fonts' }));

    // The one that installed leaves the list; the one that did not stays on it
    // carrying the reason, so the retry is the same button.
    await waitFor(() => expect(screen.getByText('1 of 1 selected')).toBeTruthy());
    expect(screen.queryByLabelText('Install Roboto-Regular.ttf')).toBeNull();
    expect(screen.getByLabelText('Install Roboto-Bold.ttf')).toBeTruthy();
    expect(screen.getByText('Upload failed.')).toBeTruthy();

    // The button is disabled for the whole run, so the retry waits for the run
    // to finish rather than for the last row to appear — the two are a tick
    // apart and clicking in between does nothing at all.
    const retry = () => screen.getByRole('button', { name: 'Install font' }) as HTMLButtonElement;
    await waitFor(() => expect(retry().disabled).toBe(false));

    uploadFont.mockResolvedValue({ id: 'f2' });
    fireEvent.click(retry());

    await waitFor(() => expect(screen.queryByLabelText('Install Roboto-Bold.ttf')).toBeNull());
    expect(uploadFont).toHaveBeenCalledTimes(3);
  });

  it('takes no input while a run is going', async () => {
    renderTab();
    await screen.findByText('No custom fonts uploaded yet.');

    await drop([
      await zipOf('Roboto.zip', {
        'Roboto-Regular.ttf': bytes(100),
        'Roboto-Bold.ttf': bytes(110),
      }),
    ]);
    await waitFor(() => expect(screen.getByText('2 of 2 selected')).toBeTruthy());

    // Held open on the first font, so the run is observably mid-flight.
    let release: () => void = () => {};
    uploadFont.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ id: 'f1' }))),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Install 2 fonts' }));

    await waitFor(() => expect(screen.getByText('Installing… 0/2')).toBeTruthy());
    // Every control is out of reach: reticking a row mid-run would change a
    // list the run is already working through.
    expect(
      (screen.getByLabelText('Install Roboto-Bold.ttf') as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText('Display name for Roboto-Bold.ttf') as HTMLInputElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: /Installing/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    uploadFont.mockResolvedValue({ id: 'f2' });
    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.queryByRole('table')).toBeNull());
  });

  it('reports what it found but cannot install', async () => {
    renderTab();
    await screen.findByText('No custom fonts uploaded yet.');

    await drop([
      new File([bytes(10)], 'Inter-Regular.woff2', { type: 'font/woff2' }),
      new File(['hello'], 'notes.txt', { type: 'text/plain' }),
    ]);

    await waitFor(() => expect(screen.getByText('1 of 1 selected')).toBeTruthy());
    expect(screen.getByText(/notes\.txt — not a font or a zip archive/)).toBeTruthy();
  });

  it('says so when a drop holds no fonts at all', async () => {
    renderTab();
    await screen.findByText('No custom fonts uploaded yet.');

    await drop([new File(['hello'], 'notes.txt', { type: 'text/plain' })]);

    await waitFor(() =>
      expect(screen.getByText('No fonts were found in what you dropped.')).toBeTruthy(),
    );
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('warns when a name is already taken rather than refusing it', async () => {
    listFonts.mockResolvedValue([
      { id: 'f0', displayName: 'Inter Regular', format: 'woff2', fileUrl: '', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    renderTab();
    await screen.findByText('Inter Regular');

    await drop([new File([bytes(10)], 'Inter-Regular.woff2', { type: 'font/woff2' })]);

    await waitFor(() =>
      expect(screen.getByText('A font is already installed under this name.')).toBeTruthy(),
    );
    // A warning, not a block: re-installing a weight is a legitimate thing to do.
    expect((screen.getByRole('button', { name: /^Install/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('removes an installed font', async () => {
    listFonts.mockResolvedValue([
      { id: 'f0', displayName: 'Inter', format: 'woff2', fileUrl: '', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    renderTab();
    await screen.findByText('Inter');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(deleteFont).toHaveBeenCalledWith('f0'));
  });
});
