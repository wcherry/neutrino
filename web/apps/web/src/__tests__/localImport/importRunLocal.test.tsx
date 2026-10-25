/**
 * A local import running through the shared import run
 * (`components/ImportRun/ImportRunProvider.tsx`).
 *
 * The provider was written for Takeout and stays product-ignorant; what the
 * local import adds is a `kind` on the plan and the state, a no-op source in
 * place of an archive, and a pill that stays once the run is done — the local
 * import's results are not on a page the user is looking at, so without it a
 * finished import would simply vanish.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImportRunProvider, useImportRun, type ImportStep, type ImportPlan } from '@/components/ImportRun';
import type { ImportProgress, ImportSummary, TakeoutArchive } from '@/lib/takeout';

const { pushMock, pathname } = vi.hoisted(() => ({ pushMock: vi.fn(), pathname: { value: '/drive' } }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => pathname.value,
}));

const summary = (extra: Partial<ImportSummary> = {}): ImportSummary => ({
  total: 2,
  imported: 2,
  skipped: 0,
  failed: 0,
  items: [
    { file: 'Trip/a.jpg', title: 'a.jpg', status: 'imported' },
    { file: 'Trip/b.jpg', title: 'b.jpg', status: 'imported' },
  ],
  folderId: null,
  cancelled: false,
  unencrypted: false,
  ...extra,
});

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
    report: (done: number, current: string) => act(() => report({ done, total: count, current })),
    finish: () => act(async () => finish(summary())),
  };
}

function takeoutArchive(): TakeoutArchive {
  return {
    root: 'Takeout/',
    partCount: 1,
    products: [],
    product: () => undefined,
    close: async () => {},
  };
}

/** Shows what the provider's state says, so tests can read `kind`. */
function StateProbe() {
  const { state } = useImportRun();
  const kind = (state as { kind?: string }).kind;
  return (
    <span data-testid="probe">
      {state.status}:{kind ?? 'none'}
    </span>
  );
}

function Starter({ plan }: { plan: ImportPlan }) {
  const run = useImportRun();
  return <button onClick={() => run.start(plan)}>start run</button>;
}

function Harness({ plan }: { plan: ImportPlan }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImportRunProvider>
        <Starter plan={plan} />
        <StateProbe />
      </ImportRunProvider>
    </QueryClientProvider>
  );
}

const probe = () => screen.getByTestId('probe').textContent;

function localPlan(step: ImportStep): ImportPlan {
  // The local import has no archive; a no-op source stands in for one.
  return {
    fileName: 'Holiday',
    archive: { close: async () => {} },
    steps: [step],
    kind: 'local',
  } as ImportPlan;
}

beforeEach(() => {
  pathname.value = '/drive';
  pushMock.mockClear();
});

describe('a local import run', () => {
  it("carries kind 'local' while running", async () => {
    const { step, report } = controllableStep(2);
    render(<Harness plan={localPlan(step)} />);

    act(() => screen.getByText('start run').click());
    await report(1, 'a.jpg');

    expect(probe()).toBe('running:local');
  });

  it("carries kind 'local' once done", async () => {
    const { step, finish } = controllableStep(2);
    render(<Harness plan={localPlan(step)} />);

    act(() => screen.getByText('start run').click());
    await finish();

    await waitFor(() => expect(probe()).toBe('done:local'));
  });

  it('keeps a pill on screen once done, away from /import', async () => {
    const { step, finish } = controllableStep(2);
    render(<Harness plan={localPlan(step)} />);

    act(() => screen.getByText('start run').click());
    await finish();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /import finished/i })).toBeTruthy(),
    );
  });

  it('dismissing the done pill returns the run to idle', async () => {
    const { step, finish } = controllableStep(2);
    render(<Harness plan={localPlan(step)} />);

    act(() => screen.getByText('start run').click());
    await finish();
    await waitFor(() => expect(screen.getByRole('button', { name: /import finished/i })).toBeTruthy());

    act(() => screen.getByRole('button', { name: 'Dismiss' }).click());

    await waitFor(() => expect(probe()).toBe('idle:none'));
    expect(screen.queryByRole('button', { name: /import finished/i })).toBeNull();
  });

  it('shows no done pill on /import itself, which renders the results', async () => {
    pathname.value = '/import';
    const { step, finish } = controllableStep(2);
    render(<Harness plan={localPlan(step)} />);

    act(() => screen.getByText('start run').click());
    await finish();
    await waitFor(() => expect(probe()).toBe('done:local'));

    expect(screen.queryByRole('button', { name: /import finished/i })).toBeNull();
  });
});

describe('a Takeout run, unchanged', () => {
  it("defaults kind to 'takeout' when the plan names none", async () => {
    const { step, report } = controllableStep(2);
    render(<Harness plan={{ fileName: 'takeout.zip', archive: takeoutArchive(), steps: [step] }} />);

    act(() => screen.getByText('start run').click());
    await report(1, 'a.jpg');

    expect(probe()).toBe('running:takeout');
  });

  it('shows no pill once done', async () => {
    const { step, finish } = controllableStep(2);
    render(<Harness plan={{ fileName: 'takeout.zip', archive: takeoutArchive(), steps: [step] }} />);

    act(() => screen.getByText('start run').click());
    await finish();
    await waitFor(() => expect(probe()).toBe('done:takeout'));

    expect(screen.queryByRole('button', { name: /import finished/i })).toBeNull();
    expect(screen.queryByLabelText('Go to the import in progress')).toBeNull();
  });
});
