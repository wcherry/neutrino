'use client';

/**
 * Import from Google Takeout.
 *
 * A three-stage page: pick the zip, choose what comes across, watch it run.
 * The archive is opened in the browser and the imports write through the
 * ordinary notes, docs, sheets, slides and photos APIs, one item at a time,
 * because every kind of content is E2EE and only this device can encrypt it
 * (see `lib/takeout/importKeep.ts`, `importDocs.ts`, `importSheets.ts`,
 * `importSlides.ts` and `importPhotos.ts`). Photos are the one product whose
 * bytes do reach the server — encrypted, as an upload — since a photo *is* its
 * file.
 *
 * Five products are supported and any of them can be run on its own: Keep →
 * Notes, the documents, spreadsheets and presentations in Drive → Docs, Sheets
 * and Slides, and Google Photos → Photos. The runs are sequential and share one
 * progress bar and one result screen.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  FileJson,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Package,
  Presentation,
  X,
} from 'lucide-react';
import { Alert, Button, Checkbox, DropZone, ProgressBar, Spinner, TextInput, useToast } from '@neutrino/ui';
import { canEncryptFor } from '@neutrino/api-drive';
import { ENCRYPTION_WARNING_MESSAGE } from '@/components/EncryptionWarningMessage';
import { useUser } from '@neutrino/auth';
import {
  DEFAULT_DOCS_IMPORT_OPTIONS,
  DEFAULT_KEEP_IMPORT_OPTIONS,
  DEFAULT_PHOTOS_IMPORT_OPTIONS,
  DEFAULT_SHEETS_IMPORT_OPTIONS,
  DEFAULT_SLIDES_IMPORT_OPTIONS,
  findDriveDocs,
  findDriveSheets,
  findDriveSlides,
  findKeepNotes,
  findTakeoutPhotos,
  openTakeout,
  runDocsImport,
  runKeepImport,
  runPhotosImport,
  runSheetsImport,
  runSlidesImport,
  TakeoutError,
  type DocsImportOptions,
  type DriveDocsSource,
  type DriveSheetsSource,
  type DriveSlidesSource,
  type ImportItem,
  type KeepImportOptions,
  type KeepSource,
  type PhotosImportOptions,
  type PhotosSource,
  type SheetsImportOptions,
  type SlidesImportOptions,
  type TakeoutArchive,
} from '@/lib/takeout';
import { useImportRun, type ImportStep } from '@/components/ImportRun';
import { logFail, logStep } from '@/lib/takeout/log';
import styles from './page.module.css';

/**
 * The stages this page owns. `running` and `done` are not here: a run outlives
 * the page, so it is the provider that says whether one is going and the two
 * are folded together in `stage` below.
 */
type PickStage = 'pick' | 'configure';

interface LoadedArchive {
  /** What to show it as: one file's name, or the first part's plus a count. */
  fileName: string;
  /** How many zips it was assembled from; 1 for an unsplit export. */
  partCount: number;
  archive: TakeoutArchive;
  keep: KeepSource | null;
  docs: DriveDocsSource | null;
  sheets: DriveSheetsSource | null;
  slides: DriveSlidesSource | null;
  photos: PhotosSource | null;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * What to call the export on screen once it is open. A split export is many
 * files, and listing thirty of them helps nobody, so the first part names the
 * set and the rest are a count.
 */
const archiveLabel = (files: File[]) =>
  files.length === 1 ? files[0].name : `${files[0].name} + ${plural(files.length - 1, 'more part')}`;

/**
 * Google names the parts of a split export `…-001.zip`, `…-002.zip`, and a
 * file picker hands them over in whatever order it feels like. Sorting them
 * only affects which one names the set above and the order the log reads in —
 * the merge itself does not care — but an export that reports itself by its
 * first part rather than an arbitrary one is the less confusing of the two.
 */
const inPartOrder = (files: File[]) =>
  [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

/** "12 photos", or "12 photos and videos" when the export holds both. */
const mediaLabel = (source: PhotosSource) =>
  source.photos.some((p) => p.kind === 'video')
    ? `${source.photos.length} photos and videos`
    : plural(source.photos.length, 'photo');

export default function ImportPage() {
  const router = useRouter();
  const user = useUser();
  const toast = useToast();
  const run = useImportRun();

  const [pickStage, setPickStage] = useState<PickStage>('pick');
  const [loaded, setLoaded] = useState<LoadedArchive | null>(null);
  const [includeKeep, setIncludeKeep] = useState(true);
  const [includeDocs, setIncludeDocs] = useState(true);
  const [includeSheets, setIncludeSheets] = useState(true);
  const [includeSlides, setIncludeSlides] = useState(true);
  const [includePhotos, setIncludePhotos] = useState(true);
  const [keepOptions, setKeepOptions] = useState<KeepImportOptions>(DEFAULT_KEEP_IMPORT_OPTIONS);
  const [docOptions, setDocOptions] = useState<DocsImportOptions>(DEFAULT_DOCS_IMPORT_OPTIONS);
  const [sheetOptions, setSheetOptions] = useState<SheetsImportOptions>(DEFAULT_SHEETS_IMPORT_OPTIONS);
  const [slideOptions, setSlideOptions] = useState<SlidesImportOptions>(DEFAULT_SLIDES_IMPORT_OPTIONS);
  const [photoOptions, setPhotoOptions] = useState<PhotosImportOptions>(DEFAULT_PHOTOS_IMPORT_OPTIONS);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  /**
   * What is on screen. A run belongs to the provider, so it wins over the
   * page's own stage — which is how coming back mid-import lands on the
   * progress bar rather than on the file picker.
   */
  const stage =
    run.state.status === 'running' ? 'running' : run.state.status === 'done' ? 'done' : pickStage;

  const progress = run.state.status === 'running' ? run.state.progress : null;
  const results = run.state.status === 'done' ? run.state.results : null;
  const error = readError ?? (run.state.status === 'failed' ? run.state.error : null);

  // The open archive holds a zip reader and its worker pool. A ref rather than
  // reading `loaded`, so the unmount cleanup below closes whatever is open at
  // that moment instead of whatever was open when the effect was created.
  const archiveRef = useRef<TakeoutArchive | null>(null);
  const closeArchive = useCallback(() => {
    const open = archiveRef.current;
    archiveRef.current = null;
    open?.close().catch(() => {});
  }, []);
  // Starting a run hands the archive to the provider, which closes it when the
  // run ends. Closing it here on unmount would then be pulling it out from
  // under an import that is still reading.
  useEffect(() => () => closeArchive(), [closeArchive]);

  const reset = () => {
    closeArchive();
    run.dismiss();
    setPickStage('pick');
    setLoaded(null);
    setReadError(null);
    setIncludeKeep(true);
    setIncludeDocs(true);
    setIncludeSheets(true);
    setIncludeSlides(true);
    setIncludePhotos(true);
  };

  /**
   * Every file dropped at once is one export. A split Takeout has to be read
   * as a whole — a photo's sidecar, its album and the file itself routinely
   * land in different parts — so the parts are merged into a single archive
   * rather than imported one after another.
   */
  const handleFiles = useCallback(async (dropped: File[]) => {
    if (dropped.length === 0) return;
    const files = inPartOrder(dropped);
    const label = archiveLabel(files);
    setReadError(null);
    setReading(true);
    try {
      // Dropping a second archive replaces the first; let the old one go.
      closeArchive();
      const archive = await openTakeout(files);
      archiveRef.current = archive;
      const keep = await findKeepNotes(archive);
      const docs = findDriveDocs(archive);
      const sheets = findDriveSheets(archive);
      const slides = findDriveSlides(archive);
      const photos = await findTakeoutPhotos(archive);
      logStep('page', `read ${label}`, {
        parts: archive.partCount,
        notes: keep?.entries.length ?? 0,
        documents: docs?.docs.length ?? 0,
        unsupportedDocuments: docs?.unsupported.length ?? 0,
        spreadsheets: sheets?.sheets.length ?? 0,
        unsupportedSpreadsheets: sheets?.unsupported.length ?? 0,
        presentations: slides?.slides.length ?? 0,
        unsupportedPresentations: slides?.unsupported.length ?? 0,
        photos: photos?.photos.length ?? 0,
        albums: photos?.albums.length ?? 0,
      });
      setLoaded({ fileName: label, partCount: archive.partCount, archive, keep, docs, sheets, slides, photos });
      setPickStage('configure');
    } catch (err) {
      logFail('page', `could not read ${label}`, err);
      setReadError(
        err instanceof TakeoutError
          ? err.message
          : `Could not read ${label}. Make sure ${
              files.length === 1 ? 'it is the .zip' : 'they are the .zip files'
            } you downloaded from Google Takeout.`,
      );
    } finally {
      setReading(false);
    }
  }, [closeArchive]);

  const noteCount = includeKeep ? loaded?.keep?.entries.length ?? 0 : 0;
  const docCount = includeDocs ? loaded?.docs?.docs.length ?? 0 : 0;
  const sheetCount = includeSheets ? loaded?.sheets?.sheets.length ?? 0 : 0;
  const slideCount = includeSlides ? loaded?.slides?.slides.length ?? 0 : 0;
  const photoCount = includePhotos ? loaded?.photos?.photos.length ?? 0 : 0;
  const selectedCount = noteCount + docCount + sheetCount + slideCount + photoCount;

  /**
   * The passes to run, in order, each closed over the options as they stand at
   * the moment Import is pressed. Building them here keeps the provider free of
   * any knowledge of Keep or Drive or Photos; it just sequences them.
   */
  const buildSteps = (archive: LoadedArchive): ImportStep[] => {
    const steps: ImportStep[] = [];
    if (noteCount > 0 && archive.keep) {
      const entries = archive.keep.entries;
      steps.push({
        product: 'Notes',
        count: noteCount,
        run: ({ onProgress, signal }) =>
          runKeepImport({ entries, options: keepOptions, userId: user?.id, onProgress, signal }),
      });
    }
    if (docCount > 0 && archive.docs) {
      const docs = archive.docs.docs;
      steps.push({
        product: 'Documents',
        count: docCount,
        run: ({ onProgress, signal }) =>
          runDocsImport({ docs, options: docOptions, userId: user?.id, onProgress, signal }),
      });
    }
    if (sheetCount > 0 && archive.sheets) {
      const sheets = archive.sheets.sheets;
      steps.push({
        product: 'Spreadsheets',
        count: sheetCount,
        run: ({ onProgress, signal }) =>
          runSheetsImport({ sheets, options: sheetOptions, userId: user?.id, onProgress, signal }),
      });
    }
    if (slideCount > 0 && archive.slides) {
      const slides = archive.slides.slides;
      steps.push({
        product: 'Presentations',
        count: slideCount,
        run: ({ onProgress, signal }) =>
          runSlidesImport({ slides, options: slideOptions, userId: user?.id, onProgress, signal }),
      });
    }
    if (photoCount > 0 && archive.photos) {
      const photos = archive.photos.photos;
      steps.push({
        product: 'Photos',
        count: photoCount,
        run: ({ onProgress, signal }) =>
          runPhotosImport({ photos, options: photoOptions, userId: user?.id, onProgress, signal }),
      });
    }
    return steps;
  };

  const startImport = async () => {
    if (!loaded || selectedCount === 0) return;
    // Every runner declines without a key rather than importing in the clear
    // (issue #95), so ask once here instead of letting five passes each fail
    // their way to the same answer.
    if (!(await canEncryptFor(user?.id))) {
      toast.warning(ENCRYPTION_WARNING_MESSAGE);
      return;
    }
    // The archive goes with the plan: from here it is the run's to read and the
    // run's to close, so this page's unmount must not touch it.
    archiveRef.current = null;
    run.start({ fileName: loaded.fileName, archive: loaded.archive, steps: buildSteps(loaded) });
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
  const ranSheets = (results ?? []).some((r) => r.product === 'Spreadsheets');
  const ranSlides = (results ?? []).some((r) => r.product === 'Presentations');
  const ranPhotos = (results ?? []).some((r) => r.product === 'Photos');

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
                multiple
                accept=".zip,application/zip"
                label="Drop your Takeout .zip here"
                hint="or click to browse — select every part if your export was split"
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
                  Select <strong>Keep</strong> for your notes, <strong>Drive</strong> for your
                  documents, spreadsheets and presentations, and <strong>Google Photos</strong> for
                  your pictures, then create the export.
                </li>
                <li>
                  Leave Drive&rsquo;s formats set to <strong>Word (.docx)</strong> for Google Docs,{' '}
                  <strong>Excel (.xlsx)</strong> for Google Sheets and{' '}
                  <strong>PowerPoint (.pptx)</strong> for Google Slides — those are the defaults, and
                  the formats that convert best.
                </li>
                <li>
                  Download the .zip Google emails you and drop it above. A large export comes as
                  several numbered .zip files — download all of them and drop them in together.
                </li>
              </ol>
              <p className={styles.helpNote}>
                Keep notes become Neutrino notes, Google Docs documents become Neutrino documents,
                Google Sheets spreadsheets become Neutrino spreadsheets, Google Slides decks become
                Neutrino presentations, and Google Photos pictures and videos become Neutrino
                photos. Other products in the archive are recognised but cannot be imported yet.
              </p>
              <p className={styles.helpNote}>
                Google splits a large export across several .zip files, and it splits them wherever
                it likes — an album and the photos in it can end up in different parts. Select them
                all and they are read as the one export they are.
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
                  {loaded.partCount > 1 && `${plural(loaded.partCount, 'part')} · `}
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
                      private to you.
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

            {loaded.sheets && (
              <div className={styles.product}>
                <div className={`${styles.productRow} ${includeSheets ? '' : styles.productRowOff}`}>
                  <FileSpreadsheet size={18} className={styles.productIcon} aria-hidden="true" />
                  <div className={styles.productText}>
                    <div className={styles.productName}>
                      {plural(loaded.sheets.sheets.length, 'spreadsheet')} in {loaded.sheets.directory}
                    </div>
                    <div className={styles.productDest}>→ Sheets</div>
                  </div>
                  <div className={styles.productToggle}>
                    <Checkbox
                      label="Import"
                      checked={includeSheets}
                      disabled={loaded.sheets.sheets.length === 0}
                      onChange={(e) => setIncludeSheets(e.target.checked)}
                    />
                  </div>
                </div>

                {includeSheets && loaded.sheets.sheets.length > 0 && (
                  <>
                    <div className={styles.options}>
                      <Checkbox
                        label="Bring formulas across"
                        description="Otherwise cells keep the values Google last calculated. A formula Neutrino cannot work out shows as its own text."
                        checked={sheetOptions.importFormulas}
                        onChange={(e) => setSheetOptions((o) => ({ ...o, importFormulas: e.target.checked }))}
                      />
                      <Checkbox
                        label="Recreate the folders they were in"
                        description="Otherwise every spreadsheet lands in one folder."
                        checked={sheetOptions.preserveFolders}
                        onChange={(e) => setSheetOptions((o) => ({ ...o, preserveFolders: e.target.checked }))}
                      />
                      <Checkbox
                        label="Skip spreadsheets whose title already exists"
                        description="Lets you re-run the import without creating duplicates."
                        checked={sheetOptions.skipExisting}
                        onChange={(e) => setSheetOptions((o) => ({ ...o, skipExisting: e.target.checked }))}
                      />
                      <Checkbox
                        label="Put imported spreadsheets in a folder"
                        checked={sheetOptions.folderName !== null}
                        onChange={(e) =>
                          setSheetOptions((o) => ({
                            ...o,
                            folderName: e.target.checked ? DEFAULT_SHEETS_IMPORT_OPTIONS.folderName : null,
                          }))
                        }
                      />
                      {sheetOptions.folderName !== null && (
                        <div className={styles.folderInput}>
                          <TextInput
                            value={sheetOptions.folderName}
                            onChange={(e) => setSheetOptions((o) => ({ ...o, folderName: e.target.value }))}
                            placeholder="Folder name"
                            aria-label="Spreadsheets folder name"
                          />
                        </div>
                      )}
                    </div>

                    <p className={styles.caveat}>
                      Cell values, number formats, merged cells and column sizes come across. Cell
                      colours and fonts, charts, pivot tables, filters and conditional formatting do
                      not, and neither does sharing, so an imported spreadsheet starts out private to
                      you.
                    </p>
                  </>
                )}

                {loaded.sheets.unsupported.length > 0 && (
                  <Alert
                    variant="warning"
                    message={`${plural(loaded.sheets.unsupported.length, 'file')} in ${
                      loaded.sheets.directory
                    } (${[...new Set(loaded.sheets.unsupported.map((u) => u.format))].join(', ')}) cannot be converted in the browser. Re-run the export with the Google Sheets format set to Excel (.xlsx) to bring those across.`}
                  />
                )}
              </div>
            )}

            {loaded.slides && (
              <div className={styles.product}>
                <div className={`${styles.productRow} ${includeSlides ? '' : styles.productRowOff}`}>
                  <Presentation size={18} className={styles.productIcon} aria-hidden="true" />
                  <div className={styles.productText}>
                    <div className={styles.productName}>
                      {plural(loaded.slides.slides.length, 'presentation')} in {loaded.slides.directory}
                    </div>
                    <div className={styles.productDest}>→ Slides</div>
                  </div>
                  <div className={styles.productToggle}>
                    <Checkbox
                      label="Import"
                      checked={includeSlides}
                      disabled={loaded.slides.slides.length === 0}
                      onChange={(e) => setIncludeSlides(e.target.checked)}
                    />
                  </div>
                </div>

                {includeSlides && loaded.slides.slides.length > 0 && (
                  <>
                    <div className={styles.options}>
                      <Checkbox
                        label="Recreate the folders they were in"
                        description="Otherwise every presentation lands in one folder."
                        checked={slideOptions.preserveFolders}
                        onChange={(e) => setSlideOptions((o) => ({ ...o, preserveFolders: e.target.checked }))}
                      />
                      <Checkbox
                        label="Skip presentations whose title already exists"
                        description="Lets you re-run the import without creating duplicates."
                        checked={slideOptions.skipExisting}
                        onChange={(e) => setSlideOptions((o) => ({ ...o, skipExisting: e.target.checked }))}
                      />
                      <Checkbox
                        label="Put imported presentations in a folder"
                        checked={slideOptions.folderName !== null}
                        onChange={(e) =>
                          setSlideOptions((o) => ({
                            ...o,
                            folderName: e.target.checked ? DEFAULT_SLIDES_IMPORT_OPTIONS.folderName : null,
                          }))
                        }
                      />
                      {slideOptions.folderName !== null && (
                        <div className={styles.folderInput}>
                          <TextInput
                            value={slideOptions.folderName}
                            onChange={(e) => setSlideOptions((o) => ({ ...o, folderName: e.target.value }))}
                            placeholder="Folder name"
                            aria-label="Presentations folder name"
                          />
                        </div>
                      )}
                    </div>

                    <p className={styles.caveat}>
                      The exported PowerPoint file is stored as it is, so slides, layouts, themes and
                      images come across exactly as Google wrote them. Comments and revision history
                      are not in the export, and neither is sharing, so an imported presentation
                      starts out private to you.
                    </p>
                  </>
                )}

                {loaded.slides.unsupported.length > 0 && (
                  <Alert
                    variant="warning"
                    message={`${plural(loaded.slides.unsupported.length, 'file')} in ${
                      loaded.slides.directory
                    } (${[...new Set(loaded.slides.unsupported.map((u) => u.format))].join(', ')}) cannot be opened in the browser. Re-run the export with the Google Slides format set to PowerPoint (.pptx) to bring those across.`}
                  />
                )}
              </div>
            )}

            {loaded.photos && (
              <div className={styles.product}>
                <div className={`${styles.productRow} ${includePhotos ? '' : styles.productRowOff}`}>
                  <ImageIcon size={18} className={styles.productIcon} aria-hidden="true" />
                  <div className={styles.productText}>
                    <div className={styles.productName}>
                      {mediaLabel(loaded.photos)} in {loaded.photos.directory}
                    </div>
                    <div className={styles.productDest}>
                      → Photos
                      {loaded.photos.albums.length > 0 &&
                        ` · ${plural(loaded.photos.albums.length, 'album')}`}
                    </div>
                  </div>
                  <div className={styles.productToggle}>
                    <Checkbox
                      label="Import"
                      checked={includePhotos}
                      onChange={(e) => setIncludePhotos(e.target.checked)}
                    />
                  </div>
                </div>

                {includePhotos && (
                  <>
                    <div className={styles.options}>
                      <Checkbox
                        label="Recreate your albums"
                        description="Otherwise every photo goes into the library on its own."
                        checked={photoOptions.importAlbums}
                        onChange={(e) => setPhotoOptions((o) => ({ ...o, importAlbums: e.target.checked }))}
                      />
                      <Checkbox
                        label="Import archived photos"
                        description="They stay archived here too."
                        checked={photoOptions.includeArchived}
                        onChange={(e) => setPhotoOptions((o) => ({ ...o, includeArchived: e.target.checked }))}
                      />
                      <Checkbox
                        label="Import photos from Google’s trash"
                        checked={photoOptions.includeTrashed}
                        onChange={(e) => setPhotoOptions((o) => ({ ...o, includeTrashed: e.target.checked }))}
                      />
                      <Checkbox
                        label="Skip photos already imported"
                        description="Lets you re-run the import without uploading everything again."
                        checked={photoOptions.skipExisting}
                        onChange={(e) => setPhotoOptions((o) => ({ ...o, skipExisting: e.target.checked }))}
                      />
                      <Checkbox
                        label="Put the files in a folder"
                        checked={photoOptions.folderName !== null}
                        onChange={(e) =>
                          setPhotoOptions((o) => ({
                            ...o,
                            folderName: e.target.checked ? DEFAULT_PHOTOS_IMPORT_OPTIONS.folderName : null,
                          }))
                        }
                      />
                      {photoOptions.folderName !== null && (
                        <div className={styles.folderInput}>
                          <TextInput
                            value={photoOptions.folderName}
                            onChange={(e) => setPhotoOptions((o) => ({ ...o, folderName: e.target.value }))}
                            placeholder="Folder name"
                            aria-label="Photos folder name"
                          />
                        </div>
                      )}
                    </div>

                    <p className={styles.caveat}>
                      Photos are uploaded one at a time and keep their original quality, capture
                      dates and favourites, so a large library takes a while — leave this tab open.
                      Google&rsquo;s face groupings and people tags do not come across; Neutrino
                      finds faces of its own.
                      {loaded.photos.duplicates > 0 &&
                        ` ${loaded.photos.duplicates} duplicate ${
                          loaded.photos.duplicates === 1 ? 'copy' : 'copies'
                        } of photos filed in both an album and a year will be uploaded once.`}
                    </p>
                  </>
                )}
              </div>
            )}

            {loaded.keep || loaded.docs || loaded.sheets || loaded.slides || loaded.photos ? (
              <div className={styles.actions}>
                <Button onClick={() => { void startImport(); }} disabled={selectedCount === 0}>
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
                    <strong>Keep</strong>, <strong>Drive</strong> or <strong>Google Photos</strong>{' '}
                    selected.
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
              <Button variant="secondary" onClick={run.cancel}>
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
                message="This device has no encryption key set up, so nothing was imported — items are never written without end-to-end encryption. Set up or unlock your keys in Settings → Security, then run the import again."
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
              {ranSheets && (
                <Button
                  variant={ranNotes || ranDocs ? 'secondary' : 'primary'}
                  onClick={() => router.push('/sheets')}
                >
                  Go to Sheets
                </Button>
              )}
              {ranSlides && (
                <Button
                  variant={ranNotes || ranDocs || ranSheets ? 'secondary' : 'primary'}
                  onClick={() => router.push('/slides')}
                >
                  Go to Slides
                </Button>
              )}
              {ranPhotos && (
                <Button
                  variant={ranNotes || ranDocs || ranSheets || ranSlides ? 'secondary' : 'primary'}
                  onClick={() => router.push('/photos')}
                >
                  Go to Photos
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
