'use client';

/**
 * A shared folder as someone holding its link sees it (#321).
 *
 * Everything runs against the link's guest session and the key in the URL fragment: listing and
 * writes through `/api/v1/share/folder/...`, file bytes and keys through the ordinary Drive routes,
 * which answer a guest from the live link. Nothing touches the visitor's own account, if they have
 * one signed in here — their stored token is never read or replaced.
 *
 * The session lasts an hour. A 401 re-opens it once with the same password before giving up, so a
 * tab left open does not fail its next click; a 401 that survives that means the owner turned the
 * link off, deleted it or changed the password.
 */

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlignJustify,
  ArrowLeft,
  Download,
  File as FileIcon,
  Folder,
  FolderPlus,
  Grid3x3,
  LayoutGrid,
  Pencil,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button, Heading, Spinner, Text } from '@neutrino/ui';
import { ApiClientError } from '@neutrino/api-core';
import {
  linkFolderApi,
  linkThumbnailUrl,
  readLinkFile,
  uploadToLinkFolder,
  type FileItem,
  type Folder as FolderItem,
  type LinkSession,
} from '@neutrino/api-drive';
import { LinkFilePreview } from './LinkFilePreview';
import { useDismiss } from '@neutrino/commands';
import styles from './page.module.css';

interface Props {
  token: string;
  initial: LinkSession;
  /** Opens a fresh session (with the same password); null when it can no longer be done. */
  renew: () => Promise<LinkSession | null>;
}

interface Crumb {
  id: string;
  name: string;
}

type Status = { kind: 'info' | 'error'; text: string } | null;

/** The same three views Drive offers, with the same icons and names. */
type ViewMode = 'large' | 'small' | 'list';

const VIEW_BUTTONS: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
  { mode: 'large', icon: <LayoutGrid size={15} />, label: 'Large grid' },
  { mode: 'small', icon: <Grid3x3 size={15} />, label: 'Small grid' },
  { mode: 'list', icon: <AlignJustify size={15} />, label: 'Detailed list' },
];

/** Remembered per browser, as a convenience only: anything unreadable falls back to the list. */
const VIEW_KEY = 'neutrino.share.view';

function readView(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'large' || v === 'small' || v === 'list' ? v : 'list';
  } catch {
    return 'list';
  }
}

function writeView(v: ViewMode): void {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    // Private window or blocked storage: the choice just is not remembered.
  }
}

/** One folder or file, as every layout renders it. */
interface Entry {
  key: string;
  kind: 'folder' | 'file';
  name: string;
  meta: string;
  /** The file itself, for a file: preview, download and the selection's zip read it. */
  file?: FileItem;
  /** Its cover thumbnail as an `<img src>`, when it has one. */
  thumb?: string | null;
  onOpen: () => void;
  onRename: (name: string) => void;
  /** Trash it. Resolves when done, so a bulk delete can run them in turn. */
  remove: () => Promise<unknown>;
}

/** Bytes to a saved file, through a short-lived blob URL. */
function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A zip entry name that cannot collide with one already in the archive. */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function describe(e: unknown): string {
  if (e instanceof ApiClientError) {
    if (e.statusCode === 401) return 'This link is no longer open. Ask the owner for a new one.';
    if (e.statusCode === 403) return 'This link does not allow that.';
    if (e.statusCode === 404) return 'That is no longer in this folder.';
    if (e.statusCode === 413) return "The folder owner's storage is full.";
    return e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong.';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function LinkFolderBrowser({ token, initial, renew }: Props) {
  const queryClient = useQueryClient();
  const sessionRef = React.useRef(initial);
  const [crumbs, setCrumbs] = React.useState<Crumb[]>([
    { id: initial.session.resourceId, name: initial.session.resourceName },
  ]);
  const [status, setStatus] = React.useState<Status>(null);
  const [busy, setBusy] = React.useState(false);
  const [newFolder, setNewFolder] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<{ id: string; kind: 'file' | 'folder'; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [view, setView] = React.useState<ViewMode>('list');
  const [query, setQuery] = React.useState('');
  React.useEffect(() => setView(readView()), []);
  // Selection (⌘/Ctrl-click to toggle, Shift-click for a range) and the open preview.
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = React.useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = React.useState<number | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement | null>(null);

  const folderId = crumbs[crumbs.length - 1].id;
  const queryKey = ['link-folder', token, folderId];

  // A selection belongs to the folder it was made in.
  React.useEffect(() => {
    setSelected(new Set());
    setAnchor(null);
    setConfirmBulkDelete(false);
    setPreviewIndex(null);
  }, [folderId]);

  // Esc clears the selection — a dismiss layer, so while the preview is open its own layer, which
  // is on top, takes the Esc instead.
  useDismiss(() => {
    setSelected(new Set());
    setConfirmBulkDelete(false);
  }, selected.size > 0);

  /** Run with the current session; on a 401, renew once and retry. */
  const withSession = React.useCallback(
    async <T,>(fn: (s: LinkSession) => Promise<T>): Promise<T> => {
      try {
        return await fn(sessionRef.current);
      } catch (e) {
        if (!(e instanceof ApiClientError && e.statusCode === 401)) throw e;
        const fresh = await renew();
        if (!fresh) throw e;
        sessionRef.current = fresh;
        return fn(fresh);
      }
    },
    [renew],
  );

  const { data, isLoading, error } = useQuery({
    queryKey,
    retry: false,
    queryFn: () => withSession((s) => linkFolderApi.contents(s, folderId)),
  });

  const canWrite = data?.role === 'editor';

  function refresh(): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: ['link-folder', token] });
  }

  async function act(label: string, fn: () => Promise<unknown>, done?: string): Promise<void> {
    setBusy(true);
    setStatus({ kind: 'info', text: label });
    try {
      await fn();
      await refresh();
      setStatus(done ? { kind: 'info', text: done } : null);
    } catch (e) {
      setStatus({ kind: 'error', text: describe(e) });
    } finally {
      setBusy(false);
    }
  }

  const notReady = (name: string) =>
    `${name} is not ready to open through this link yet. The owner can fix that by opening the folder's Share dialog.`;

  const read = React.useCallback(
    (file: FileItem) => withSession((s) => readLinkFile(s, file)),
    [withSession],
  );

  async function download(file: FileItem): Promise<void> {
    setStatus({ kind: 'info', text: `Decrypting ${file.name}…` });
    try {
      const bytes = await read(file);
      if (!bytes) {
        setStatus({ kind: 'error', text: notReady(file.name) });
        return;
      }
      saveBlob(
        new Blob([bytes.buffer as ArrayBuffer], { type: file.mimeType || 'application/octet-stream' }),
        file.name,
      );
      setStatus(null);
    } catch (e) {
      setStatus({ kind: 'error', text: describe(e) });
    }
  }

  /**
   * Several files as one zip, decrypted here one at a time. Folders in the selection are left out
   * (say so); a file the link holds no key for is skipped and counted rather than failing the rest.
   */
  async function downloadMany(files: FileItem[], skippedFolders: number): Promise<void> {
    if (files.length === 1 && skippedFolders === 0) return download(files[0]);
    if (files.length === 0) {
      setStatus({ kind: 'error', text: 'Folders cannot be downloaded from a link yet — open one and select its files.' });
      return;
    }
    setBusy(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const taken = new Set<string>();
      let unready = 0;
      for (const [i, f] of files.entries()) {
        setStatus({ kind: 'info', text: `Decrypting ${i + 1} of ${files.length}…` });
        const bytes = await read(f);
        if (!bytes) {
          unready++;
          continue;
        }
        const name = uniqueName(f.name, taken);
        taken.add(name);
        zip.file(name, bytes);
      }
      if (taken.size === 0) {
        setStatus({ kind: 'error', text: notReady(files.length === 1 ? files[0].name : 'None of these files') });
        return;
      }
      setStatus({ kind: 'info', text: 'Making the zip…' });
      const blob = await zip.generateAsync({ type: 'blob' });
      saveBlob(blob, `${crumbs[crumbs.length - 1].name || 'Shared files'}.zip`);
      const notes = [
        unready > 0 ? `${unready} not ready to open through this link yet` : '',
        skippedFolders > 0 ? `${skippedFolders} folder${skippedFolders === 1 ? '' : 's'} left out` : '',
      ].filter(Boolean);
      setStatus(
        notes.length > 0
          ? { kind: 'error', text: `Downloaded ${taken.size} of ${files.length} files (${notes.join('; ')}).` }
          : { kind: 'info', text: `Downloaded ${taken.size} files.` },
      );
    } catch (e) {
      setStatus({ kind: 'error', text: describe(e) });
    } finally {
      setBusy(false);
    }
  }

  async function upload(files: File[]): Promise<void> {
    if (files.length === 0) return;
    await act(
      files.length === 1 ? `Encrypting and uploading ${files[0].name}…` : `Encrypting and uploading ${files.length} files…`,
      async () => {
        for (const f of files) {
          await withSession((s) => uploadToLinkFolder(s, folderId, f));
        }
      },
      files.length === 1 ? `Uploaded ${files[0].name}` : `Uploaded ${files.length} files`,
    );
  }

  if (isLoading) {
    return (
      <div className={styles.browserCard}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={styles.browserCard}>
        <Text color="error">{describe(error)}</Text>
      </div>
    );
  }

  const entries: Entry[] = [
    ...[...data.folders]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f: FolderItem): Entry => ({
        key: f.id,
        kind: 'folder',
        name: f.name,
        meta: 'Folder',
        onOpen: () => {
          setQuery('');
          setCrumbs((c) => [...c, { id: f.id, name: f.name }]);
        },
        onRename: (name) =>
          void act('Renaming…', () => withSession((s) => linkFolderApi.updateFolder(s, f.id, { name }))),
        remove: () => withSession((s) => linkFolderApi.trashFolder(s, f.id)),
      })),
    ...[...data.files]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f): Entry => ({
        key: f.id,
        kind: 'file',
        name: f.name,
        meta: formatSize(f.sizeBytes),
        file: f,
        thumb: linkThumbnailUrl(sessionRef.current, f.coverThumbnailUrl),
        onOpen: () => void download(f),
        onRename: (name) =>
          void act('Renaming…', () => withSession((s) => linkFolderApi.updateFile(s, f.id, { name }))),
        remove: () => withSession((s) => linkFolderApi.trashFile(s, f.id)),
      })),
  ];
  const needle = query.trim().toLowerCase();
  const shown = needle ? entries.filter((e) => e.name.toLowerCase().includes(needle)) : entries;
  const listClass = view === 'list' ? styles.rows : view === 'large' ? styles.tiles : styles.tilesSmall;
  const previewFiles = shown.filter((e) => e.file).map((e) => e.file as FileItem);
  const chosen = entries.filter((e) => selected.has(e.key));

  /**
   * Click: open (a folder) or preview (a file). ⌘/Ctrl-click: add or remove from the selection.
   * Shift-click: select the run from the last clicked item, as Finder and Drive do.
   */
  function activate(e: React.MouseEvent, entry: Entry): void {
    if (e.metaKey || e.ctrlKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(entry.key)) next.delete(entry.key);
        else next.add(entry.key);
        return next;
      });
      setAnchor(entry.key);
      setConfirmBulkDelete(false);
      return;
    }
    if (e.shiftKey) {
      const from = anchor ? shown.findIndex((x) => x.key === anchor) : -1;
      const to = shown.findIndex((x) => x.key === entry.key);
      const [a, b] = from < 0 ? [to, to] : [Math.min(from, to), Math.max(from, to)];
      setSelected(new Set(shown.slice(a, b + 1).map((x) => x.key)));
      setConfirmBulkDelete(false);
      return;
    }
    if (selected.size > 0) {
      setSelected(new Set());
      setConfirmBulkDelete(false);
    }
    if (entry.file) {
      setPreviewIndex(previewFiles.findIndex((f) => f.id === entry.key));
    } else {
      entry.onOpen();
    }
  }

  function bulkDelete(): void {
    const items = chosen;
    setConfirmBulkDelete(false);
    setSelected(new Set());
    void act(
      `Deleting ${items.length} item${items.length === 1 ? '' : 's'}…`,
      async () => {
        for (const item of items) await item.remove();
      },
      `Deleted ${items.length} item${items.length === 1 ? '' : 's'}.`,
    );
  }

  return (
    <div
      className={`${styles.browserCard} ${dragging ? styles.dragging : ''}`}
      onDragOver={(e) => {
        if (!canWrite) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!canWrite) return;
        e.preventDefault();
        setDragging(false);
        void upload(Array.from(e.dataTransfer.files));
      }}
    >
      <div className={styles.browserHeader}>
        <div className={styles.crumbs}>
          {crumbs.length > 1 && (
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Back"
              onClick={() => setCrumbs((c) => c.slice(0, -1))}
            >
              <ArrowLeft size={16} />
            </button>
          )}
          {crumbs.map((c, i) => (
            <React.Fragment key={c.id}>
              {i > 0 && <span className={styles.crumbSep}>/</span>}
              {i === crumbs.length - 1 ? (
                // Where the visitor is: plain text, not a disabled button — a disabled button greys
                // its contents, which is what made the folder's own name hard to read.
                <span className={styles.crumbCurrent} aria-current="page">
                  {i === 0 ? <Heading level={1} size="lg">{c.name}</Heading> : c.name}
                </span>
              ) : (
                <button
                  type="button"
                  className={styles.crumb}
                  onClick={() => setCrumbs((all) => all.slice(0, i + 1))}
                >
                  {c.name}
                </button>
              )}
            </React.Fragment>
          ))}
        </div>
        {canWrite && (
          <div className={styles.toolbar}>
            <Button size="sm" variant="secondary" icon={<FolderPlus size={14} />} onClick={() => setNewFolder('')} disabled={busy}>
              New folder
            </Button>
            <Button size="sm" icon={<Upload size={14} />} onClick={() => fileInput.current?.click()} disabled={busy}>
              Upload
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = '';
                void upload(picked);
              }}
            />
          </div>
        )}
      </div>

      <Text size="xs" color="muted">
        {canWrite
          ? 'You can add, rename and delete files here. Files are encrypted in your browser before they are uploaded.'
          : 'You can open and download the files here.'}
      </Text>

      {chosen.length > 0 && (
        <div className={styles.selectionBar} role="toolbar" aria-label="Selected items">
          <span className={styles.selectionCount}>{chosen.length} selected</span>
          {confirmBulkDelete ? (
            <>
              <span>Delete {chosen.length === 1 ? 'it' : `all ${chosen.length}`}? They go to the owner&apos;s trash.</span>
              <Button size="sm" variant="danger" onClick={bulkDelete} disabled={busy}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmBulkDelete(false)}>
                Keep
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="secondary"
                icon={<Download size={14} />}
                disabled={busy}
                onClick={() =>
                  void downloadMany(
                    chosen.filter((e) => e.file).map((e) => e.file as FileItem),
                    chosen.filter((e) => !e.file).length,
                  )
                }
              >
                Download
              </Button>
              {canWrite && (
                <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} disabled={busy} onClick={() => setConfirmBulkDelete(true)}>
                  Delete
                </Button>
              )}
            </>
          )}
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Clear selection"
            onClick={() => {
              setSelected(new Set());
              setConfirmBulkDelete(false);
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className={styles.listBar}>
        <label className={styles.search}>
          <Search size={14} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this folder"
            aria-label="Search this folder"
          />
        </label>
        <div className={styles.viewToggle} role="group" aria-label="View mode">
          {VIEW_BUTTONS.map(({ mode, icon, label }) => (
            <button
              key={mode}
              type="button"
              className={`${styles.viewBtn} ${view === mode ? styles.viewBtnActive : ''}`}
              onClick={() => {
                setView(mode);
                writeView(mode);
              }}
              aria-label={label}
              aria-pressed={view === mode}
              title={label}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>

      {status && (
        <div role={status.kind === 'error' ? 'alert' : 'status'} className={status.kind === 'error' ? styles.statusError : styles.status}>
          {status.text}
        </div>
      )}

      {newFolder !== null && (
        <form
          className={styles.inlineForm}
          onSubmit={(e) => {
            e.preventDefault();
            const name = newFolder.trim();
            if (!name) return;
            setNewFolder(null);
            void act(`Creating ${name}…`, () => withSession((s) => linkFolderApi.createFolder(s, folderId, name)));
          }}
        >
          <input
            className={styles.textInput}
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            placeholder="Folder name"
            aria-label="New folder name"
            autoFocus
          />
          <Button size="sm" type="submit">Create</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setNewFolder(null)}>Cancel</Button>
        </form>
      )}

      {entries.length === 0 ? (
        <div className={styles.empty}>
          <Text color="muted">{canWrite ? 'This folder is empty. Drop files here to add them.' : 'This folder is empty.'}</Text>
        </div>
      ) : shown.length === 0 ? (
        <div className={styles.empty}>
          <Text color="muted">Nothing here matches “{query.trim()}”.</Text>
        </div>
      ) : (
        <ul className={listClass}>
          {shown.map((e) => (
            <Row
              key={e.key}
              layout={view}
              icon={e.kind === 'folder' ? <Folder size={view === 'large' ? 40 : 16} /> : <FileIcon size={view === 'large' ? 40 : 16} />}
              thumb={e.thumb}
              name={e.name}
              meta={e.meta}
              selected={selected.has(e.key)}
              onActivate={(ev) => activate(ev, e)}
              onDownload={e.file ? () => void download(e.file as FileItem) : undefined}
              canWrite={canWrite}
              busy={busy}
              renaming={renaming?.id === e.key ? renaming.name : null}
              onRenameStart={() => setRenaming({ id: e.key, kind: e.kind, name: e.name })}
              onRenameChange={(name) => setRenaming({ id: e.key, kind: e.kind, name })}
              onRenameCancel={() => setRenaming(null)}
              onRenameSubmit={(name) => {
                setRenaming(null);
                e.onRename(name);
              }}
              confirming={confirmDelete === e.key}
              onDelete={() => setConfirmDelete(e.key)}
              onDeleteCancel={() => setConfirmDelete(null)}
              onDeleteConfirm={() => {
                setConfirmDelete(null);
                void act(`Deleting ${e.name}…`, e.remove);
              }}
            />
          ))}
        </ul>
      )}
      {previewIndex !== null && previewIndex >= 0 && previewFiles[previewIndex] && (
        <LinkFilePreview
          files={previewFiles}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          read={read}
          onDownload={(f) => void download(f)}
        />
      )}
    </div>
  );
}

function Row(props: {
  layout: ViewMode;
  icon: React.ReactNode;
  thumb?: string | null;
  name: string;
  meta: string;
  selected: boolean;
  onActivate: (e: React.MouseEvent) => void;
  /** Files only: a download button beside the row's other actions. */
  onDownload?: () => void;
  canWrite: boolean;
  busy: boolean;
  renaming: string | null;
  onRenameStart: () => void;
  onRenameChange: (name: string) => void;
  onRenameCancel: () => void;
  onRenameSubmit: (name: string) => void;
  confirming: boolean;
  onDelete: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
}) {
  // A thumbnail that will not load (none stored after all, or the session just renewed) falls
  // back to the icon rather than leaving a broken image.
  const [thumbFailed, setThumbFailed] = React.useState(false);
  React.useEffect(() => setThumbFailed(false), [props.thumb]);
  const showThumb = !!props.thumb && !thumbFailed;

  const itemClass = [
    props.layout === 'list' ? styles.row : props.layout === 'large' ? styles.tile : styles.tileSmall,
    props.selected ? styles.selected : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (props.renaming !== null) {
    return (
      <li className={itemClass}>
        <form
          className={styles.inlineForm}
          onSubmit={(e) => {
            e.preventDefault();
            const name = (props.renaming ?? '').trim();
            if (name) props.onRenameSubmit(name);
          }}
        >
          <input
            className={styles.textInput}
            value={props.renaming}
            onChange={(e) => props.onRenameChange(e.target.value)}
            aria-label={`New name for ${props.name}`}
            autoFocus
          />
          <Button size="sm" type="submit">Save</Button>
          <Button size="sm" variant="ghost" type="button" onClick={props.onRenameCancel}>Cancel</Button>
        </form>
      </li>
    );
  }

  return (
    <li className={itemClass}>
      <button
        type="button"
        className={styles.rowMain}
        onClick={props.onActivate}
        title={props.name}
        aria-label={props.name}
        aria-pressed={props.selected}
      >
        <span className={`${styles.rowIcon} ${showThumb ? styles.hasThumb : ''}`}>
          {showThumb ? (
            // An authorised thumbnail URL, not a static asset: next/image has nothing to add.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={props.layout === 'large' ? styles.thumbLarge : styles.thumbSmall}
              src={props.thumb as string}
              alt=""
              loading="lazy"
              onError={() => setThumbFailed(true)}
            />
          ) : (
            props.icon
          )}
        </span>
        <span className={styles.rowName}>{props.name}</span>
        <span className={styles.rowMeta}>{props.meta}</span>
      </button>
      {props.canWrite && props.confirming ? (
        <span className={styles.rowActions}>
          <Button size="sm" variant="danger" onClick={props.onDeleteConfirm} disabled={props.busy}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={props.onDeleteCancel}>
            Keep
          </Button>
        </span>
      ) : (
        (props.onDownload || props.canWrite) && (
          <span className={styles.rowActions}>
            {props.onDownload && (
              <button type="button" className={styles.iconBtn} aria-label={`Download ${props.name}`} onClick={props.onDownload}>
                <Download size={14} />
              </button>
            )}
            {props.canWrite && (
              <>
                <button type="button" className={styles.iconBtn} aria-label={`Rename ${props.name}`} onClick={props.onRenameStart} disabled={props.busy}>
                  <Pencil size={14} />
                </button>
                <button type="button" className={styles.iconBtn} aria-label={`Delete ${props.name}`} onClick={props.onDelete} disabled={props.busy}>
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </span>
        )
      )}
    </li>
  );
}
