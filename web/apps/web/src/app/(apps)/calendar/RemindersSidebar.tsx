'use client';

import React, { useState } from 'react';
import { Plus, Search, X, Pencil, Trash2, Repeat, CalendarDays, ListChecks } from 'lucide-react';
import type { ReminderResponse } from '@/lib/api';
import {
  REMINDER_RANGES,
  isOverdue,
  isWithinReminderRange,
  type ReminderRange,
} from './calendarHelpers';
import styles from './page.module.css';

interface RemindersSidebarProps {
  /**
   * Every reminder, including those that belong to an event or a task: this is the one place
   * that answers "what's due", so a reminder about a meeting belongs here too. Linked ones are
   * labelled, and still appear in their event's or task's own panel as well.
   */
  reminders: ReminderResponse[];
  /** Task titles by id, for labelling reminders that belong to a task. */
  taskTitles?: Record<string, string>;
  onToggle: (id: string, completed: boolean) => void;
  onEdit: (r: ReminderResponse) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

export function RemindersSidebar({
  reminders,
  taskTitles = {},
  onToggle,
  onEdit,
  onDelete,
  onNew,
}: RemindersSidebarProps) {
  const [search, setSearch] = useState('');
  // Defaults to every reminder: a filter added to a panel that had none should
  // not start by hiding things the user last saw.
  const [range, setRange] = useState<ReminderRange>('all');

  const inRange = reminders.filter((r) => isWithinReminderRange(r.dueTime, range));
  const filtered = inRange.filter((r) =>
    r.title.toLowerCase().includes(search.toLowerCase())
  );
  const pending = filtered.filter((r) => !r.completed);
  const done = filtered.filter((r) => r.completed);

  // How many the range is holding back, so an empty panel can say why rather
  // than reading as "you have no reminders".
  const hiddenByRange = reminders.length - inRange.length;

  return (
    <>
      <div className={styles.sidebarHeading}>
        <span className={styles.sidebarTitle}>Reminders</span>
        <button className={styles.reminderNewBtn} onClick={onNew} title="New reminder">
          <Plus size={14} />
        </button>
      </div>
      <div className={styles.reminderSearch}>
        <Search size={12} className={styles.reminderSearchIcon} />
        <input
          className={styles.reminderSearchInput}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
        />
        {search && (
          <button className={styles.reminderSearchClear} onClick={() => setSearch('')}>
            <X size={11} />
          </button>
        )}
      </div>
      <div className={styles.reminderRangeToggle} role="group" aria-label="Filter reminders by when they are due">
        {REMINDER_RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            className={`${styles.reminderRangeBtn} ${range === r.value ? styles.reminderRangeBtnActive : ''}`}
            onClick={() => setRange(r.value)}
            aria-pressed={range === r.value}
            title={r.title}
          >
            {r.label}
          </button>
        ))}
      </div>

      {pending.length === 0 && done.length === 0 && (
        <div className={styles.noItems}>
          {search
            ? 'No matches'
            : hiddenByRange > 0
              ? `Nothing due — ${hiddenByRange} later ${hiddenByRange === 1 ? 'reminder' : 'reminders'}`
              : 'No reminders'}
        </div>
      )}
      {pending.map((r) => (
        <ReminderItem key={r.id} reminder={r} taskTitles={taskTitles} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />
      ))}
      {done.length > 0 && (
        <div style={{ marginTop: 8, opacity: 0.55 }}>
          {done.map((r) => (
            <ReminderItem key={r.id} reminder={r} taskTitles={taskTitles} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </>
  );
}

function ReminderItem({
  reminder: r,
  taskTitles,
  onToggle,
  onEdit,
  onDelete,
}: {
  reminder: ReminderResponse;
  taskTitles: Record<string, string>;
  onToggle: (id: string, completed: boolean) => void;
  onEdit: (r: ReminderResponse) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className={styles.reminderItem}>
      <input
        type="checkbox"
        className={styles.reminderCheckbox}
        checked={r.completed}
        onChange={() => onToggle(r.id, !r.completed)}
      />
      <div className={styles.reminderContent}>
        <div className={styles.reminderTitle} style={r.completed ? { textDecoration: 'line-through' } : undefined}>
          {r.title}
          {r.recurrenceRule && (
            <Repeat size={10} className={styles.reminderRepeatIcon} aria-label="Repeats" role="img" />
          )}
        </div>
        {!r.completed && (
          <div className={`${styles.reminderDue} ${isOverdue(r.dueTime) ? styles.reminderDueOverdue : ''}`}>
            {isOverdue(r.dueTime) ? 'Overdue · ' : ''}
            {new Date(r.dueTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </div>
        )}
        {r.linkedEventId && (
          <div className={styles.reminderLink}>
            <CalendarDays size={10} aria-hidden /> Event
          </div>
        )}
        {r.linkedTaskId && (
          <div className={styles.reminderLink}>
            <ListChecks size={10} aria-hidden /> {taskTitles[r.linkedTaskId] ?? 'Task'}
          </div>
        )}
      </div>
      <div className={styles.reminderActions}>
        <button className={styles.reminderActionBtn} onClick={() => onEdit(r)} title="Edit">
          <Pencil size={12} />
        </button>
        <button className={`${styles.reminderActionBtn} ${styles.reminderActionDelete}`} onClick={() => onDelete(r.id)} title="Delete">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
