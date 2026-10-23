'use client';

/**
 * The note itself, drawn on its large grid card.
 *
 * A note body is E2EE, so there is no server-side thumbnail to point an
 * `<img>` at: each card downloads and decrypts its own note. Two things keep
 * that affordable on a long list. The read waits until the card scrolls near
 * the viewport, so a library of hundreds of notes costs only the cards on
 * screen; and the query is keyed on `updatedAt`, so a body is fetched once per
 * revision and an unrelated listing refresh re-reads nothing.
 *
 * A note this session cannot open — the vault is locked, or the key will not
 * unwrap — shows the note icon, never ciphertext. The lock subscription brings
 * the preview back the moment the vault is unlocked.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NotebookPen } from 'lucide-react';
import { useAuth } from '@neutrino/auth';
import { isUnlocked, subscribeToLockState } from '@neutrino/e2e-crypto';
import { readDocumentTextForDisplay } from '@/lib/documentContent';
import { NoteBlocks } from './NoteBlocks';
import styles from './NoteCardPreview.module.css';

/** Start reading a little before the card is on screen, so it is ready when it is. */
const PRELOAD_MARGIN = '200px';

function useNearViewport<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) setNear(true); },
      { rootMargin: PRELOAD_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near];
}

export function NoteCardPreview({ id, updatedAt }: { id: string; updatedAt: string }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [ref, near] = useNearViewport<HTMLDivElement>();

  const [, setLockEpoch] = useState(0);
  useEffect(() => subscribeToLockState(() => setLockEpoch((n) => n + 1)), []);
  const unlocked = !!userId && isUnlocked(userId);

  const { data: content, isPending, isError } = useQuery({
    queryKey: ['note-card-preview', id, updatedAt, userId, unlocked],
    queryFn: () => readDocumentTextForDisplay(userId!, id),
    enabled: near && !!userId,
    staleTime: Infinity,
  });

  let body: React.ReactNode;
  if (isError || content === null) {
    body = (
      <div className={styles.fallback}>
        <NotebookPen size={48} strokeWidth={1} />
      </div>
    );
  } else if (isPending) {
    body = (
      <div className={styles.skeleton} aria-hidden="true">
        <span /><span /><span /><span />
      </div>
    );
  } else if (!content.trim()) {
    body = <p className={styles.empty}>Empty note</p>;
  } else {
    body = <NoteBlocks content={content} className={styles.page} />;
  }

  return <div ref={ref} className={styles.root}>{body}</div>;
}
