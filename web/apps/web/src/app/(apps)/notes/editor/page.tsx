'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Spinner } from '@neutrino/ui';
import { notesApi } from '@/lib/api';
import BlockEditor, { Block, parseBlocks, serializeBlocks } from './BlockEditor';
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

  const { data: note, isLoading } = useQuery({
    queryKey: ['note', noteId],
    queryFn: () => notesApi.getNote(noteId),
    enabled: !!noteId,
  });

  const { data: allNotesData } = useQuery({
    queryKey: ['notes'],
    queryFn: () => notesApi.listNotes(),
  });

  const { data: backlinksData } = useQuery({
    queryKey: ['note-backlinks', noteId],
    queryFn: () => notesApi.getBacklinks(noteId),
    enabled: !!noteId,
  });

  const allNotes = allNotesData?.notes ?? [];
  const backlinks = backlinksData?.backlinks ?? [];

  useEffect(() => {
    if (note) {
      setBlocks(parseBlocks(note.content));
      setTitle(note.title);
      lastSavedRef.current = { content: note.content, title: note.title };
    }
  }, [note]);

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
        await notesApi.saveNote(noteId, {
          content: serialized,
          title: nextTitle !== lastSavedRef.current.title ? nextTitle : undefined,
        });
        lastSavedRef.current = { content: serialized, title: nextTitle };
        setSaveStatus('saved');
        queryClient.invalidateQueries({ queryKey: ['notes'] });
        queryClient.invalidateQueries({ queryKey: ['note-backlinks', noteId] });
      } catch {
        setSaveStatus('error');
      }
    },
    [noteId, queryClient]
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
