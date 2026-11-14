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
import { ArrowLeft, Download, File as FileIcon, Folder, FolderPlus, Pencil, Trash2, Upload } from 'lucide-react';
import { Button, Heading, Spinner, Text } from '@neutrino/ui';
import { ApiClientError } from '@neutrino/api-core';
import {
  linkFolderApi,
  readLinkFile,
  uploadToLinkFolder,
  type FileItem,
  type Folder as FolderItem,
  type LinkSession,
} from '@neutrino/api-drive';
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
  const fileInput = React.useRef<HTMLInputElement | null>(null);

  const folderId = crumbs[crumbs.length - 1].id;
  const queryKey = ['link-folder', token, folderId];

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

  async function download(file: FileItem): Promise<void> {
    setStatus({ kind: 'info', text: `Decrypting ${file.name}…` });
    try {
      const bytes = await withSession((s) => readLinkFile(s, file));
      if (!bytes) {
        setStatus({
          kind: 'error',
          text: `${file.name} is not ready to open through this link yet. The owner can fix that by opening the folder's Share dialog.`,
        });
        return;
      }
      const url = URL.createObjectURL(
        new Blob([bytes.buffer as ArrayBuffer], { type: file.mimeType || 'application/octet-stream' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setStatus(null);
    } catch (e) {
      setStatus({ kind: 'error', text: describe(e) });
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
    // At the shared folder itself, 404 means the guest folder API is switched off on this server
    // (`folderLinkEditing`), not that the folder moved.
    const offHere =
      crumbs.length === 1 && error instanceof ApiClientError && error.statusCode === 404;
    return (
      <div className={styles.browserCard}>
        <Text color="error">
          {offHere ? 'Shared folders cannot be opened on this server yet.' : describe(error)}
        </Text>
      </div>
    );
  }

  const folders = [...data.folders].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...data.files].sort((a, b) => a.name.localeCompare(b.name));

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
              <button
                type="button"
                className={styles.crumb}
                onClick={() => setCrumbs((all) => all.slice(0, i + 1))}
                disabled={i === crumbs.length - 1}
              >
                {i === 0 ? <Heading level={1} size="lg">{c.name}</Heading> : c.name}
              </button>
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

      {folders.length === 0 && files.length === 0 ? (
        <div className={styles.empty}>
          <Text color="muted">{canWrite ? 'This folder is empty. Drop files here to add them.' : 'This folder is empty.'}</Text>
        </div>
      ) : (
        <ul className={styles.rows}>
          {folders.map((f: FolderItem) => (
            <Row
              key={f.id}
              icon={<Folder size={16} />}
              name={f.name}
              meta="Folder"
              onOpen={() => setCrumbs((c) => [...c, { id: f.id, name: f.name }])}
              canWrite={canWrite}
              busy={busy}
              renaming={renaming?.id === f.id ? renaming.name : null}
              onRenameStart={() => setRenaming({ id: f.id, kind: 'folder', name: f.name })}
              onRenameChange={(name) => setRenaming({ id: f.id, kind: 'folder', name })}
              onRenameCancel={() => setRenaming(null)}
              onRenameSubmit={(name) => {
                setRenaming(null);
                void act('Renaming…', () => withSession((s) => linkFolderApi.updateFolder(s, f.id, { name })));
              }}
              confirming={confirmDelete === f.id}
              onDelete={() => setConfirmDelete(f.id)}
              onDeleteCancel={() => setConfirmDelete(null)}
              onDeleteConfirm={() => {
                setConfirmDelete(null);
                void act(`Deleting ${f.name}…`, () => withSession((s) => linkFolderApi.trashFolder(s, f.id)));
              }}
            />
          ))}
          {files.map((f) => (
            <Row
              key={f.id}
              icon={<FileIcon size={16} />}
              name={f.name}
              meta={formatSize(f.sizeBytes)}
              onOpen={() => void download(f)}
              openIcon={<Download size={14} />}
              canWrite={canWrite}
              busy={busy}
              renaming={renaming?.id === f.id ? renaming.name : null}
              onRenameStart={() => setRenaming({ id: f.id, kind: 'file', name: f.name })}
              onRenameChange={(name) => setRenaming({ id: f.id, kind: 'file', name })}
              onRenameCancel={() => setRenaming(null)}
              onRenameSubmit={(name) => {
                setRenaming(null);
                void act('Renaming…', () => withSession((s) => linkFolderApi.updateFile(s, f.id, { name })));
              }}
              confirming={confirmDelete === f.id}
              onDelete={() => setConfirmDelete(f.id)}
              onDeleteCancel={() => setConfirmDelete(null)}
              onDeleteConfirm={() => {
                setConfirmDelete(null);
                void act(`Deleting ${f.name}…`, () => withSession((s) => linkFolderApi.trashFile(s, f.id)));
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row(props: {
  icon: React.ReactNode;
  name: string;
  meta: string;
  onOpen: () => void;
  openIcon?: React.ReactNode;
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
  if (props.renaming !== null) {
    return (
      <li className={styles.row}>
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
    <li className={styles.row}>
      <button type="button" className={styles.rowMain} onClick={props.onOpen} title={props.name}>
        <span className={styles.rowIcon}>{props.icon}</span>
        <span className={styles.rowName}>{props.name}</span>
        <span className={styles.rowMeta}>{props.meta}</span>
        {props.openIcon && <span className={styles.rowIcon}>{props.openIcon}</span>}
      </button>
      {props.canWrite &&
        (props.confirming ? (
          <span className={styles.rowActions}>
            <Button size="sm" variant="danger" onClick={props.onDeleteConfirm} disabled={props.busy}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={props.onDeleteCancel}>
              Keep
            </Button>
          </span>
        ) : (
          <span className={styles.rowActions}>
            <button type="button" className={styles.iconBtn} aria-label={`Rename ${props.name}`} onClick={props.onRenameStart} disabled={props.busy}>
              <Pencil size={14} />
            </button>
            <button type="button" className={styles.iconBtn} aria-label={`Delete ${props.name}`} onClick={props.onDelete} disabled={props.busy}>
              <Trash2 size={14} />
            </button>
          </span>
        ))}
    </li>
  );
}
