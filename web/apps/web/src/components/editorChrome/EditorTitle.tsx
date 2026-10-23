'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { FileText, GitBranch, Lock, Paintbrush, Presentation, Table2, type LucideIcon } from 'lucide-react';
import { usePreference } from '@neutrino/preferences';
import styles from './editorChrome.module.css';

/**
 * The pieces of the editor frame's title bar that every editor shares in the new looks
 * (look-and-feel roadmap §2): the document icon in its app's colour, and the save state as a
 * quiet trust signal — "Saved and encrypted · just now". In the classic look neither changes
 * anything: the icon is not drawn and the editor's own wording is.
 */

export type EditorApp = 'docs' | 'sheets' | 'slides' | 'diagrams' | 'drawing';

const ICONS: Record<EditorApp, LucideIcon> = {
  docs: FileText,
  sheets: Table2,
  slides: Presentation,
  diagrams: GitBranch,
  drawing: Paintbrush,
};

function useNewLook(): boolean {
  const [look] = usePreference('appearance.look');
  return look !== 'classic';
}

/** The document's icon, tinted with its app's identity colour. Nothing in the classic look. */
export function EditorDocIcon({ app }: { app: EditorApp }) {
  const Icon = ICONS[app];
  if (!useNewLook()) return null;
  return (
    <span className={styles.docIcon} style={{ '--doc-icon-color': `var(--app-color-${app})` } as React.CSSProperties} aria-hidden="true">
      <Icon size={16} />
    </span>
  );
}

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

/**
 * A save state kept outside React, for an editor whose save loop should not re-render the whole
 * editor to say "Saving…" (a large sheet's grid, say): only `EditorSaveState` subscribes.
 */
export interface SaveStateStore {
  get(): SaveState;
  set(state: SaveState): void;
  subscribe(listener: () => void): () => void;
}

export function createSaveStateStore(initial: SaveState = 'saved'): SaveStateStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next) => {
      if (next === state) return;
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const NO_STORE: SaveStateStore = createSaveStateStore();

function since(at: number, now: number): string {
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Where the document's last save stands. In the classic look it is `classic` exactly as the editor
 * drew it before (or nothing); in the new looks it says the bytes left the device encrypted.
 */
export function EditorSaveState({ state: given, store, classic, className }: {
  state?: SaveState;
  store?: SaveStateStore;
  classic?: React.ReactNode;
  className?: string;
}) {
  const source = store ?? NO_STORE;
  const stored = useSyncExternalStore(source.subscribe, source.get, source.get);
  const state = given ?? stored;
  const newLook = useNewLook();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [previous, setPrevious] = useState(state);
  if (state !== previous) {
    setPrevious(state);
    if (state === 'saved') setSavedAt(Date.now());
  }
  useEffect(() => {
    if (savedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [savedAt]);

  if (!newLook) return classic === undefined ? null : <span className={className}>{classic}</span>;
  const text =
    state === 'saving' ? 'Encrypting and saving…'
      : state === 'unsaved' ? 'Unsaved changes'
        : state === 'error' ? 'Not saved yet'
          : savedAt === null ? 'Saved and encrypted' : `Saved and encrypted · ${since(savedAt, Math.max(now, savedAt))}`;
  return (
    <span className={`${styles.saveState} ${state === 'error' ? styles.saveStateError : ''}`} role="status" aria-live="polite">
      <Lock size={12} aria-hidden="true" />
      {text}
    </span>
  );
}
