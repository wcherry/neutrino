/**
 * The import run outliving the page that started it
 * (`components/ImportRun/ImportRunProvider.tsx`).
 *
 * The run was always a plain async loop, so it already survived a route
 * change; what did not was any sight of it. These cover the part that changed:
 * unmounting `/import` leaves the run going and its progress readable, and
 * mounting the page again lands back on that run rather than on a fresh picker.
 */

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ImportRunProvider,
  useImportRun,
  type ImportStep,
} from '@/components/ImportRun';
import type { ImportProgress, ImportSummary, TakeoutArchive } from '@/lib/takeout';

const { pushMock, pathname } = vi.hoisted(() => ({ pushMock: vi.fn(), pathname: { value: '/drive' } }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => pathname.value,
}));

const summary = (extra: Partial<ImportSummary> = {}): ImportSummary => ({
  total: 1,
  imported: 1,
  skipped: 0,
  failed: 0,
  items: [],
  folderId: null,
  cancelled: false,
  unencrypted: false,
  ...extra,
});

function fakeArchive(): TakeoutArchive & { closed: () => number } {
  let closed = 0;
  return {
    root: 'Takeout/',
    products: [],
    product: () => undefined,
    close: async () => {
      closed++;
    },
    closed: () => closed,
  };
}

/**
 * A step that hands control back to the test: it reports progress and finishes
 * only when the test says so, which is what makes "mid-run" a real state here.
 */
function controllableStep(count: number) {
  let report: (p: ImportProgress) => void = () => {};
  let finish: (s: ImportSummary) => void = () => {};
  const step: ImportStep = {
    product: 'Photos',
    count,
    run: ({ onProgress }) =>
      new Promise<ImportSummary>((resolve) => {
        report = onProgress;
        finish = resolve;
      }),
  };
  return {
    step,
    report: (done: number, current: string) =>
      act(() => report({ done, total: count, current })),
    finish: () => act(async () => finish(summary())),
  };
}

/** Stands in for `/import`: mounts and unmounts, reading the shared run. */
function ImportScreen() {
  const run = useImportRun();
  if (run.state.status === 'running') {
    return (
      <div>
        <span>page:running</span>
        <span>
          page:{run.state.progress.done}/{run.state.progress.total}
        </span>
        <span>page:{run.state.progress.current}</span>
      </div>
    );
  }
  if (run.state.status === 'done') return <span>page:done</span>;
  return <span>page:picker</span>;
}

/** The shell: the provider stays mounted while the route inside it changes. */
function Harness({ step, archive }: { step: ImportStep; archive: TakeoutArchive }) {
  const [onImport, setOnImport] = useState(true);
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImportRunProvider>
        <button onClick={() => setOnImport((v) => !v)}>toggle route</button>
        <Starter step={step} archive={archive} />
        {onImport && <ImportScreen />}
      </ImportRunProvider>
    </QueryClientProvider>
  );
}

function Starter({ step, archive }: { step: ImportStep; archive: TakeoutArchive }) {
  const run = useImportRun();
  return (
    <button onClick={() => run.start({ fileName: 'takeout.zip', archive, steps: [step] })}>
      start run
    </button>
  );
}

const leaveImport = () => act(() => void screen.getByText('toggle route').click());
const backToImport = leaveImport;

beforeEach(() => {
  pathname.value = '/drive';
  pushMock.mockClear();
});

describe('an import run across a route change', () => {
  it('keeps running, and keeps its progress, when the page unmounts', async () => {
    const { step, report, finish } = controllableStep(10);
    const archive = fakeArchive();
    render(<Harness step={step} archive={archive} />);

    act(() => screen.getByText('start run').click());
    await report(3, 'IMG_3.jpg');
    expect(screen.getByText('page:3/10')).toBeTruthy();

    // Switch to another app: the page goes, the run does not.
    await leaveImport();
    expect(screen.queryByText('page:running')).toBeNull();

    // The floating indicator is what carries the progress bar across.
    await report(7, 'IMG_7.jpg');
    expect(screen.getByText(/7 of 10/)).toBeTruthy();
    expect(screen.getByText(/IMG_7\.jpg/)).toBeTruthy();

    // Coming back lands on the live run, not on a fresh picker.
    await backToImport();
    expect(screen.getByText('page:running')).toBeTruthy();
    expect(screen.getByText('page:7/10')).toBeTruthy();

    await finish();
    await waitFor(() => expect(screen.getByText('page:done')).toBeTruthy());
    expect(archive.closed()).toBe(1);
  });

  it('refuses to start a second run over the same files', async () => {
    // Every start would upload the same files again, so the guard is counted
    // at the step itself rather than inferred from what is on screen.
    const runs = vi.fn(() => new Promise<ImportSummary>(() => {}));
    const step: ImportStep = { product: 'Photos', count: 4, run: runs };
    render(<Harness step={step} archive={fakeArchive()} />);

    act(() => screen.getByText('start run').click());
    act(() => screen.getByText('start run').click());
    act(() => screen.getByText('start run').click());

    expect(runs).toHaveBeenCalledTimes(1);
  });

  it('lets a new run start once the last one has finished', async () => {
    const { step, finish } = controllableStep(2);
    const runs = vi.spyOn(step, 'run');
    render(<Harness step={step} archive={fakeArchive()} />);

    act(() => screen.getByText('start run').click());
    await finish();
    await waitFor(() => expect(screen.getByText('page:done')).toBeTruthy());

    act(() => screen.getByText('start run').click());
    expect(runs).toHaveBeenCalledTimes(2);
  });

  it('hides the floating indicator on the import page itself', async () => {
    pathname.value = '/import';
    const { step, report } = controllableStep(10);
    render(<Harness step={step} archive={fakeArchive()} />);

    act(() => screen.getByText('start run').click());
    await report(3, 'IMG_3.jpg');
    // The page shows the run in full; a floating copy would duplicate it.
    expect(screen.queryByText(/3 of 10/)).toBeNull();
    expect(screen.getByText('page:3/10')).toBeTruthy();
  });

  it('takes the user back to the import when the indicator is clicked', async () => {
    const { step, report } = controllableStep(10);
    render(<Harness step={step} archive={fakeArchive()} />);

    act(() => screen.getByText('start run').click());
    await report(1, 'a.jpg');
    await leaveImport();

    act(() => screen.getByLabelText('Go to the import in progress').click());
    expect(pushMock).toHaveBeenCalledWith('/import');
  });

  it('closes the archive once the run ends, not when the page unmounts', async () => {
    const { step, finish } = controllableStep(2);
    const archive = fakeArchive();
    render(<Harness step={step} archive={archive} />);

    act(() => screen.getByText('start run').click());
    await leaveImport();
    // Still reading out of it, so it must still be open.
    expect(archive.closed()).toBe(0);

    await finish();
    await waitFor(() => expect(archive.closed()).toBe(1));
  });
});
