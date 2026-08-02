'use client';

/**
 * Import from Google Takeout.
 *
 * A three-stage page: pick the zip, choose what comes across, watch it run.
 * The archive is opened in the browser and never uploaded — the import writes
 * through the ordinary notes API, one note at a time, because note content is
 * E2EE and only this device can encrypt it (see `lib/takeout/importKeep.ts`).
 */

import React, { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, FileJson, Package, X } from 'lucide-react';
import { Alert, Button, Checkbox, DropZone, ProgressBar, Spinner, TextInput } from '@neutrino/ui';
import { useUser } from '@neutrino/auth';
import {
  DEFAULT_KEEP_IMPORT_OPTIONS,
  findKeepNotes,
  openTakeout,
  runKeepImport,
  TakeoutError,
  type KeepImportOptions,
  type KeepImportProgress,
  type KeepImportSummary,
  type KeepSource,
  type TakeoutArchive,
} from '@/lib/takeout';
import styles from './page.module.css';

type Stage = 'pick' | 'configure' | 'running' | 'done';

interface LoadedArchive {
  fileName: string;
  archive: TakeoutArchive;
  keep: KeepSource | null;
}

export default function ImportPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useUser();

  const [stage, setStage] = useState<Stage>('pick');
  const [loaded, setLoaded] = useState<LoadedArchive | null>(null);
  const [options, setOptions] = useState<KeepImportOptions>(DEFAULT_KEEP_IMPORT_OPTIONS);
  const [progress, setProgress] = useState<KeepImportProgress | null>(null);
  const [summary, setSummary] = useState<KeepImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = () => {
    setStage('pick');
    setLoaded(null);
    setProgress(null);
    setSummary(null);
    setError(null);
  };

  const handleFiles = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setError(null);
    setReading(true);
    try {
      const archive = await openTakeout(file);
      const keep = await findKeepNotes(archive);
      setLoaded({ fileName: file.name, archive, keep });
      setStage('configure');
    } catch (err) {
      setError(
        err instanceof TakeoutError
          ? err.message
          : `Could not read ${file.name}. Make sure it is the .zip you downloaded from Google Takeout.`,
      );
    } finally {
      setReading(false);
    }
  }, []);

  const startImport = async () => {
    if (!loaded?.keep) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setStage('running');
    setProgress({ done: 0, total: loaded.keep.entries.length, current: '' });
    try {
      const result = await runKeepImport({
        entries: loaded.keep.entries,
        options,
        userId: user?.id,
        onProgress: setProgress,
        signal: controller.signal,
      });
      setSummary(result);
      setStage('done');
      // The notes list and the drive tree both gained files.
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['drive'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import failed.');
      setStage('configure');
    } finally {
      abortRef.current = null;
    }
  };

  const percent = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
  const failures = summary?.items.filter((i) => i.status === 'failed') ?? [];
  const skips = summary?.items.filter((i) => i.status === 'skipped') ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => router.back()} type="button">
          <ArrowLeft size={16} />
          Back
        </button>
        <h1 className={styles.heading}>Import</h1>
        <p className={styles.subheading}>
          Bring your data across from Google Takeout. The archive is read here in your browser and
          never uploaded.
        </p>
      </div>

      <div className={styles.body}>
        {error && <Alert variant="error" className={styles.alert} message={error} />}

        {/* ── Stage 1: pick the archive ──────────────────────────────────── */}
        {stage === 'pick' && (
          <section className={styles.section}>
            {reading ? (
              <div className={styles.reading}>
                <Spinner />
                <span>Reading archive…</span>
              </div>
            ) : (
              <DropZone
                onFiles={handleFiles}
                multiple={false}
                accept=".zip,application/zip"
                label="Drop your Takeout .zip here"
                hint="or click to browse"
              />
            )}
            <div className={styles.helpBox}>
              <h2 className={styles.helpHeading}>Getting your archive</h2>
              <ol className={styles.helpList}>
                <li>
                  Go to <span className={styles.mono}>takeout.google.com</span> and deselect
                  everything.
                </li>
                <li>Select <strong>Keep</strong>, then create the export.</li>
                <li>Download the .zip Google emails you and drop it above.</li>
              </ol>
              <p className={styles.helpNote}>
                Keep notes become Neutrino notes. Other products in the archive are recognised but
                cannot be imported yet.
              </p>
            </div>
          </section>
        )}

        {/* ── Stage 2: choose what comes across ──────────────────────────── */}
        {stage === 'configure' && loaded && (
          <section className={styles.section}>
            <div className={styles.archiveCard}>
              <Package size={18} className={styles.archiveIcon} aria-hidden="true" />
              <div>
                <div className={styles.archiveName}>{loaded.fileName}</div>
                <div className={styles.archiveMeta}>
                  {loaded.archive.products.length} product
                  {loaded.archive.products.length === 1 ? '' : 's'}:{' '}
                  {loaded.archive.products.map((p) => p.name).join(', ')}
                </div>
              </div>
              <button className={styles.clearBtn} onClick={reset} type="button" aria-label="Choose a different archive">
                <X size={16} />
              </button>
            </div>

            {loaded.keep ? (
              <>
                <div className={styles.productRow}>
                  <FileJson size={18} className={styles.productIcon} aria-hidden="true" />
                  <div className={styles.productText}>
                    <div className={styles.productName}>
                      {loaded.keep.entries.length} note
                      {loaded.keep.entries.length === 1 ? '' : 's'} in {loaded.keep.directory}
                    </div>
                    <div className={styles.productDest}>→ Notes</div>
                  </div>
                </div>

                <div className={styles.options}>
                  <Checkbox
                    label="Import archived notes"
                    checked={options.includeArchived}
                    onChange={(e) => setOptions((o) => ({ ...o, includeArchived: e.target.checked }))}
                  />
                  <Checkbox
                    label="Import notes from Keep’s trash"
                    checked={options.includeTrashed}
                    onChange={(e) => setOptions((o) => ({ ...o, includeTrashed: e.target.checked }))}
                  />
                  <Checkbox
                    label="Skip notes whose title already exists"
                    description="Lets you re-run the import without creating duplicates."
                    checked={options.skipExisting}
                    onChange={(e) => setOptions((o) => ({ ...o, skipExisting: e.target.checked }))}
                  />
                  <Checkbox
                    label="Put imported notes in a folder"
                    checked={options.folderName !== null}
                    onChange={(e) =>
                      setOptions((o) => ({
                        ...o,
                        folderName: e.target.checked ? DEFAULT_KEEP_IMPORT_OPTIONS.folderName : null,
                      }))
                    }
                  />
                  {options.folderName !== null && (
                    <div className={styles.folderInput}>
                      <TextInput
                        value={options.folderName}
                        onChange={(e) => setOptions((o) => ({ ...o, folderName: e.target.value }))}
                        placeholder="Folder name"
                        aria-label="Folder name"
                      />
                    </div>
                  )}
                </div>

                <p className={styles.caveat}>
                  Note colours, pins and the original created dates are not carried over, and
                  attachments stay in your archive — each note lists the filenames it had.
                </p>

                <div className={styles.actions}>
                  <Button onClick={startImport}>
                    Import {loaded.keep.entries.length} note
                    {loaded.keep.entries.length === 1 ? '' : 's'}
                  </Button>
                  <Button variant="secondary" onClick={reset}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <Alert
                variant="warning"
                message={
                  <>
                    No Google Keep notes found in this archive. Re-run the export with{' '}
                    <strong>Keep</strong> selected.
                  </>
                }
              />
            )}
          </section>
        )}

        {/* ── Stage 3: running ───────────────────────────────────────────── */}
        {stage === 'running' && progress && (
          <section className={styles.section}>
            <div className={styles.progressBox}>
              <ProgressBar value={percent} label={`Importing ${progress.done} of ${progress.total}`} />
              <div className={styles.progressCurrent}>{progress.current}</div>
              <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
                Stop
              </Button>
            </div>
          </section>
        )}

        {/* ── Stage 4: what happened ─────────────────────────────────────── */}
        {stage === 'done' && summary && (
          <section className={styles.section}>
            <div className={styles.resultHead}>
              <Check size={20} className={styles.resultIcon} aria-hidden="true" />
              <div>
                <div className={styles.resultTitle}>
                  {summary.cancelled ? 'Import stopped' : 'Import finished'}
                </div>
                <div className={styles.resultCounts}>
                  {summary.imported} imported · {summary.skipped} skipped · {summary.failed} failed
                </div>
              </div>
            </div>

            {summary.unencrypted && (
              <Alert
                variant="warning"
                className={styles.alert}
                message="This device has no encryption key set up, so the imported notes were saved without end-to-end encryption. Set up your keys in Settings → Account, then re-import."
              />
            )}

            {failures.length > 0 && (
              <div className={styles.list}>
                <h2 className={styles.listHeading}>Failed</h2>
                {failures.map((item) => (
                  <div key={item.file} className={styles.listRow}>
                    <span className={styles.listTitle}>{item.title}</span>
                    <span className={styles.listReason}>{item.reason}</span>
                  </div>
                ))}
              </div>
            )}

            {skips.length > 0 && (
              <details className={styles.details}>
                <summary className={styles.detailsSummary}>Skipped ({skips.length})</summary>
                <div className={styles.list}>
                  {skips.map((item) => (
                    <div key={item.file} className={styles.listRow}>
                      <span className={styles.listTitle}>{item.title}</span>
                      <span className={styles.listReason}>{item.reason}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className={styles.actions}>
              <Button onClick={() => router.push('/notes')}>Go to Notes</Button>
              <Button variant="secondary" onClick={reset}>
                Import another archive
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
