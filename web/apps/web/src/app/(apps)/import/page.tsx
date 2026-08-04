'use client';

/**
 * Import from Google Takeout.
 *
 * A three-stage page: pick the zip, choose what comes across, watch it run.
 * The archive is opened in the browser and never uploaded — the imports write
 * through the ordinary notes and docs APIs, one item at a time, because both
 * kinds of content are E2EE and only this device can encrypt them (see
 * `lib/takeout/importKeep.ts` and `lib/takeout/importDocs.ts`).
 *
 * Two products are supported, and either can be run on its own: Keep → Notes
 * and the documents in Drive → Docs. The two runs are sequential and share one
 * progress bar and one result screen.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, FileJson, FileText, Package, X } from 'lucide-react';
import { Alert, Button, Checkbox, DropZone, ProgressBar, Spinner, TextInput } from '@neutrino/ui';
import { useUser } from '@neutrino/auth';
import {
  DEFAULT_DOCS_IMPORT_OPTIONS,
  DEFAULT_KEEP_IMPORT_OPTIONS,
  findDriveDocs,
  findKeepNotes,
  openTakeout,
  runDocsImport,
  runKeepImport,
  TakeoutError,
  type DocsImportOptions,
  type DriveDocsSource,
  type ImportItem,
  type ImportProgress,
  type ImportSummary,
  type KeepImportOptions,
  type KeepSource,
  type TakeoutArchive,
} from '@/lib/takeout';
import { describeError, logFail, logStep } from '@/lib/takeout/log';
import styles from './page.module.css';

type Stage = 'pick' | 'configure' | 'running' | 'done';

interface LoadedArchive {
  fileName: string;
  archive: TakeoutArchive;
  keep: KeepSource | null;
  docs: DriveDocsSource | null;
}

/** One product's result, labelled so a combined list says where a row came from. */
interface ProductResult {
  product: string;
  summary: ImportSummary;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

export default function ImportPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useUser();

  const [stage, setStage] = useState<Stage>('pick');
  const [loaded, setLoaded] = useState<LoadedArchive | null>(null);
  const [includeKeep, setIncludeKeep] = useState(true);
  const [includeDocs, setIncludeDocs] = useState(true);
  const [keepOptions, setKeepOptions] = useState<KeepImportOptions>(DEFAULT_KEEP_IMPORT_OPTIONS);
  const [docOptions, setDocOptions] = useState<DocsImportOptions>(DEFAULT_DOCS_IMPORT_OPTIONS);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [results, setResults] = useState<ProductResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // The open archive holds a zip reader and its worker pool. A ref rather than
  // reading `loaded`, so the unmount cleanup below closes whatever is open at
  // that moment instead of whatever was open when the effect was created.
  const archiveRef = useRef<TakeoutArchive | null>(null);
  const closeArchive = useCallback(() => {
    const open = archiveRef.current;
    archiveRef.current = null;
    open?.close().catch(() => {});
  }, []);
  useEffect(() => closeArchive, [closeArchive]);

  const reset = () => {
    closeArchive();
    setStage('pick');
    setLoaded(null);
    setProgress(null);
    setResults(null);
    setError(null);
    setIncludeKeep(true);
    setIncludeDocs(true);
  };

  const handleFiles = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setError(null);
    setReading(true);
    try {
      // Dropping a second archive replaces the first; let the old one go.
      closeArchive();
      const archive = await openTakeout(file);
      archiveRef.current = archive;
      const keep = await findKeepNotes(archive);
      const docs = findDriveDocs(archive);
      logStep('page', `read ${file.name}`, {
        notes: keep?.entries.length ?? 0,
        documents: docs?.docs.length ?? 0,
        unsupportedDocuments: docs?.unsupported.length ?? 0,
      });
      setLoaded({ fileName: file.name, archive, keep, docs });
      setStage('configure');
    } catch (err) {
      logFail('page', `could not read ${file.name}`, err);
      setError(
        err instanceof TakeoutError
          ? err.message
          : `Could not read ${file.name}. Make sure it is the .zip you downloaded from Google Takeout.`,
      );
    } finally {
      setReading(false);
    }
  }, [closeArchive]);

  const noteCount = includeKeep ? loaded?.keep?.entries.length ?? 0 : 0;
  const docCount = includeDocs ? loaded?.docs?.docs.length ?? 0 : 0;
  const selectedCount = noteCount + docCount;

  const startImport = async () => {
    if (!loaded || selectedCount === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setStage('running');
    setProgress({ done: 0, total: selectedCount, current: '' });
    logStep('page', 'starting run', { notes: noteCount, documents: docCount, archive: loaded.fileName });

    const done: ProductResult[] = [];
    try {
      if (noteCount > 0 && loaded.keep) {
        const summary = await runKeepImport({
          entries: loaded.keep.entries,
          options: keepOptions,
          userId: user?.id,
          onProgress: (p) => setProgress({ done: p.done, total: selectedCount, current: p.current }),
          signal: controller.signal,
        });
        done.push({ product: 'Notes', summary });
      }

      // A stopped Keep run means the user stopped the whole import, not just
      // its first half.
      const stopped = done.some((r) => r.summary.cancelled);
      if (docCount > 0 && loaded.docs && !stopped) {
        const summary = await runDocsImport({
          docs: loaded.docs.docs,
          options: docOptions,
          userId: user?.id,
          onProgress: (p) =>
            setProgress({ done: noteCount + p.done, total: selectedCount, current: p.current }),
          signal: controller.signal,
        });
        done.push({ product: 'Documents', summary });
      }

      // The per-item detail is in each runner's log; this is the one place the
      // whole run can be read at a glance, including the items that failed.
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

      setResults(done);
      setStage('done');
      // The notes list, the docs list and the drive tree all gained files.
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['docs'] });
      queryClient.invalidateQueries({ queryKey: ['drive'] });
      queryClient.invalidateQueries({ queryKey: ['folder-contents'] });
    } catch (err) {
      // A throw out of a runner is different from a per-item failure: it means
      // the run stopped before it could report anything, so this is the only
      // record of it.
      logFail('page', 'the run threw and stopped', err, { completed: done.map((r) => r.product) });
      setError(describeError(err));
      setStage('configure');
    } finally {
      abortRef.current = null;
    }
  };

  const percent = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  const rowsOf = (status: ImportItem['status']) =>
    (results ?? []).flatMap((result) =>
      result.summary.items
        .filter((item) => item.status === status)
        .map((item) => ({ ...item, product: result.product })),
    );
  const failures = rowsOf('failed');
  const skips = rowsOf('skipped');
  const totals = (results ?? []).reduce(
    (acc, r) => ({
      imported: acc.imported + r.summary.imported,
      skipped: acc.skipped + r.summary.skipped,
      failed: acc.failed + r.summary.failed,
    }),
    { imported: 0, skipped: 0, failed: 0 },
  );
  const cancelled = (results ?? []).some((r) => r.summary.cancelled);
  const unencrypted = (results ?? []).some((r) => r.summary.unencrypted);
  const ranNotes = (results ?? []).some((r) => r.product === 'Notes');
  const ranDocs = (results ?? []).some((r) => r.product === 'Documents');

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
                <li>
                  Select <strong>Keep</strong> for your notes and <strong>Drive</strong> for your
                  documents, then create the export.
                </li>
                <li>
                  Leave Drive&rsquo;s format for Google Docs set to <strong>Word (.docx)</strong> —
                  that is the default, and the format that converts best.
                </li>
                <li>Download the .zip Google emails you and drop it above.</li>
              </ol>
              <p className={styles.helpNote}>
                Keep notes become Neutrino notes and Google Docs documents become Neutrino
                documents. Other products in the archive are recognised but cannot be imported yet.
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
                  {plural(loaded.archive.products.length, 'product')}:{' '}
                  {loaded.archive.products.map((p) => p.name).join(', ')}
                </div>
              </div>
              <button className={styles.clearBtn} onClick={reset} type="button" aria-label="Choose a different archive">
                <X size={16} />
              </button>
            </div>

            {loaded.keep && (
              <div className={styles.product}>
                <div className={`${styles.productRow} ${includeKeep ? '' : styles.productRowOff}`}>
                  <FileJson size={18} className={styles.productIcon} aria-hidden="true" />
                  <div className={styles.productText}>
                    <div className={styles.productName}>
                      {plural(loaded.keep.entries.length, 'note')} in {loaded.keep.directory}
                    </div>
                    <div className={styles.productDest}>→ Notes</div>
                  </div>
                  <div className={styles.productToggle}>
                    <Checkbox
                      label="Import"
                      checked={includeKeep}
                      onChange={(e) => setIncludeKeep(e.target.checked)}
                    />
                  </div>
                </div>

                {includeKeep && (
                  <>
                    <div className={styles.options}>
                      <Checkbox
                        label="Import archived notes"
                        checked={keepOptions.includeArchived}
                        onChange={(e) => setKeepOptions((o) => ({ ...o, includeArchived: e.target.checked }))}
                      />
                      <Checkbox
                        label="Import notes from Keep’s trash"
                        checked={keepOptions.includeTrashed}
                        onChange={(e) => setKeepOptions((o) => ({ ...o, includeTrashed: e.target.checked }))}
                      />
                      <Checkbox
                        label="Skip notes whose title already exists"
                        description="Lets you re-run the import without creating duplicates."
                        checked={keepOptions.skipExisting}
                        onChange={(e) => setKeepOptions((o) => ({ ...o, skipExisting: e.target.checked }))}
                      />
                      <Checkbox
                        label="Put imported notes in a folder"
                        checked={keepOptions.folderName !== null}
                        onChange={(e) =>
                          setKeepOptions((o) => ({
                            ...o,
                            folderName: e.target.checked ? DEFAULT_KEEP_IMPORT_OPTIONS.folderName : null,
                          }))
                        }
                      />
                      {keepOptions.folderName !== null && (
                        <div className={styles.folderInput}>
                          <TextInput
                            value={keepOptions.folderName}
                            onChange={(e) => setKeepOptions((o) => ({ ...o, folderName: e.target.value }))}
                            placeholder="Folder name"
                            aria-label="Notes folder name"
                          />
                        </div>
                      )}
                    </div>

                    <p className={styles.caveat}>
                      Note colours, pins and the original created dates are not carried over, and
                      attachments stay in your archive — each note lists the filenames it had.
                    </p>
                  </>
                )}
              </div>
            )}

            {loaded.docs && (
              <div className={styles.product}>
                <div className={`${styles.productRow} ${includeDocs ? '' : styles.productRowOff}`}>
                  <FileText size={18} className={styles.productIcon} aria-hidden="true" />
                  <div className={styles.productText}>
                    <div className={styles.productName}>
                      {plural(loaded.docs.docs.length, 'document')} in {loaded.docs.directory}
                    </div>
                    <div className={styles.productDest}>→ Docs</div>
                  </div>
                  <div className={styles.productToggle}>
                    <Checkbox
                      label="Import"
                      checked={includeDocs}
                      disabled={loaded.docs.docs.length === 0}
                      onChange={(e) => setIncludeDocs(e.target.checked)}
                    />
                  </div>
                </div>

                {includeDocs && loaded.docs.docs.length > 0 && (
                  <>
                    <div className={styles.options}>
                      <Checkbox
                        label="Recreate the folders they were in"
                        description="Otherwise every document lands in one folder."
                        checked={docOptions.preserveFolders}
                        onChange={(e) => setDocOptions((o) => ({ ...o, preserveFolders: e.target.checked }))}
                      />
                      <Checkbox
                        label="Skip documents whose title already exists"
                        description="Lets you re-run the import without creating duplicates."
                        checked={docOptions.skipExisting}
                        onChange={(e) => setDocOptions((o) => ({ ...o, skipExisting: e.target.checked }))}
                      />
                      <Checkbox
                        label="Put imported documents in a folder"
                        checked={docOptions.folderName !== null}
                        onChange={(e) =>
                          setDocOptions((o) => ({
                            ...o,
                            folderName: e.target.checked ? DEFAULT_DOCS_IMPORT_OPTIONS.folderName : null,
                          }))
                        }
                      />
                      {docOptions.folderName !== null && (
                        <div className={styles.folderInput}>
                          <TextInput
                            value={docOptions.folderName}
                            onChange={(e) => setDocOptions((o) => ({ ...o, folderName: e.target.value }))}
                            placeholder="Folder name"
                            aria-label="Documents folder name"
                          />
                        </div>
                      )}
                    </div>

                    <p className={styles.caveat}>
                      Comments, suggestions and revision history are not in the export, so they
                      cannot come across; neither is sharing, so an imported document starts out
                      private to you. Spreadsheets and presentations in the archive are left alone.
                    </p>
                  </>
                )}

                {loaded.docs.unsupported.length > 0 && (
                  <Alert
                    variant="warning"
                    message={`${plural(loaded.docs.unsupported.length, 'file')} in ${
                      loaded.docs.directory
                    } (${[...new Set(loaded.docs.unsupported.map((u) => u.format))].join(', ')}) cannot be converted in the browser. Re-run the export with the Google Docs format set to Word (.docx) to bring those across.`}
                  />
                )}
              </div>
            )}

            {loaded.keep || loaded.docs ? (
              <div className={styles.actions}>
                <Button onClick={startImport} disabled={selectedCount === 0}>
                  Import {plural(selectedCount, 'item')}
                </Button>
                <Button variant="secondary" onClick={reset}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Alert
                variant="warning"
                message={
                  <>
                    Nothing importable was found in this archive. Re-run the export with{' '}
                    <strong>Keep</strong> or <strong>Drive</strong> selected.
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
        {stage === 'done' && results && (
          <section className={styles.section}>
            <div className={styles.resultHead}>
              <Check size={20} className={styles.resultIcon} aria-hidden="true" />
              <div>
                <div className={styles.resultTitle}>
                  {cancelled ? 'Import stopped' : 'Import finished'}
                </div>
                <div className={styles.resultCounts}>
                  {totals.imported} imported · {totals.skipped} skipped · {totals.failed} failed
                </div>
              </div>
            </div>

            {unencrypted && (
              <Alert
                variant="warning"
                className={styles.alert}
                message="This device has no encryption key set up, so the imported items were saved without end-to-end encryption. Set up your keys in Settings → Account, then re-import."
              />
            )}

            {failures.length > 0 && (
              <div className={styles.list}>
                <h2 className={styles.listHeading}>Failed</h2>
                {failures.map((item) => (
                  <div key={`${item.product}:${item.file}`} className={styles.listRow}>
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
                    <div key={`${item.product}:${item.file}`} className={styles.listRow}>
                      <span className={styles.listTitle}>{item.title}</span>
                      <span className={styles.listReason}>{item.reason}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className={styles.actions}>
              {ranNotes && <Button onClick={() => router.push('/notes')}>Go to Notes</Button>}
              {ranDocs && (
                <Button variant={ranNotes ? 'secondary' : 'primary'} onClick={() => router.push('/docs')}>
                  Go to Docs
                </Button>
              )}
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
