'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Spinner, useToast } from '@neutrino/ui';
import {
  filesystemApi,
  storageApi,
  driveReadContent,
  driveAutosaveEncryptedContent,
  encryptionApi,
  mintFileKey,
  canEncryptFor,
  isMissingEncryptionKey,
} from '@neutrino/api-drive';
import { linksApi } from '@neutrino/api-links';
import { createNote, extractNoteText, listAllNotes } from '@/lib/noteFiles';
import { initSodium, decryptFile, fromBase64url, isUnlocked } from '@neutrino/e2e-crypto';
import { ENCRYPTION_WARNING_MESSAGE } from '@/components/EncryptionWarningMessage';
import { useUser } from '@neutrino/auth';
import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import { indexOnSave } from '@/lib/searchIndexUpdate';
import { useContentVersionGuard } from '@/hooks/useContentVersionGuard';
import { useFileSync } from '@/hooks/useFileSync';
import BlockEditor, { Block, type BlockEditorHandle, parseBlocks, serializeBlocks } from './BlockEditor';
import { extractWikiLinkTitles, blocksToMarkdown, blocksToHtml, type NoteLinkTarget } from './blockEditorHelpers';
import { HamburgerMenu } from './MenuBar';
import styles from './page.module.css';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DELAY_MS = 2000;
/** Fallback poll used only while the live-update socket is down. */
const OFFLINE_POLL_MS = 15000;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Whether these bytes could be a note's body rather than its ciphertext.
 *
 * A note body is `JSON.stringify(Block[])` or, for the oldest notes, plain
 * text — either way ordinary printable characters. Ciphertext decoded as UTF-8
 * is full of control bytes and replacement characters, so this separates the
 * two well enough to decide whether showing the bytes would be help or
 * gibberish. Tabs and newlines are legitimate note text; the rest of the C0
 * range is not.
 */
function looksLikeNoteText(raw: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/.test(raw);
}

function printNote(title: string, blocks: Block[]) {
  const pw = window.open('', '_blank');
  if (!pw) return;
  pw.document.write(`<!DOCTYPE html><html><head>
<meta charset="UTF-8"><title>${title || 'Untitled note'}</title>
<style>
* { box-sizing: border-box; }
body { margin: 40px auto; max-width: 700px; font-family: Arial, sans-serif; font-size: 11pt; color: #000; }
h1 { font-size: 20pt; margin: 0 0 16pt; }
p, li { line-height: 1.5; margin: 0 0 8pt; }
blockquote { border-left: 3px solid #ccc; margin: 0 0 8pt; padding-left: 12pt; color: #555; }
pre { background: #f5f5f5; padding: 8pt; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; }
table { border-collapse: collapse; margin-bottom: 8pt; }
td { border: 1px solid #ccc; padding: 4pt 8pt; }
</style></head><body>
<h1>${title || 'Untitled note'}</h1>
${blocksToHtml(blocks)}
</body></html>`);
  pw.document.close();
  pw.focus();
  pw.print();
}

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
  const [showBacklinks, setShowBacklinks] = useState(true);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const blockEditorRef = useRef<BlockEditorHandle>(null);
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

  const { dekResolved, isNewEncryption, awaitDek } = useEncryptedDocumentContent({
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
      // `awaitDek`, not `dekRef.current` — the same reason the save path below
      // uses it. The ref is empty while the key is still being fetched, and on
      // a reload this query is gated on `dekResolved`, which only means the
      // *attempt* has finished. Sampling the ref there reported "no key" for a
      // perfectly readable note and dropped through to the raw read below,
      // which for an encrypted note hands back its ciphertext — rendered as
      // the note's text, and then saved back over the real content by the next
      // autosave.
      const dek = await awaitDek();
      if (dek && !isNewEncryption) {
        await initSodium();
        const blob = await storageApi.downloadFile(noteId);
        const stored = new Uint8Array(await blob.arrayBuffer());
        // Saves write raw ciphertext bytes. A note saved by the old
        // notes-CRUD API before it was fixed wrote the base64url *text* of
        // the ciphertext instead — decode that first, and fall back to the
        // raw bytes for everything saved since.
        try {
          return new TextDecoder().decode(
            decryptFile(fromBase64url(new TextDecoder().decode(stored)), dek),
          );
        } catch {
          try {
            return new TextDecoder().decode(decryptFile(stored, dek));
          } catch {
            // Neither encoding opened with this key, and two very different
            // situations land here. One: a note whose body predates encryption
            // — opening it minted a key ref, but nothing has rewritten the
            // content, so `isNewEncryption` is false on every later visit while
            // the stored bytes are still plain text. Two: real ciphertext this
            // key cannot open. Only the first is safe to show, so the bytes
            // have to actually look like note text.
            const raw = new TextDecoder().decode(stored);
            if (!looksLikeNoteText(raw)) {
              throw new Error('stored note content could not be decrypted');
            }
            return raw;
          }
        }
      }
      // No DEK in hand. Raw bytes are only this note's text if it was never
      // encrypted — and a locked session cannot tell the difference, because
      // the key resolution that would have said so never ran.
      //
      // This is reachable on an ordinary reload: the keyring is unwrapped from
      // IndexedDB asynchronously, `useEncryptedDocumentContent` reports
      // `dekResolved` immediately while the session is still locked, and this
      // query is enabled off that. Reading raw there handed back the note's
      // ciphertext, which was rendered as its text — and would then be written
      // back over the real content by the next autosave. Failing instead is
      // recoverable: unlocking re-resolves the key, which flips `dekResolved`
      // and refetches this query with a DEK.
      if (currentUser?.id && !isUnlocked(currentUser.id)) {
        // A locked session has not minted anything, so a key ref on the server
        // means this note really was encrypted and these bytes really are its
        // ciphertext. (Once unlocked the check is useless: resolution mints a
        // key ref for a legacy note the moment it is opened, so every note has
        // one from then on — which is why this is asked only while locked.)
        const keyRef = await encryptionApi.getFileKey(noteId);
        if (keyRef) {
          throw new Error('note content is unreadable until the vault is unlocked');
        }
      }
      // Never encrypted — a legacy note stored as plaintext.
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
        // `awaitDek`, not `dekRef.current`. A save that lands while the key is
        // still being fetched — the first autosave after a reload, every time —
        // reads the ref as null, and this used to answer that by writing the
        // note in the clear. That is issue #95: the note then had no key ref,
        // so nothing ever came back to encrypt it. Waiting reports "no key"
        // only when the session is genuinely locked, and that is now a refusal
        // rather than a plaintext write.
        const dek = await awaitDek();
        if (!dek) throw new Error('no-dek');
        const meta = await driveAutosaveEncryptedContent(
          noteId,
          serialized,
          'note.json',
          dek,
          versionGuard.check(),
        );
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
        // Locked vault, or the keyring never reached this browser. The note is
        // still in the editor, so unlocking and saving again loses nothing.
        if (isMissingEncryptionKey(err)) {
          toast.warning(ENCRYPTION_WARNING_MESSAGE);
          return;
        }
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
    [noteId, queryClient, awaitDek, broadcastFileUpdate, currentUser?.id, versionGuard, toast]
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

  const handleManualSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    save(serializeBlocks(blocks), title);
  }, [blocks, title, save]);

  const handleBack = useCallback(async () => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    await save(serializeBlocks(blocks), title);
    router.push('/drive');
  }, [blocks, title, save, router]);

  const handleNewNote = useCallback(async () => {
    const newNote = await createNote('Untitled note');
    router.push(`/notes/editor?id=${newNote.id}`);
  }, [router]);

  const handleDuplicate = useCallback(async () => {
    const serialized = serializeBlocks(blocks);
    // The copy is a new Drive row with no key of its own. This used to fall
    // back to a plaintext write when the vault was locked, producing a note
    // that could never be encrypted (issue #95); now it declines up front,
    // before an empty note has been created to strand.
    if (!(await canEncryptFor(currentUser?.id))) {
      toast.warning(ENCRYPTION_WARNING_MESSAGE);
      return;
    }
    const newNote = await createNote(`${title || 'Untitled note'} (copy)`);
    try {
      const dek = await mintFileKey(currentUser?.id, newNote.id);
      await driveAutosaveEncryptedContent(newNote.id, serialized, 'note.json', dek);
      await linksApi.updateLinks(newNote.id, { linkedTitles: extractWikiLinkTitles(blocks) });
    } catch {
      toast.error('Note duplicated, but its content failed to copy.');
    }
    queryClient.invalidateQueries({ queryKey: ['notes'] });
    router.push(`/notes/editor?id=${newNote.id}`);
  }, [blocks, title, currentUser?.id, queryClient, router, toast]);

  const handleDelete = useCallback(async () => {
    await storageApi.deleteFile(noteId);
    queryClient.invalidateQueries({ queryKey: ['notes'] });
    toast.success('Note moved to trash');
    router.push('/notes');
  }, [noteId, queryClient, router, toast]);

  const handleExport = useCallback((format: 'md' | 'txt') => {
    const name = title || 'Untitled note';
    const text = format === 'md' ? blocksToMarkdown(blocks) : extractNoteText(serializeBlocks(blocks));
    const blob = new Blob([text], { type: format === 'md' ? 'text/markdown' : 'text/plain' });
    downloadBlob(blob, `${name}.${format}`);
  }, [blocks, title]);

  const handlePrint = useCallback(() => {
    printNote(title, blocks);
  }, [title, blocks]);

  // Select-all needs to span every block, not just whichever one is being
  // edited — see BlockEditor's `selectAll` for why that has to go through an
  // imperative handle rather than plain browser/execCommand behaviour.
  const handleSelectAll = useCallback(() => {
    blockEditorRef.current?.selectAll();
  }, []);

  // Cut/copy/paste/undo/redo already work natively while a block is actively
  // focused. Save, Print and Select-all don't: Save/Print are the ones the
  // browser would otherwise intercept itself (Save Page As / a print of the
  // raw DOM instead of `printNote`'s formatted layout), and Select-all's
  // native Ctrl+A only ever reaches the one block currently in edit mode.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        handleManualSave();
      } else if (key === 'p') {
        e.preventDefault();
        handlePrint();
      } else if (key === 'a' && document.activeElement !== titleInputRef.current) {
        // Leave the title field's own native select-all alone.
        e.preventDefault();
        handleSelectAll();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleManualSave, handlePrint, handleSelectAll]);

  if (!noteId) return <div className={styles.message}>No note ID provided.</div>;
  if (isLoading) return <Spinner size="lg" overlay />;

  return (
    <div className={styles.editor}>
      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <HamburgerMenu
          titleInputRef={titleInputRef}
          onSave={handleManualSave}
          onNewNote={handleNewNote}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onExport={handleExport}
          onPrint={handlePrint}
          onSelectAll={handleSelectAll}
          showBacklinks={showBacklinks}
          onToggleBacklinks={() => setShowBacklinks((v) => !v)}
        />
        <button className={styles.backBtn} onClick={handleBack}>
          <ArrowLeft size={16} />
          Notes
        </button>
        <input
          ref={titleInputRef}
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
            ref={blockEditorRef}
            blocks={blocks}
            onChange={handleBlocksChange}
            allNotes={allNotes}
            currentNoteId={noteId}
            onLinkClick={(id) => router.push(`/notes/editor?id=${id}`)}
          />
        </div>

        {/* ── Backlinks panel ── */}
        {showBacklinks && backlinks.length > 0 && (
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
