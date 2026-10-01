'use client';

/**
 * New from template (issue #128).
 *
 * Lists the caller's `.dotx` templates, takes a title for the new document and
 * makes it with `createDocFromTemplate` — the copy happens here in the browser,
 * since only the browser can open the template's ciphertext. Shared by the
 * editor's File menu and the `/docs` landing page, which is why it lives beside
 * the page rather than inside `editor/`.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import {
  Button, Modal, ModalBody, ModalFooter, ModalHeader, Spinner, TextInput, useToast,
} from '@neutrino/ui';
import { useUser } from '@neutrino/auth';
import { docsApi } from '@/lib/api';
import { createDocFromTemplate, TemplateEncryptionUnavailableError } from '@/lib/docTemplates';
import { ENCRYPTION_WARNING_MESSAGE } from '@/components/EncryptionWarningMessage';
import styles from './DocTemplatePickerModal.module.css';

export interface DocTemplatePickerModalProps {
  onClose: () => void;
  /** Called with the new document's id once its body is written. */
  onCreated: (docId: string) => void;
  /** Folder the new document is created in; My Drive when omitted. */
  folderId?: string | null;
}

export function DocTemplatePickerModal({ onClose, onCreated, folderId }: DocTemplatePickerModalProps) {
  const currentUser = useUser();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['doc-templates'],
    queryFn: () => docsApi.listTemplates(),
    staleTime: 0,
  });
  const templates = useMemo(() => data?.docs ?? [], [data]);

  // Preselect the first template so a user with one template is a click from
  // done, and seed the title from whichever template is picked — the name it
  // was saved under is the best guess at what the new document is.
  useEffect(() => {
    if (selectedId || templates.length === 0) return;
    setSelectedId(templates[0].id);
    setTitle(templates[0].title);
  }, [templates, selectedId]);

  const pick = (id: string) => {
    setSelectedId(id);
    const t = templates.find(x => x.id === id);
    if (t) setTitle(t.title);
  };

  const handleCreate = async () => {
    if (!selectedId || !title.trim() || creating) return;
    setCreating(true);
    try {
      const id = await createDocFromTemplate({
        userId: currentUser?.id,
        templateId: selectedId,
        title: title.trim(),
        folderId,
      });
      onCreated(id);
    } catch (err) {
      if (err instanceof TemplateEncryptionUnavailableError) {
        toast.warning(ENCRYPTION_WARNING_MESSAGE);
      } else {
        toast.error('Could not create a document from this template');
      }
      setCreating(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="md">
      <ModalHeader title="New from template" onClose={onClose} />
      <ModalBody>
        {isLoading && (
          <div className={styles.center}><Spinner size="sm" /></div>
        )}
        {isError && (
          <p className={styles.note}>Your templates could not be loaded. Try again in a moment.</p>
        )}
        {!isLoading && !isError && templates.length === 0 && (
          <p className={styles.note} data-testid="doc-templates-empty">
            You have no templates yet. Open a document and choose{' '}
            <strong>File → Export as… → Word template (.dotx)</strong>, saving it to Drive.
          </p>
        )}
        {templates.length > 0 && (
          <>
            <ul className={styles.list} role="listbox" aria-label="Templates">
              {templates.map(t => (
                <li key={t.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={t.id === selectedId}
                    className={t.id === selectedId ? `${styles.item} ${styles.selected}` : styles.item}
                    onClick={() => pick(t.id)}
                  >
                    <FileText size={16} aria-hidden />
                    <span className={styles.itemTitle}>{t.title}</span>
                  </button>
                </li>
              ))}
            </ul>
            <TextInput
              label="Document name"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }}
              fullWidth
            />
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          type="button"
          onClick={() => void handleCreate()}
          disabled={!selectedId || !title.trim() || creating}
        >
          {creating ? 'Creating…' : 'Create'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
