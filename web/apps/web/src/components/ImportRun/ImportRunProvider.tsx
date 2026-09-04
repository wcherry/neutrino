'use client';

/**
 * The running half of the Takeout import, lifted out of `/import`.
 *
 * An import is the longest-running thing in the app — a photo library is
 * routinely thousands of files — and it is all in-page JavaScript, because
 * every product is E2EE and only this device can encrypt it. The run itself was
 * always a plain async loop, so it already survived a route change; what did
 * not survive was any *sight* of it. `/import` owned the progress bar, so
 * switching to another app unmounted the only indication a run existed, and
 * coming back mounted a fresh page offering to start a second one over the same
 * files.
 *
 * So the run lives here instead, in a provider mounted in the `(apps)` shell
 * above the route. Navigating between apps re-renders `children`; this does not
 * unmount, so the run and its progress outlive the page that started it.
 *
 * The provider is deliberately ignorant of products. It sequences `ImportStep`s
 * and adds up their progress; the page builds those steps because it is what
 * knows about Keep and Drive and Photos. What the provider does own is
 * everything that has to outlive the page: the abort controller behind Stop,
 * the archive handle, the query invalidation, and the floating indicator.
 *
 * It also owns the retry (issue #155), and for the same reason: the result
 * screen is reachable after a route change, so the plan and the open archive a
 * retry reads out of cannot live on the page. A retry re-runs the steps already
 * held here, each narrowed to the files that failed in it, and its outcome is
 * merged into the run rather than replacing it (`mergeResults.ts`).
 *
 * That is what decides when the zip reader is released. A run that finished
 * with nothing failed closes it the moment it ends, as it always has; a run
 * with something still to retry keeps it open — the bytes to re-upload are in
 * there — until the retry leaves nothing over, the run is dismissed, or another
 * one starts.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ProgressBar } from '@neutrino/ui';
import type { ImportProgress, ImportSummary, TakeoutArchive } from '@/lib/takeout';
import { describeError, logFail, logStep } from '@/lib/takeout/log';
import { mergeResults } from './mergeResults';
import styles from './ImportRunIndicator.module.css';

/** One product's pass over the archive. The page supplies these. */
export interface ImportStep {
  /** Labels the product's rows on the result screen, e.g. `Photos`. */
  product: string;
  /** Items this step will process, for the shared total. */
  count: number;
  run(args: {
    onProgress: (p: ImportProgress) => void;
    signal: AbortSignal;
    /**
     * A retry: import only the files whose `ImportItem.file` is in here, and
     * leave the rest of the product alone. The step does the filtering, since
     * it is what holds the list; every runner reports `file` as the entry's
     * path inside the archive, so that is the key on both sides.
     */
    only?: ReadonlySet<string>;
  }): Promise<ImportSummary>;
}

/** One failed row, as the page asks for it to be run again. */
export interface RetryTarget {
  /** The `ImportStep.product` it came from. */
  product: string;
  /** Its `ImportItem.file`. */
  file: string;
}

/** One product's result, labelled so a combined list says where a row came from. */
export interface ProductResult {
  product: string;
  summary: ImportSummary;
}

export interface ImportPlan {
  /** The archive's file name, shown while the run is in progress. */
  fileName: string;
  /**
   * The open archive. Ownership transfers with the plan: the provider closes
   * it when the run ends, so the page must not close it after calling `start`.
   */
  archive: TakeoutArchive;
  steps: ImportStep[];
}

export type ImportRunState =
  | { status: 'idle' }
  | { status: 'running'; fileName: string; progress: ImportProgress }
  | {
      status: 'done';
      fileName: string;
      results: ProductResult[];
      /**
       * Whether `retry` can still do anything: something failed, and the
       * archive holding its bytes is still open.
       */
      retryable: boolean;
    }
  | { status: 'failed'; fileName: string; error: string };

interface ImportRunContextValue {
  state: ImportRunState;
  /** Start a run. Ignored when one is already going. */
  start(plan: ImportPlan): void;
  /**
   * Run the named failed items again, through the steps that produced them.
   * Ignored while a run is going, and when there is nothing left to read from.
   */
  retry(targets: RetryTarget[]): void;
  /** Ask the running import to stop after the item it is on. */
  cancel(): void;
  /** Clear a finished or failed run, back to idle. */
  dismiss(): void;
}

/** One step to run, narrowed to a subset of its files when this is a retry. */
interface Leg {
  step: ImportStep;
  /** Items this leg will process, for the shared total. */
  count: number;
  only?: ReadonlySet<string>;
}

const ImportRunContext = createContext<ImportRunContextValue | null>(null);

/**
 * The run state. Throws outside the provider rather than falling back to an
 * idle stand-in: a stand-in would make `start` a no-op, so a page mounted
 * without the provider would render an Import button that silently does
 * nothing — the one failure that would reach a user unnoticed.
 */
export function useImportRun(): ImportRunContextValue {
  const ctx = useContext(ImportRunContext);
  if (!ctx) throw new Error('useImportRun must be used inside an ImportRunProvider');
  return ctx;
}

export function ImportRunProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<ImportRunState>({ status: 'idle' });

  const abortRef = useRef<AbortController | null>(null);
  /** Guards against a second run being started over the same files. */
  const runningRef = useRef(false);
  /**
   * The plan behind the run on screen, for as long as its archive is worth
   * holding open — which is for as long as a retry could still read out of it.
   */
  const planRef = useRef<ImportPlan | null>(null);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  /**
   * Let go of the archive of the run just shown. Its reader holds a file
   * handle and a worker pool, so nothing keeps one alive past the point where
   * something could still be imported out of it.
   */
  const releaseArchive = useCallback(() => {
    const plan = planRef.current;
    planRef.current = null;
    plan?.archive.close().catch(() => {});
  }, []);

  const dismiss = useCallback(() => {
    if (runningRef.current) return;
    releaseArchive();
    setState({ status: 'idle' });
  }, [releaseArchive]);

  /**
   * Run some legs of a plan. Shared by `start` and `retry`, which differ only
   * in which legs those are and in whether there are earlier results to merge
   * what comes back into.
   */
  const launch = useCallback(
    (plan: ImportPlan, legs: Leg[], previous: ProductResult[] | null) => {
      runningRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      const total = legs.reduce((sum, leg) => sum + leg.count, 0);
      setState({ status: 'running', fileName: plan.fileName, progress: { done: 0, total, current: '' } });

      void (async () => {
        const done: ProductResult[] = [];
        /** Items finished by the legs before the one running, for the shared bar. */
        let offset = 0;
        /** Whether the archive is still worth holding open when this ends. */
        let retryable = false;
        try {
          for (const leg of legs) {
            // A stopped run means the user stopped the whole import, not just
            // the product that was running at the time.
            if (done.some((r) => r.summary.cancelled)) break;
            const summary = await leg.step.run({
              onProgress: (p) =>
                setState((prev) =>
                  prev.status === 'running'
                    ? { ...prev, progress: { done: offset + p.done, total, current: p.current } }
                    : prev,
                ),
              signal: controller.signal,
              only: leg.only,
            });
            done.push({ product: leg.step.product, summary });
            offset += leg.count;
          }

          // The per-item detail is in each runner's log; this is the one place
          // the whole run can be read at a glance, including what failed.
          logStep(
            'page',
            previous ? 'retry finished' : 'run finished',
            done.map((r) => ({
              product: r.product,
              imported: r.summary.imported,
              skipped: r.summary.skipped,
              failed: r.summary.failed,
              cancelled: r.summary.cancelled,
              failures: r.summary.items.filter((i) => i.status === 'failed'),
            })),
          );

          const results = previous ? mergeResults(previous, done) : done;
          retryable = results.some((r) => r.summary.items.some((i) => i.status === 'failed'));
          setState({ status: 'done', fileName: plan.fileName, results, retryable });
          // The notes, docs, sheets and photos lists and the drive tree all
          // gained files.
          for (const key of ['notes', 'docs', 'sheets', 'photos', 'albums', 'drive', 'folder-contents']) {
            queryClient.invalidateQueries({ queryKey: [key] });
          }
        } catch (err) {
          // A throw out of a runner is different from a per-item failure: it
          // means the run stopped before it could report anything, so this is
          // the only record of it.
          logFail('page', 'the run threw and stopped', err, { completed: done.map((r) => r.product) });
          setState({ status: 'failed', fileName: plan.fileName, error: describeError(err) });
        } finally {
          runningRef.current = false;
          abortRef.current = null;
          // The archive is the run's to release: the page that opened it may
          // have been unmounted long ago. It stays open only while there is
          // something in it left to retry — a retry re-uploads from the zip,
          // so closing it here would make the offer on screen a lie.
          if (!retryable) releaseArchive();
        }
      })();
    },
    [queryClient, releaseArchive],
  );

  const start = useCallback(
    (plan: ImportPlan) => {
      if (runningRef.current) {
        logStep('page', 'ignoring a second start while a run is going');
        return;
      }
      // A previous run's archive may still be open for a retry nobody asked
      // for; this one supersedes it.
      releaseArchive();
      planRef.current = plan;
      logStep('page', 'starting run', {
        archive: plan.fileName,
        steps: plan.steps.map((s) => `${s.product} (${s.count})`),
      });
      launch(
        plan,
        plan.steps.map((step) => ({ step, count: step.count })),
        null,
      );
    },
    [launch, releaseArchive],
  );

  const retry = useCallback(
    (targets: RetryTarget[]) => {
      if (runningRef.current) {
        logStep('page', 'ignoring a retry while a run is going');
        return;
      }
      const plan = planRef.current;
      const previous = state.status === 'done' ? state.results : null;
      if (!plan || !previous || targets.length === 0) return;

      const files = new Map<string, Set<string>>();
      for (const target of targets) {
        const forProduct = files.get(target.product) ?? new Set<string>();
        forProduct.add(target.file);
        files.set(target.product, forProduct);
      }

      const legs: Leg[] = plan.steps
        .filter((step) => files.has(step.product))
        .map((step) => {
          const only = files.get(step.product) as ReadonlySet<string>;
          return { step, count: only.size, only };
        });
      if (legs.length === 0) return;

      logStep('page', 'retrying', {
        archive: plan.fileName,
        steps: legs.map((leg) => `${leg.step.product} (${leg.count})`),
      });
      launch(plan, legs, previous);
    },
    [launch, state],
  );

  /**
   * A reload or a closed tab takes the run with it — none of this is on the
   * server. Navigating between apps is now safe, so the warning is limited to
   * the thing that genuinely loses work.
   */
  useEffect(() => {
    if (state.status !== 'running') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state.status]);

  const value = useMemo<ImportRunContextValue>(
    () => ({ state, start, retry, cancel, dismiss }),
    [state, start, retry, cancel, dismiss],
  );

  // `/import` renders the run in full, so the floating copy would be a
  // duplicate of what is already on screen.
  const showIndicator = state.status === 'running' && pathname !== '/import';

  return (
    <ImportRunContext.Provider value={value}>
      {children}
      {showIndicator && (
        <button
          type="button"
          className={styles.indicator}
          onClick={() => router.push('/import')}
          aria-label="Go to the import in progress"
        >
          <span className={styles.title}>Importing…</span>
          <ProgressBar
            value={state.progress.total > 0 ? (state.progress.done / state.progress.total) * 100 : 0}
          />
          <span className={styles.detail}>
            {state.progress.done} of {state.progress.total}
            {state.progress.current ? ` · ${state.progress.current}` : ''}
          </span>
        </button>
      )}
    </ImportRunContext.Provider>
  );
}
