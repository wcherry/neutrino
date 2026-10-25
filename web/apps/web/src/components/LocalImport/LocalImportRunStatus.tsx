'use client';

/**
 * A local run, as the provider holds it: progress while it runs, the result
 * (with retry) once done, the error if it threw.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import { Check, RotateCcw } from 'lucide-react';
import { Alert, Button, ProgressBar } from '@neutrino/ui';
import { canEncryptFor } from '@neutrino/api-drive';
import { useUser } from '@neutrino/auth';
import { useImportRun, type RetryTarget } from '@/components/ImportRun';
import { LOCAL_IMPORT_LOCKED_MESSAGE } from './useLocalImport';
import styles from './LocalImport.module.css';

export interface LocalImportRunStatusProps {
  /** Back to picking: the run has been dismissed. */
  onImportMore(): void;
}

export function LocalImportRunStatus({ onImportMore }: LocalImportRunStatusProps) {
  const router = useRouter();
  const user = useUser();
  const run = useImportRun();
  const [retryError, setRetryError] = React.useState<string | null>(null);
  const { state } = run;

  if (state.status === 'idle' || state.kind !== 'local') return null;

  const importMore = () => {
    run.dismiss();
    onImportMore();
  };

  if (state.status === 'running') {
    const { done, total, current } = state.progress;
    return (
      <section className={styles.runBox} aria-label="Import progress">
        <ProgressBar
          value={total > 0 ? (done / total) * 100 : 0}
          label={`Importing ${done.toLocaleString()} of ${total.toLocaleString()}`}
        />
        <div className={styles.runCurrent}>{current}</div>
        <p className={styles.note}>
          You can close this and keep using Neutrino — a progress pill shows how far it has got.
        </p>
        <div>
          <Button variant="secondary" size="sm" onClick={run.cancel}>
            Stop
          </Button>
        </div>
      </section>
    );
  }

  if (state.status === 'failed') {
    return (
      <section className={styles.runBox} aria-label="Import result">
        <Alert variant="error" title="The import stopped" message={state.error} />
        <div className={styles.actions}>
          <Button variant="secondary" onClick={importMore}>
            Import more
          </Button>
        </div>
      </section>
    );
  }

  const failures = state.results.flatMap((r) =>
    r.summary.items.filter((i) => i.status === 'failed').map((i) => ({ ...i, product: r.product })),
  );
  const totals = state.results.reduce(
    (acc, r) => ({
      imported: acc.imported + r.summary.imported,
      skipped: acc.skipped + r.summary.skipped,
      failed: acc.failed + r.summary.failed,
    }),
    { imported: 0, skipped: 0, failed: 0 },
  );
  const cancelled = state.results.some((r) => r.summary.cancelled);
  const unencrypted = state.results.some((r) => r.summary.unencrypted);

  const retry = async (targets: RetryTarget[]) => {
    if (targets.length === 0) return;
    if (!(await canEncryptFor(user?.id))) {
      setRetryError(LOCAL_IMPORT_LOCKED_MESSAGE);
      return;
    }
    setRetryError(null);
    run.retry(targets);
  };

  return (
    <section className={styles.runBox} aria-label="Import result">
      <div className={styles.resultHead}>
        <Check size={20} className={styles.resultIcon} aria-hidden="true" />
        <div>
          <div className={styles.resultTitle}>{cancelled ? 'Import stopped' : 'Import finished'}</div>
          <div className={styles.resultCounts}>
            {totals.imported.toLocaleString()} imported · {totals.skipped.toLocaleString()} skipped ·{' '}
            {totals.failed.toLocaleString()} failed
          </div>
        </div>
      </div>

      {unencrypted && <Alert variant="warning" message={LOCAL_IMPORT_LOCKED_MESSAGE} />}
      {retryError && <Alert variant="error" message={retryError} />}

      {failures.length > 0 && (
        <div className={styles.failList}>
          <div className={styles.failHead}>
            <h3 className={styles.failHeading}>Failed</h3>
            {state.retryable && failures.length > 1 && (
              <Button
                variant="secondary"
                size="sm"
                icon={<RotateCcw size={14} aria-hidden="true" />}
                onClick={() => void retry(failures.map(({ product, file }) => ({ product, file })))}
              >
                Retry all {failures.length.toLocaleString()} failed
              </Button>
            )}
          </div>
          <ul className={styles.failRows}>
            {failures.map((item) => (
              <li key={`${item.product}:${item.file}`} className={styles.failRow}>
                <span className={styles.failTitle} title={item.file}>
                  {item.title}
                </span>
                <span className={styles.failReason}>{item.reason}</span>
                {state.retryable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Retry ${item.title}`}
                    onClick={() => void retry([{ product: item.product, file: item.file }])}
                  >
                    Retry
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.actions}>
        <Button onClick={() => router.push('/drive')}>Open Drive</Button>
        <Button variant="secondary" onClick={importMore}>
          Import more
        </Button>
      </div>
    </section>
  );
}
