/**
 * Retrying the files an import failed on
 * (`components/ImportRun/ImportRunProvider.tsx`, issue #155).
 *
 * A failure part-way through a photo library is ordinary — an expired session,
 * a 413, a file the browser could not decode — and the only recovery used to be
 * running the whole archive again. These cover the provider's half of the fix:
 * that a retry re-runs the named files and nothing else, that its outcome is
 * merged into the run it belongs to rather than replacing it, and that the zip
 * reader is still open for it to read out of.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImportRunProvider, useImportRun, type ImportStep } from '@/components/ImportRun';
import type { ImportItem, ImportSummary, TakeoutArchive } from '@/lib/takeout';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/import',
}));

/** What the provider hands a step, including the `only` set a retry narrows it to. */
type RunArgs = Parameters<ImportStep['run']>[0];

const item = (file: string, status: ImportItem['status']): ImportItem => ({
  file,
  title: file,
  status,
  ...(status === 'failed' ? { reason: 'HTTP 500' } : {}),
});

const summary = (items: ImportItem[], extra: Partial<ImportSummary> = {}): ImportSummary => ({
  total: items.length,
  imported: items.filter((i) => i.status === 'imported').length,
  skipped: items.filter((i) => i.status === 'skipped').length,
  failed: items.filter((i) => i.status === 'failed').length,
  items,
  folderId: null,
  cancelled: false,
  unencrypted: false,
  ...extra,
});

function fakeArchive(): TakeoutArchive & { closed: () => number } {
  let closed = 0;
  return {
    root: 'Takeout/',
    partCount: 1,
    products: [],
    product: () => undefined,
    close: async () => {
      closed++;
    },
    closed: () => closed,
  };
}

/** Reads the run and drives it: start, retry the failures, dismiss. */
function Screen({ steps, archive }: { steps: ImportStep[]; archive: TakeoutArchive }) {
  const run = useImportRun();
  const failures =
    run.state.status === 'done'
      ? run.state.results.flatMap((r) =>
          r.summary.items
            .filter((i) => i.status === 'failed')
            .map((i) => ({ product: r.product, file: i.file })),
        )
      : [];
  return (
    <div>
      <button onClick={() => run.start({ fileName: 'takeout.zip', archive, steps })}>start</button>
      <button onClick={() => run.retry(failures)}>retry all</button>
      <button onClick={() => run.retry(failures.slice(0, 1))}>retry first</button>
      <button onClick={() => run.dismiss()}>dismiss</button>
      <span>status:{run.state.status}</span>
      {run.state.status === 'running' && (
        <span>
          progress:{run.state.progress.done}/{run.state.progress.total}
        </span>
      )}
      {run.state.status === 'done' && (
        <>
          <span>retryable:{String(run.state.retryable)}</span>
          <span>failures:{failures.map((f) => `${f.product}/${f.file}`).join(',')}</span>
          <span>
            counts:
            {run.state.results.map((r) => `${r.product} ${r.summary.imported}/${r.summary.failed}`).join(' ')}
          </span>
        </>
      )}
    </div>
  );
}

function renderRun(steps: ImportStep[], archive: TakeoutArchive) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImportRunProvider>
        <Screen steps={steps} archive={archive} />
      </ImportRunProvider>
    </QueryClientProvider>,
  );
}

const click = (label: string) => act(() => void screen.getByText(label).click());

beforeEach(() => {
  pushMock.mockClear();
});

describe('retrying failed items', () => {
  it('re-runs only the files that failed, in only the products that had one', async () => {
    const notes = vi.fn(async (_args: RunArgs) =>
      summary([item('a.json', 'imported'), item('b.json', 'failed')]),
    );
    const photos = vi.fn(async (_args: RunArgs) => summary([item('x.jpg', 'imported')]));
    const steps: ImportStep[] = [
      { product: 'Notes', count: 2, run: notes },
      { product: 'Photos', count: 1, run: photos },
    ];

    renderRun(steps, fakeArchive());
    await act(async () => void screen.getByText('start').click());
    await waitFor(() => expect(screen.getByText('status:done')).toBeTruthy());

    notes.mockResolvedValueOnce(summary([item('b.json', 'imported')], { total: 1 }));
    await act(async () => void screen.getByText('retry all').click());
    await waitFor(() => expect(screen.getByText('status:done')).toBeTruthy());

    // The photos step imported everything, so it is not run a second time.
    expect(photos).toHaveBeenCalledTimes(1);
    expect(notes).toHaveBeenCalledTimes(2);
    expect([...(notes.mock.calls[1][0].only ?? [])]).toEqual(['b.json']);
  });

  it('merges the retry into the run rather than replacing it', async () => {
    const notes = vi.fn(async () =>
      summary([item('a.json', 'imported'), item('b.json', 'failed'), item('c.json', 'failed')]),
    );
    renderRun([{ product: 'Notes', count: 3, run: notes }], fakeArchive());

    await act(async () => void screen.getByText('start').click());
    await waitFor(() => expect(screen.getByText('counts:Notes 1/2')).toBeTruthy());

    notes.mockResolvedValueOnce(summary([item('b.json', 'imported')], { total: 1 }));
    await act(async () => void screen.getByText('retry first').click());

    // One more imported, one fewer failed — not "1 imported" for the whole run.
    await waitFor(() => expect(screen.getByText('counts:Notes 2/1')).toBeTruthy());
    expect(screen.getByText('failures:Notes/c.json')).toBeTruthy();
  });

  it('counts only the retried items in the progress bar', async () => {
    let report: (p: { done: number; total: number; current: string }) => void = () => {};
    let finish: (s: ImportSummary) => void = () => {};
    const notes = vi
      .fn()
      .mockResolvedValueOnce(
        summary([item('a.json', 'imported'), item('b.json', 'failed'), item('c.json', 'failed')]),
      )
      .mockImplementationOnce(
        ({ onProgress }: { onProgress: typeof report }) =>
          new Promise<ImportSummary>((resolve) => {
            report = onProgress;
            finish = resolve;
          }),
      );

    renderRun([{ product: 'Notes', count: 3, run: notes }], fakeArchive());
    await act(async () => void screen.getByText('start').click());
    await waitFor(() => expect(screen.getByText('status:done')).toBeTruthy());

    await act(async () => void screen.getByText('retry all').click());
    act(() => report({ done: 1, total: 2, current: 'b.json' }));

    // Two failures, not the three the archive holds.
    expect(screen.getByText('progress:1/2')).toBeTruthy();
    await act(async () => {
      finish(summary([item('b.json', 'imported'), item('c.json', 'imported')], { total: 2 }));
    });
  });

  it('keeps the zip reader open while something can still be retried', async () => {
    const archive = fakeArchive();
    const notes = vi.fn(async () => summary([item('a.json', 'imported'), item('b.json', 'failed')]));
    renderRun([{ product: 'Notes', count: 2, run: notes }], archive);

    await act(async () => void screen.getByText('start').click());
    await waitFor(() => expect(screen.getByText('retryable:true')).toBeTruthy());
    // The bytes a retry needs are in there.
    expect(archive.closed()).toBe(0);

    notes.mockResolvedValueOnce(summary([item('b.json', 'imported')], { total: 1 }));
    await act(async () => void screen.getByText('retry all').click());

    // Nothing left to retry, so the reader and its workers go.
    await waitFor(() => expect(screen.getByText('retryable:false')).toBeTruthy());
    expect(archive.closed()).toBe(1);
  });

  it('releases a retryable archive when the run is dismissed', async () => {
    const archive = fakeArchive();
    renderRun(
      [
        {
          product: 'Notes',
          count: 1,
          run: async () => summary([item('a.json', 'failed')]),
        },
      ],
      archive,
    );

    await act(async () => void screen.getByText('start').click());
    await waitFor(() => expect(screen.getByText('retryable:true')).toBeTruthy());
    expect(archive.closed()).toBe(0);

    click('dismiss');
    await waitFor(() => expect(archive.closed()).toBe(1));
    expect(screen.getByText('status:idle')).toBeTruthy();
  });

  it('ignores a retry with nothing to retry', async () => {
    const notes = vi.fn(async () => summary([item('a.json', 'imported')]));
    renderRun([{ product: 'Notes', count: 1, run: notes }], fakeArchive());

    await act(async () => void screen.getByText('start').click());
    await waitFor(() => expect(screen.getByText('status:done')).toBeTruthy());

    // Nothing failed, so there is nothing to run and no second run to guard.
    click('retry all');
    expect(notes).toHaveBeenCalledTimes(1);
    expect(screen.getByText('status:done')).toBeTruthy();
  });
});
