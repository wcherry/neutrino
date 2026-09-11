'use client';

/**
 * Custom fonts, from the administrator's side.
 *
 * The tab used to take exactly one file and one display name typed by hand,
 * which made installing a family an upload per weight — and a font nobody
 * installs is a font nobody can use, so the tedium was the feature's real
 * limit (#207). It now takes a drop of anything: one font, several, a family
 * zip, or several zips, and shows what it found as a list to tick through
 * before any of it is uploaded.
 *
 * ── One review step, whatever was dropped ─────────────────────────────────
 *
 * A single `.ttf` goes through the same list as a zip of eighteen. Fast-
 * pathing it would mean two ways to install a font that could disagree about
 * naming, and the list is where the name is decided — so a lone file is a
 * family archive of one, pre-ticked, with its name already filled in.
 *
 * ── Names are suggested, never imposed ────────────────────────────────────
 *
 * `displayNameForFont` turns `Roboto-BoldItalic.ttf` into "Roboto Bold
 * Italic", which is right often enough to make the list a matter of reading
 * rather than typing, and wrong often enough that every row stays an editable
 * field. A blank name blocks nothing but its own row: the server requires one,
 * so a row without a name is simply not installed, and says so where the name
 * would be rather than as a failure after the upload.
 *
 * ── Uploads run one at a time and report per row ──────────────────────────
 *
 * Eighteen concurrent multipart uploads of a few hundred KB each would race
 * for the same temp directory for no gain a human could see. In sequence the
 * progress is legible, and a font that fails — a corrupt file, an expired
 * session — fails on its own line while the rest of the family installs. What
 * succeeded leaves the list and what failed stays on it, so a retry is the
 * same Install button rather than a second pass over the archive.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DropZone, Spinner, useToast } from '@neutrino/ui';
import { adminApi, fontsApi } from '@neutrino/api-admin';
import type { CustomFont } from '@neutrino/api-admin';
import { ApiClientError } from '@neutrino/api-core';
import {
  readFontSources,
  type FontCandidate,
  type FontSource,
  type SkippedEntry,
} from './fontArchive';
import { formatBytes } from './bytes';
import styles from './page.module.css';

/** A candidate as the list holds it: what was found, plus what the admin did to it. */
interface FontRow {
  candidate: FontCandidate;
  selected: boolean;
  name: string;
  uploading: boolean;
  error?: string;
}

function rowsFor(candidates: FontCandidate[]): FontRow[] {
  return candidates.map((candidate) => ({
    candidate,
    // Everything the drop found is ticked: an admin who dropped a family
    // usually wants the family, and unticking three is less work than ticking
    // fifteen.
    selected: true,
    name: candidate.suggestedName,
    uploading: false,
  }));
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiClientError && err.message ? err.message : fallback;
}

/** A row is installable once it is ticked and has a name to install it under. */
function isInstallable(row: FontRow): boolean {
  return row.selected && row.name.trim().length > 0;
}

export function FontsTab() {
  const qc = useQueryClient();
  const { error: toastError, success: toastSuccess } = useToast();

  const [rows, setRows] = useState<FontRow[]>([]);
  const [skipped, setSkipped] = useState<SkippedEntry[]>([]);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  /**
   * Progress through the current run. The total is fixed when the run starts
   * rather than recounted from `rows`, which shrinks as fonts install — read
   * live it would count "3 of 15" down to "3 of 12".
   */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  /**
   * The open zip readers behind the current list. A candidate is not inflated
   * until it is uploaded, so the readers have to outlive the drop — and be
   * closed once nothing is left to read out of them, or a dismissed archive
   * leaves its worker pool running.
   */
  const sourceRef = useRef<FontSource | null>(null);

  const closeSource = useCallback(() => {
    const source = sourceRef.current;
    sourceRef.current = null;
    void source?.close();
  }, []);

  useEffect(() => closeSource, [closeSource]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-fonts'],
    queryFn: () => fontsApi.list(),
  });

  const onFiles = useCallback(
    async (files: File[]) => {
      closeSource();
      setRows([]);
      setSkipped([]);
      setReadError(null);
      setProgress(null);
      setReading(true);
      try {
        const source = await readFontSources(files);
        sourceRef.current = source;
        setRows(rowsFor(source.candidates));
        setSkipped(source.skipped);
        if (source.candidates.length === 0) {
          setReadError('No fonts were found in what you dropped.');
          closeSource();
        }
      } catch (err) {
        setReadError(
          err instanceof Error ? err.message : 'That could not be read as a font or an archive.',
        );
      } finally {
        setReading(false);
      }
    },
    [closeSource],
  );

  const patchRow = useCallback((id: string, patch: Partial<FontRow>) => {
    setRows((current) =>
      current.map((row) => (row.candidate.id === id ? { ...row, ...patch } : row)),
    );
  }, []);

  const install = useMutation({
    mutationFn: async () => {
      const targets = rows.filter(isInstallable);
      setProgress({ done: 0, total: targets.length });
      const failures: string[] = [];
      let done = 0;

      for (const target of targets) {
        patchRow(target.candidate.id, { uploading: true, error: undefined });
        try {
          const file = await target.candidate.read();
          await adminApi.uploadFont(file, target.name.trim());
          done++;
          setProgress({ done, total: targets.length });
          // Dropped from the list on success, so what is on screen when the
          // run ends is exactly what still needs attention.
          setRows((current) => current.filter((row) => row.candidate.id !== target.candidate.id));
        } catch (err) {
          failures.push(target.candidate.path);
          patchRow(target.candidate.id, {
            uploading: false,
            error: errorMessage(err, 'Upload failed.'),
          });
        }
      }

      return { done, failures };
    },
    onSuccess: ({ done, failures }) => {
      setProgress(null);
      if (done > 0) {
        qc.invalidateQueries({ queryKey: ['admin-fonts'] });
        toastSuccess(done === 1 ? 'Font installed.' : `${done} fonts installed.`);
      }
      if (failures.length > 0) {
        toastError(
          failures.length === 1
            ? `${failures[0]} could not be installed.`
            : `${failures.length} fonts could not be installed.`,
        );
      }
    },
    onError: () => {
      setProgress(null);
      toastError('The install run stopped unexpectedly.');
    },
  });

  // Nothing left to inflate — the list emptied, so the readers can go. Kept out
  // of the run itself because what remains is decided by it, not during it.
  useEffect(() => {
    if (!install.isPending && rows.length === 0) closeSource();
  }, [install.isPending, rows.length, closeSource]);

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return <div className={styles.error}>Failed to load custom fonts.</div>;
  }

  const fonts: CustomFont[] = data ?? [];
  const installedNames = new Set(fonts.map((font) => font.displayName.trim().toLowerCase()));
  const installable = rows.filter(isInstallable).length;
  const allSelected = rows.length > 0 && rows.every((row) => row.selected);
  const busy = install.isPending;

  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>Install fonts</h2>
      <DropZone
        onFiles={(files) => void onFiles(files)}
        multiple
        accept=".woff2,.woff,.ttf,.otf,.zip"
        label="Drag & drop font files or a .zip of them here"
        hint="woff2, woff, ttf, otf — max 50 MB per font"
      />

      {reading && (
        <div className={styles.loading}>
          <Spinner size="md" />
        </div>
      )}

      {readError && <p className={styles.formError}>{readError}</p>}

      {rows.length > 0 && (
        <>
          <div className={styles.sectionHeader}>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={allSelected}
                disabled={busy}
                aria-label="Select every font found"
                onChange={() =>
                  setRows((current) => current.map((row) => ({ ...row, selected: !allSelected })))
                }
              />
              <span>
                {installable} of {rows.length} selected
              </span>
            </label>
            <button
              className={styles.primaryBtn}
              type="button"
              disabled={installable === 0 || busy}
              onClick={() => install.mutate()}
            >
              {progress
                ? `Installing… ${progress.done}/${progress.total}`
                : installable === 1
                  ? 'Install font'
                  : `Install ${installable} fonts`}
            </button>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col" className={styles.fontPickCell} aria-label="Install" />
                  <th scope="col">Name</th>
                  <th scope="col">File</th>
                  <th scope="col">Format</th>
                  <th scope="col">Size</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const name = row.name.trim();
                  return (
                    <tr key={row.candidate.id}>
                      <td className={styles.fontPickCell}>
                        <input
                          type="checkbox"
                          checked={row.selected}
                          disabled={busy}
                          aria-label={`Install ${row.candidate.path}`}
                          onChange={() => patchRow(row.candidate.id, { selected: !row.selected })}
                        />
                      </td>
                      <td className={styles.fontNameCell}>
                        <input
                          type="text"
                          className={styles.formInput}
                          value={row.name}
                          placeholder="Display name"
                          disabled={busy}
                          aria-label={`Display name for ${row.candidate.path}`}
                          onChange={(e) => patchRow(row.candidate.id, { name: e.target.value })}
                        />
                        {row.selected && !name && (
                          <span className={`${styles.formError} ${styles.fontRowNote}`}>
                            A display name is required.
                          </span>
                        )}
                        {name !== '' && installedNames.has(name.toLowerCase()) && (
                          <span className={`${styles.formHint} ${styles.fontRowNote}`}>
                            A font is already installed under this name.
                          </span>
                        )}
                        {row.error && (
                          <span className={`${styles.formError} ${styles.fontRowNote}`}>
                            {row.error}
                          </span>
                        )}
                      </td>
                      <td className={styles.fontPathCell}>
                        {row.candidate.archive
                          ? `${row.candidate.archive} › ${row.candidate.path}`
                          : row.candidate.path}
                      </td>
                      <td>{row.candidate.format}</td>
                      <td>{row.uploading ? 'Uploading…' : formatBytes(row.candidate.size)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {skipped.length > 0 && (
        <div className={`${styles.settingMeta} ${styles.fontSkipped}`}>
          <span>Not installable:</span>
          {skipped.map((entry) => (
            <span key={entry.path}>
              {entry.path} — {entry.reason}
            </span>
          ))}
        </div>
      )}

      <h2 className={styles.sectionTitle}>Custom Fonts</h2>
      {fonts.length === 0 ? (
        <div className={styles.empty}>No custom fonts uploaded yet.</div>
      ) : (
        <div className={styles.serviceList}>
          {fonts.map((font) => (
            <InstalledFontRow key={font.id} font={font} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One installed font. Its own component so a Remove that is in flight disables
 * its own button rather than every Remove button on the page.
 */
function InstalledFontRow({ font }: { font: CustomFont }) {
  const qc = useQueryClient();
  const { error: toastError, success: toastSuccess } = useToast();

  const deleteFont = useMutation({
    mutationFn: () => adminApi.deleteFont(font.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-fonts'] });
      toastSuccess('Font deleted.');
    },
    onError: () => {
      toastError('Failed to delete font. Please try again.');
    },
  });

  return (
    <div className={styles.serviceRow}>
      <div className={styles.serviceInfo}>
        <span className={styles.serviceName}>{font.displayName}</span>
        <span className={styles.serviceMeta}>
          {font.format} &middot; uploaded {new Date(font.createdAt).toLocaleDateString()}
        </span>
      </div>
      <button
        className={styles.deleteBtn}
        type="button"
        disabled={deleteFont.isPending}
        onClick={() => deleteFont.mutate()}
      >
        Remove
      </button>
    </div>
  );
}
