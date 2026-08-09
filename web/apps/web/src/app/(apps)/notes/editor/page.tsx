'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Spinner, useToast } from '@neutrino/ui';
import {
  filesystemApi,
  storageApi,
  driveReadContent,
  driveAutosaveContent,
  driveAutosaveEncryptedContent,
} from '@neutrino/api-drive';
import { linksApi } from '@neutrino/api-links';
import { extractNoteText, listAllNotes } from '@/lib/noteFiles';
import { initSodium, decryptFile, fromBase64url } from '@neutrino/e2e-crypto';
import { useUser } from '@neutrino/auth';
import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import { indexOnSave } from '@/lib/searchIndexUpdate';
import { useContentVersionGuard } from '@/hooks/useContentVersionGuard';
import { useFileSync } from '@/hooks/useFileSync';
import BlockEditor, { Block, parseBlocks, serializeBlocks } from './BlockEditor';
import { extractWikiLinkTitles, type NoteLinkTarget } from './blockEditorHelpers';
import styles from './page.module.css';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DELAY_MS = 2000;
/** Fallback poll used only while the live-update socket is down. */
const OFFLINE_POLL_MS = 15000;

export default function NoteEditorPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const noteId = searchParams.get('id') ?? '';
  const queryClient = useQueryClient();
  const currentUser = useUser();
  const toast = useToast();
  // Rejects a save that would overwrite a revision written elsewhere since this
  // note was loaded. See `useContentVersionGuard`.
  const versionGuard = useContentVersionGuard();

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [title, setTitle] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef({ content: '', title: '' });
  /** Editor holds edits that have not reached the server yet. */
  const dirtyRef = useRef(false);
  /**
   * Bumped on every local edit. A save only clears `dirtyRef` if no further
   * edit arrived while it was in flight — otherwise those newer keystrokes
   * would be exposed to being overwritten by an incoming remote revision.
   */
  const editSeqRef = useRef(0);
  /** A save is in flight. */
  const savingRef = useRef(false);
  /** The editor has been seeded with server content for this note. */
  const seededRef = useRef(false);
  /** `updatedAt` of the revision currently in the editor. */
  const appliedUpdatedAtRef = useRef<string | null>(null);

  const { dekRef, dekResolved, isNewEncryption } = useEncryptedDocumentContent({
    id: noteId,
    filename: 'note.json',
  });

  // ── Live updates ──────────────────────────────────────────────────────────
  // Peers signal "this note changed"; the content itself is re-read (and
  // decrypted) locally, so E2EE notes never travel through the relay.
  const onRemoteUpdateRef = useRef<(() => void) | null>(null);
  onRemoteUpdateRef.current = () => {
    queryClient.invalidateQueries({ queryKey: ['note', noteId] });
    queryClient.invalidateQueries({ queryKey: ['note-content', noteId] });
  };

  const { connected, broadcastFileUpdate } = useFileSync({
    fileId: noteId,
    enabled: !!noteId,
    onRemoteUpdateRef,
  });

  const { data: note, isLoading: metaLoading } = useQuery({
    queryKey: ['note', noteId],
    queryFn: () => storageApi.getFileInfo(noteId),
    enabled: !!noteId,
    // Metadata is the change detector for remote edits: always refetch on
    // focus, and poll as a fallback whenever the socket is unavailable.
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: connected ? false : OFFLINE_POLL_MS,
  });

  // Content is fetched directly from the drive API, the same pattern
  // docs/sheets/slides use, rather than embedded in a notes-specific response.
  const { data: noteContent, isLoading: contentLoading } = useQuery({
    queryKey: ['note-content', noteId, dekResolved],
    queryFn: async () => {
      if (dekRef.current && !isNewEncryption) {
        try {
          await initSodium();
          const blob = await storageApi.downloadFile(noteId);
          const stored = new Uint8Array(await blob.arrayBuffer());
          // Saves write raw ciphertext bytes. A note saved by the old
          // notes-CRUD API before it was fixed wrote the base64url *text* of
          // the ciphertext instead — decode that first, and fall back to the
          // raw bytes for everything saved since.
          let plainBytes: Uint8Array;
          try {
            plainBytes = decryptFile(
              fromBase64url(new TextDecoder().decode(stored)),
              dekRef.current,
            );
          } catch {
            plainBytes = decryptFile(stored, dekRef.current);
          }
          return new TextDecoder().decode(plainBytes);
        } catch {
          // Corrupt ciphertext or a stale/expired key ref — fall back to the
          // raw content rather than crashing the editor.
        }
      }
      return driveReadContent(`/api/v1/drive/files/${noteId}`);
    },
    enabled: !!note && dekResolved,
  });

  const isLoading = metaLoading || contentLoading;

  const { data: allNotesData } = useQuery({
    queryKey: ['notes'],
    queryFn: () => listAllNotes(),
  });

  const { data: backlinksData } = useQuery({
    queryKey: ['note-backlinks', noteId],
    queryFn: () => linksApi.getBacklinks(noteId),
    enabled: !!noteId,
  });

  const allNotes: NoteLinkTarget[] = allNotesData ?? [];
  const backlinks = backlinksData?.backlinks ?? [];

  // Switching notes starts from a clean slate.
  useEffect(() => {
    seededRef.current = false;
    dirtyRef.current = false;
    savingRef.current = false;
    appliedUpdatedAtRef.current = null;
  }, [noteId]);

  // A newer `updatedAt` than the revision on screen means someone else saved —
  // pull the content down. Our own saves record their `updatedAt` below, so
  // they never trigger a re-read.
  useEffect(() => {
    if (!note || !seededRef.current) return;
    if (appliedUpdatedAtRef.current && note.updatedAt !== appliedUpdatedAtRef.current) {
      queryClient.invalidateQueries({ queryKey: ['note-content', noteId] });
    }
  }, [note, noteId, queryClient]);

  // The note metadata query is also the guard's source of truth: it refetches
  // on focus and polls while the live socket is down, so a revision written by
  // another device reaches the guard before the next local save does.
  useEffect(() => {
    versionGuard.observe(note?.contentVersion);
  }, [note?.contentVersion, versionGuard]);

  useEffect(() => {
    if (!note || noteContent === undefined) return;

    const apply = () => {
      setBlocks(parseBlocks(noteContent));
      setTitle(note.name);
      lastSavedRef.current = { content: noteContent, title: note.name };
      appliedUpdatedAtRef.current = note.updatedAt;
      seededRef.current = true;
    };

    // Initial load always seeds the editor.
    if (!seededRef.current) {
      apply();
      return;
    }

    // Never overwrite edits the user is still making. Their autosave wins
    // (last write wins, as before); the revision it produces is picked up by
    // the next update signal.
    if (dirtyRef.current || savingRef.current) return;

    // Echo of our own save — nothing to apply, but the revision is now current.
    if (noteContent === lastSavedRef.current.content && note.name === lastSavedRef.current.title) {
      appliedUpdatedAtRef.current = note.updatedAt;
      return;
    }

    apply();
  }, [note, noteContent]);

  const save = useCallback(
    async (serialized: string, nextTitle: string) => {
      const seq = editSeqRef.current;
      const clearDirtyIfSettled = () => {
        if (editSeqRef.current === seq) dirtyRef.current = false;
      };

      if (
        serialized === lastSavedRef.current.content &&
        nextTitle === lastSavedRef.current.title
      ) {
        clearDirtyIfSettled();
        return;
      }
      setSaveStatus('saving');
      savingRef.current = true;
      try {
        const titleChanged = nextTitle !== lastSavedRef.current.title;
        const meta = dekRef.current
          ? await driveAutosaveEncryptedContent(
              noteId,
              serialized,
              'note.json',
              dekRef.current,
              versionGuard.check(),
            )
          : await driveAutosaveContent(noteId, serialized, 'note.json', versionGuard.check());
        versionGuard.observe(meta.contentVersion);
        lastSavedRef.current = { content: serialized, title: nextTitle };
        appliedUpdatedAtRef.current = meta.updatedAt;
        clearDirtyIfSettled();
        setSaveStatus('saved');

        // Title and the link graph are metadata, saved best-effort alongside
        // the (version-guarded) content write above — a failure here doesn't
        // roll back a content save that already succeeded.
        // Wiki links must be extracted from the plaintext here — once
        // encrypted, the server can no longer read `[[links]]` out of `content`.
        const linkedTitles = extractWikiLinkTitles(JSON.parse(serialized) as Block[]);
        Promise.all([
          titleChanged ? filesystemApi.updateFile(noteId, { name: nextTitle }) : Promise.resolve(),
          linksApi.updateLinks(noteId, { linkedTitles }),
        ]).catch(() => {
          toast.error('Note saved, but the title or linked notes failed to update.');
        });

        queryClient.invalidateQueries({ queryKey: ['notes'] });
        queryClient.invalidateQueries({ queryKey: ['note-backlinks', noteId] });
        indexOnSave(currentUser?.id, {
          id: noteId,
          type: 'note',
          title: nextTitle,
          content: extractNoteText(serialized),
          updatedAt: new Date(meta.updatedAt).getTime(),
        });
        // Tell anyone else viewing this note to re-read it.
        broadcastFileUpdate();
      } catch (err) {
        setSaveStatus('error');
        // Another device saved this note while we were editing. Overwriting it
        // is a choice the user makes, not something autosave does quietly.
        if (versionGuard.handleError(err)) {
          toast.warning(
            'This note changed elsewhere since you opened it. Reload to get the ' +
              'latest version, or save again to keep your copy.',
          );
        }
      } finally {
        savingRef.current = false;
      }
    },
    [noteId, queryClient, dekRef, broadcastFileUpdate, currentUser?.id, versionGuard, toast]
  );

  function scheduleAutosave(nextBlocks: Block[], nextTitle: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    dirtyRef.current = true;
    editSeqRef.current += 1;
    setSaveStatus('idle');
    const serialized = serializeBlocks(nextBlocks);
    debounceRef.current = setTimeout(() => save(serialized, nextTitle), AUTOSAVE_DELAY_MS);
  }

  function handleBlocksChange(nextBlocks: Block[]) {
    setBlocks(nextBlocks);
    scheduleAutosave(nextBlocks, title);
  }

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setTitle(val);
    scheduleAutosave(blocks, val);
  }

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  if (!noteId) return <div className={styles.message}>No note ID provided.</div>;
  if (isLoading) return <Spinner size="lg" overlay />;

  return (
    <div className={styles.editor}>
      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <input
          className={styles.titleInput}
          value={title}
          onChange={handleTitleChange}
          placeholder="Untitled note"
          aria-label="Note title"
        />
        <div className={styles.toolbarRight}>
          <span className={styles.saveStatus}>
            {saveStatus === 'saving' && 'Saving…'}
            {saveStatus === 'saved' && 'Saved'}
            {saveStatus === 'error' && 'Save failed'}
          </span>
        </div>
      </div>

      {/* ── Main area ── */}
      <div className={styles.body}>
        <div className={styles.editorArea}>
          <BlockEditor
            blocks={blocks}
            onChange={handleBlocksChange}
            allNotes={allNotes}
            currentNoteId={noteId}
            onLinkClick={(id) => router.push(`/notes/editor?id=${id}`)}
          />
        </div>

        {/* ── Backlinks panel ── */}
        {backlinks.length > 0 && (
          <aside className={styles.backlinks}>
            <p className={styles.backlinksHeading}>Linked from</p>
            <ul className={styles.backlinksList}>
              {backlinks.map((bl) => (
                <li key={bl.id}>
                  <button
                    className={styles.backlinkItem}
                    onClick={() => router.push(`/notes/editor?id=${bl.id}`)}
                  >
                    {bl.title}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
