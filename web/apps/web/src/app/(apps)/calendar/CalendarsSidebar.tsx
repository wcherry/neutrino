'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { AlertDialog } from '@neutrino/ui';
import type { CalendarResponse } from '@neutrino/api-calendar';
import { CALENDAR_COLORS } from './calendars';
import styles from './page.module.css';

interface CalendarsSidebarProps {
  calendars: CalendarResponse[];
  onToggle: (id: string, visible: boolean) => void;
  onRecolor: (id: string, color: string) => void;
  onCreate: (name: string, color: string) => void;
  onDelete: (id: string) => void;
  /** Why the last change to a calendar failed, if it did. */
  error?: string | null;
}

/**
 * The user's calendars: a checkbox in each one's colour shows or hides its events, the swatch
 * beside it changes the colour, and a calendar other than the default can be deleted with its
 * events. Holiday calendars are added and set up in Settings → Calendar.
 */
export function CalendarsSidebar({ calendars, onToggle, onRecolor, onCreate, onDelete, error }: CalendarsSidebarProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(CALENDAR_COLORS[1]);
  const [deleting, setDeleting] = useState<CalendarResponse | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim(), color);
    setName('');
    setAdding(false);
  }

  return (
    <div data-testid="calendars-sidebar">
      <div className={styles.sidebarHeading}>
        <span className={styles.sidebarTitle}>Calendars</span>
        <button className={styles.reminderNewBtn} onClick={() => setAdding(true)} title="New calendar" aria-label="New calendar">
          <Plus size={14} />
        </button>
      </div>

      <ul className={styles.calendarList}>
        {calendars.map((c) => (
          <li key={c.id} className={styles.calendarRow} data-testid="calendar-row" data-calendar-id={c.id}>
            <input
              type="checkbox"
              className={styles.calendarCheck}
              style={{ accentColor: c.color }}
              checked={c.visible}
              onChange={(e) => onToggle(c.id, e.target.checked)}
              aria-label={`Show ${c.name}`}
            />
            <span className={styles.calendarName} title={c.name}>{c.name}</span>
            {c.readOnly && <Lock size={11} className={styles.calendarLock} aria-label="Read-only" />}
            {/* The swatch is the colour input: clicking it opens the browser's colour picker. */}
            <label className={styles.calendarSwatch} style={{ background: c.color }} title="Change colour">
              <input
                type="color"
                value={c.color}
                onChange={(e) => onRecolor(c.id, e.target.value)}
                aria-label={`Colour of ${c.name}`}
              />
            </label>
            {!c.isDefault && (
              <button
                className={`${styles.reminderActionBtn} ${styles.reminderActionDelete} ${styles.calendarDelete}`}
                onClick={() => setDeleting(c)}
                title="Delete calendar"
                aria-label={`Delete ${c.name}`}
              >
                <Trash2 size={11} />
              </button>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <form className={styles.calendarAddForm} onSubmit={submit}>
          <input
            className={styles.formInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Calendar name"
            aria-label="Calendar name"
            autoFocus
            maxLength={100}
          />
          <div className={styles.calendarColorChoices} role="radiogroup" aria-label="Colour">
            {CALENDAR_COLORS.map((choice) => (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={choice === color}
                aria-label={choice}
                className={`${styles.calendarColorChoice} ${choice === color ? styles.calendarColorChoiceActive : ''}`}
                style={{ background: choice }}
                onClick={() => setColor(choice)}
              />
            ))}
          </div>
          <div className={styles.calendarAddActions}>
            <button type="button" className={styles.calendarTextBtn} onClick={() => setAdding(false)}>Cancel</button>
            <button type="submit" className={styles.calendarTextBtn} disabled={!name.trim()}>Add</button>
          </div>
        </form>
      )}

      {error && <div className={styles.calendarError} role="alert">{error}</div>}

      <Link className={styles.calendarSettingsLink} href="/settings?tab=calendar">
        Add holidays…
      </Link>

      <AlertDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        variant="error"
        title={`Delete ${deleting?.name ?? 'calendar'}?`}
        description={
          deleting?.kind === 'holidays'
            ? 'Its holidays will no longer be shown.'
            : 'Every event in it will be deleted too.'
        }
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleting) onDelete(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
