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
 * the archive handle (closed when the run ends, not when the page goes away),
 * the query invalidation, and the floating indicator.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ProgressBar } from '@neutrino/ui';
import type { ImportProgress, ImportSummary, TakeoutArchive } from '@/lib/takeout';
import { describeError, logFail, logStep } from '@/lib/takeout/log';
import styles from './ImportRunIndicator.module.css';

/** One product's pass over the archive. The page supplies these. */
export interface ImportStep {
  /** Labels the product's rows on the result screen, e.g. `Photos`. */
  product: string;
  /** Items this step will process, for the shared total. */
  count: number;
  run(args: { onProgress: (p: ImportProgress) => void; signal: AbortSignal }): Promise<ImportSummary>;
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
  | { status: 'done'; fileName: string; results: ProductResult[] }
  | { status: 'failed'; fileName: string; error: string };

interface ImportRunContextValue {
  state: ImportRunState;
  /** Start a run. Ignored when one is already going. */
  start(plan: ImportPlan): void;
  /** Ask the running import to stop after the item it is on. */
  cancel(): void;
  /** Clear a finished or failed run, back to idle. */
  dismiss(): void;
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

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const dismiss = useCallback(() => {
    if (runningRef.current) return;
    setState({ status: 'idle' });
  }, []);

  const start = useCallback(
    (plan: ImportPlan) => {
      if (runningRef.current) {
        logStep('page', 'ignoring a second start while a run is going');
        return;
      }
      runningRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      const total = plan.steps.reduce((sum, step) => sum + step.count, 0);
      setState({ status: 'running', fileName: plan.fileName, progress: { done: 0, total, current: '' } });
      logStep('page', 'starting run', {
        archive: plan.fileName,
        steps: plan.steps.map((s) => `${s.product} (${s.count})`),
      });

      void (async () => {
        const done: ProductResult[] = [];
        /** Items finished by the steps before the one running, for the shared bar. */
        let offset = 0;
        try {
          for (const step of plan.steps) {
            // A stopped run means the user stopped the whole import, not just
            // the product that was running at the time.
            if (done.some((r) => r.summary.cancelled)) break;
            const summary = await step.run({
              onProgress: (p) =>
                setState((prev) =>
                  prev.status === 'running'
                    ? { ...prev, progress: { done: offset + p.done, total, current: p.current } }
                    : prev,
                ),
              signal: controller.signal,
            });
            done.push({ product: step.product, summary });
            offset += step.count;
          }

          // The per-item detail is in each runner's log; this is the one place
          // the whole run can be read at a glance, including what failed.
          logStep(
            'page',
            'run finished',
            done.map((r) => ({
              product: r.product,
              imported: r.summary.imported,
              skipped: r.summary.skipped,
              failed: r.summary.failed,
              cancelled: r.summary.cancelled,
              failures: r.summary.items.filter((i) => i.status === 'failed'),
            })),
          );

          setState({ status: 'done', fileName: plan.fileName, results: done });
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
          // The archive's reader and worker pool are the run's to release: the
          // page that opened it may have been unmounted long ago.
          plan.archive.close().catch(() => {});
        }
      })();
    },
    [queryClient],
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
    () => ({ state, start, cancel, dismiss }),
    [state, start, cancel, dismiss],
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
