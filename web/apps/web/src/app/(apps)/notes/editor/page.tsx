'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@neutrino/ui';
import { notesApi } from '@/lib/api';
import { filesystemApi, storageApi, driveReadContent } from '@neutrino/api-drive';
import type { NoteMetaResponse } from '@neutrino/api-notes';
import { initSodium, encryptFile, decryptFile, toBase64url } from '@neutrino/e2e-crypto';
import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import BlockEditor, { Block, parseBlocks, serializeBlocks } from './BlockEditor';
import { extractWikiLinkTitles } from './blockEditorHelpers';
import styles from './page.module.css';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DELAY_MS = 2000;

export default function NoteEditorPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const noteId = searchParams.get('id') ?? '';
  const queryClient = useQueryClient();

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [title, setTitle] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef({ content: '', title: '' });

  const { dekRef, dekResolved, isNewEncryption } = useEncryptedDocumentContent({
    id: noteId,
    filename: 'note.json',
  });

  const { data: note, isLoading: metaLoading } = useQuery({
    queryKey: ['note', noteId],
    queryFn: () => notesApi.getNote(noteId),
    enabled: !!noteId,
  });

  // Content is fetched directly from the drive API (note.contentUrl), the
  // same pattern docs/sheets/slides use, rather than embedded in the notes
  // API's JSON response.
  const { data: noteContent, isLoading: contentLoading } = useQuery({
    queryKey: ['note-content', noteId, dekResolved, note?.contentUrl ?? ''],
    queryFn: async () => {
      if (!note?.contentUrl) return '';
      if (dekRef.current && !isNewEncryption) {
        try {
          await initSodium();
          const blob = await storageApi.downloadFile(noteId);
          const cipherBytes = new Uint8Array(await blob.arrayBuffer());
          const plainBytes = decryptFile(cipherBytes, dekRef.current);
          return new TextDecoder().decode(plainBytes);
        } catch {
          // Corrupt ciphertext or a stale/expired key ref — fall back to the
          // raw content rather than crashing the editor.
        }
      }
      return driveReadContent(note.contentUrl);
    },
    enabled: !!note?.contentUrl && dekResolved,
  });

  const isLoading = metaLoading || contentLoading;

  const { data: allNotesData } = useQuery({
    queryKey: ['notes'],
    queryFn: () => filesystemApi.getRootContents({ type: 'note' }),
  });

  const { data: backlinksData } = useQuery({
    queryKey: ['note-backlinks', noteId],
    queryFn: () => notesApi.getBacklinks(noteId),
    enabled: !!noteId,
  });

  const allNotes: NoteMetaResponse[] = (allNotesData?.files ?? []).map((f) => ({
    id: f.id,
    title: f.name,
    folderId: f.folderId,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }));
  const backlinks = backlinksData?.backlinks ?? [];

  useEffect(() => {
    if (note && noteContent !== undefined) {
      setBlocks(parseBlocks(noteContent));
      setTitle(note.title);
      lastSavedRef.current = { content: noteContent, title: note.title };
    }
  }, [note, noteContent]);

  const save = useCallback(
    async (serialized: string, nextTitle: string) => {
      if (
        serialized === lastSavedRef.current.content &&
        nextTitle === lastSavedRef.current.title
      ) {
        return;
      }
      setSaveStatus('saving');
      try {
        let contentToSend = serialized;
        if (dekRef.current) {
          await initSodium();
          const cipherBytes = encryptFile(new TextEncoder().encode(serialized), dekRef.current);
          contentToSend = toBase64url(cipherBytes);
        }
        // Wiki links must be extracted from the plaintext here — once
        // encrypted, the server can no longer read `[[links]]` out of `content`.
        const linkedTitles = extractWikiLinkTitles(JSON.parse(serialized) as Block[]);
        await notesApi.saveNote(noteId, {
          content: contentToSend,
          title: nextTitle !== lastSavedRef.current.title ? nextTitle : undefined,
          linkedTitles,
        });
        lastSavedRef.current = { content: serialized, title: nextTitle };
        setSaveStatus('saved');
        queryClient.invalidateQueries({ queryKey: ['notes'] });
        queryClient.invalidateQueries({ queryKey: ['note-backlinks', noteId] });
      } catch {
        setSaveStatus('error');
      }
    },
    [noteId, queryClient, dekRef]
  );

  function scheduleAutosave(nextBlocks: Block[], nextTitle: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
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
