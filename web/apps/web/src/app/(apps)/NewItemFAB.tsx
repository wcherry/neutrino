'use client';

import React, { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Bell, CalendarPlus, FileText, FolderPlus, FolderUp, GitBranch, NotebookPen, Plus, Presentation, Table2, Upload, Paintbrush } from 'lucide-react';
import { useToast } from '@neutrino/ui';
import { usePreference } from '@neutrino/preferences';
import { docsApi, sheetsApi, slidesApi, diagramsApi, drawingApi } from '@/lib/api';
import { createNote } from '@/lib/noteFiles';
import styles from './NewItemFAB.module.css';

// `app` is the `apps.enabled` key an action belongs to: an app an administrator has hidden has no
// "New" entry either (customization roadmap §6.3).
const ACTIONS = [
  { id: 'doc',      label: 'Document',     icon: FileText,     color: 'var(--color-accent)',             driveOnly: false, app: 'docs' },
  { id: 'sheet',    label: 'Spreadsheet',  icon: Table2,       color: 'var(--color-green, #16a34a)',     driveOnly: false, app: 'sheets' },
  { id: 'slide',    label: 'Presentation', icon: Presentation, color: 'var(--color-rose, #e11d48)',      driveOnly: false, app: 'slides' },
  { id: 'note',     label: 'Note',         icon: NotebookPen,  color: 'var(--color-amber, #d97706)',     driveOnly: false, app: 'notes' },
  { id: 'diagram',  label: 'Diagram',      icon: GitBranch,    color: 'var(--color-cyan, #0891b2)',      driveOnly: false, app: 'diagrams' },
  { id: 'drawing',  label: 'Drawing',      icon: Paintbrush,    color: 'var(--color-cyan, #dcec82)',      driveOnly: false, app: 'drawing' },
  { id: 'event',    label: 'Event',        icon: CalendarPlus, color: 'var(--color-primary)',            driveOnly: false, app: 'calendar' },
  { id: 'reminder', label: 'Reminder',     icon: Bell,         color: 'var(--color-purple, #7c3aed)',   driveOnly: false, app: 'calendar' },
  { id: 'folder',   label: 'New folder',   icon: FolderPlus,   color: 'var(--color-amber, #d97706)',    driveOnly: true,  app: null },
  { id: 'upload',   label: 'Upload',       icon: Upload,       color: 'var(--color-primary)',            driveOnly: true,  app: null },
  { id: 'import',   label: 'Import folders', icon: FolderUp,   color: 'var(--color-primary)',            driveOnly: true,  app: null },
] as const;

type ActionId = typeof ACTIONS[number]['id'];

export interface NewItemFABProps {
  /**
   * `topbar` is the classic shell's filled button beside the search box. `sidebar` is the new
   * shell's, at the top of the sidebar: the look's primary button (filled only in Quiet
   * Precision), with the menu opening below it, frosted.
   */
  variant?: 'topbar' | 'sidebar';
  /** The collapsed rail shows the plus alone. */
  compact?: boolean;
}

export function NewItemFAB({ variant = 'topbar', compact = false }: NewItemFABProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [enabledApps] = usePreference('apps.enabled');

  const isDrive = pathname.startsWith('/drive');
  const visibleActions = ACTIONS.filter((a) => (!a.driveOnly || isDrive) && (a.app === null || enabledApps.includes(a.app)));

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
    if (id === 'import') {
      window.dispatchEvent(new CustomEvent('drive:import-folders'));
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
          const note = await createNote('Untitled note');
          router.push(`/notes/editor?id=${note.id}`);
          break;
        }
        case 'diagram': {
          const diagram = await diagramsApi.createDiagram({ title: 'Untitled diagram' });
          router.push(`/diagrams/editor?id=${diagram.id}`);
          break;
        }
        case 'drawing': {
          const drawing = await drawingApi.createDrawing({ title: 'Untitled drawing' });
          router.push(`/drawing/editor?id=${drawing.id}`);
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
    } finally {
      // Always, not only on failure: this component lives in the app shell and
      // survives the navigation above, so a `pending` left standing disables
      // the button for the rest of the session.
      setPending(false);
    }
  }

  return (
    <>
      {open && <div className={styles.backdrop} onClick={() => setOpen(false)} aria-hidden="true" />}
      <div className={styles.fab} data-variant={variant}>
        <button
          className={`${styles.trigger}${open ? ` ${styles.open}` : ''}`}
          onClick={() => setOpen((v) => !v)}
          disabled={pending}
          aria-label="Create new item"
          aria-expanded={open}
          aria-haspopup="menu"
          title={compact ? 'New' : undefined}
        >
          <Plus size={variant === 'sidebar' ? 18 : 14} strokeWidth={variant === 'sidebar' ? 2.2 : 2.5} />
          {!compact && 'New'}
        </button>
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
      </div>
    </>
  );
}
