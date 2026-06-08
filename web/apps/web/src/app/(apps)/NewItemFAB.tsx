'use client';

import React, { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Bell, CalendarPlus, FileText, FolderPlus, GitBranch, NotebookPen, Plus, Presentation, Table2, Upload } from 'lucide-react';
import { useToast } from '@neutrino/ui';
import { docsApi, sheetsApi, slidesApi, notesApi, diagramsApi } from '@/lib/api';
import styles from './NewItemFAB.module.css';

const ACTIONS = [
  { id: 'doc',      label: 'Document',     icon: FileText,     color: 'var(--color-accent)',             driveOnly: false },
  { id: 'sheet',    label: 'Spreadsheet',  icon: Table2,       color: 'var(--color-green, #16a34a)',     driveOnly: false },
  { id: 'slide',    label: 'Presentation', icon: Presentation, color: 'var(--color-rose, #e11d48)',      driveOnly: false },
  { id: 'note',     label: 'Note',         icon: NotebookPen,  color: 'var(--color-amber, #d97706)',     driveOnly: false },
  { id: 'diagram',  label: 'Diagram',      icon: GitBranch,    color: 'var(--color-cyan, #0891b2)',      driveOnly: false },
  { id: 'event',    label: 'Event',        icon: CalendarPlus, color: 'var(--color-primary)',            driveOnly: false },
  { id: 'reminder', label: 'Reminder',     icon: Bell,         color: 'var(--color-purple, #7c3aed)',   driveOnly: false },
  { id: 'folder',   label: 'New folder',   icon: FolderPlus,   color: 'var(--color-amber, #d97706)',    driveOnly: true  },
  { id: 'upload',   label: 'Upload',       icon: Upload,       color: 'var(--color-primary)',            driveOnly: true  },
] as const;

type ActionId = typeof ACTIONS[number]['id'];

export function NewItemFAB() {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const isDrive = pathname.startsWith('/drive');
  const visibleActions = ACTIONS.filter((a) => !a.driveOnly || isDrive);

  async function handleAction(id: ActionId) {
    setOpen(false);
    if (id === 'folder') {
      window.dispatchEvent(new CustomEvent('drive:new-folder'));
      return;
    }
    if (id === 'upload') {
      window.dispatchEvent(new CustomEvent('drive:upload'));
      return;
    }
    setPending(true);
    try {
      switch (id) {
        case 'doc': {
          const doc = await docsApi.createDoc({ title: 'Untitled document' });
          router.push(`/docs/editor?id=${doc.id}`);
          break;
        }
        case 'sheet': {
          const sheet = await sheetsApi.createSheet({ title: 'Untitled spreadsheet' });
          router.push(`/sheets/editor?id=${sheet.id}`);
          break;
        }
        case 'slide': {
          const slide = await slidesApi.createSlide({ title: 'Untitled presentation' });
          router.push(`/slides/editor?id=${slide.id}`);
          break;
        }
        case 'note': {
          const note = await notesApi.createNote({ title: 'Untitled note' });
          router.push(`/notes/editor?id=${note.id}`);
          break;
        }
        case 'diagram': {
          const diagram = await diagramsApi.createDiagram({ title: 'Untitled diagram' });
          router.push(`/diagrams/editor?id=${diagram.id}`);
          break;
        }
        case 'event':
          router.push('/calendar?new=event');
          break;
        case 'reminder':
          router.push('/calendar?new=reminder');
          break;
      }
    } catch {
      toast.error('Failed to create item');
      setPending(false);
    }
  }

  return (
    <>
      {open && <div className={styles.backdrop} onClick={() => setOpen(false)} aria-hidden="true" />}
      <div className={styles.fab}>
        {open && (
          <div className={styles.menu} role="menu" aria-label="Create new item">
            {visibleActions.map(({ id, label, icon: Icon, color }) => (
              <button
                key={id}
                className={styles.menuItem}
                onClick={() => handleAction(id)}
                role="menuitem"
              >
                <span className={styles.menuIcon} style={{ color }}>
                  <Icon size={16} />
                </span>
                {label}
              </button>
            ))}
          </div>
        )}
        <button
          className={`${styles.trigger}${open ? ` ${styles.open}` : ''}`}
          onClick={() => setOpen((v) => !v)}
          disabled={pending}
          aria-label="Create new item"
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <Plus size={22} strokeWidth={2} />
        </button>
      </div>
    </>
  );
}
