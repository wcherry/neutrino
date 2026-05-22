'use client';

import React, { useState } from 'react';
import { Plus, Search, X, Pencil, Trash2 } from 'lucide-react';
import type { ReminderResponse } from '@/lib/api';
import { isOverdue } from './calendarHelpers';
import styles from './page.module.css';

interface RemindersSidebarProps {
  reminders: ReminderResponse[];
  onToggle: (id: string, completed: boolean) => void;
  onEdit: (r: ReminderResponse) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

export function RemindersSidebar({
  reminders,
  onToggle,
  onEdit,
  onDelete,
  onNew,
}: RemindersSidebarProps) {
  const [search, setSearch] = useState('');

  const filtered = reminders.filter((r) =>
    r.title.toLowerCase().includes(search.toLowerCase())
  );
  const pending = filtered.filter((r) => !r.completed);
  const done = filtered.filter((r) => r.completed);

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
      {pending.length === 0 && done.length === 0 && (
        <div className={styles.noItems}>
          {search ? 'No matches' : 'No reminders'}
        </div>
      )}
      {pending.map((r) => (
        <ReminderItem key={r.id} reminder={r} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />
      ))}
      {done.length > 0 && (
        <div style={{ marginTop: 8, opacity: 0.55 }}>
          {done.map((r) => (
            <ReminderItem key={r.id} reminder={r} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </>
  );
}

function ReminderItem({
  reminder: r,
  onToggle,
  onEdit,
  onDelete,
}: {
  reminder: ReminderResponse;
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
        </div>
        {!r.completed && (
          <div className={`${styles.reminderDue} ${isOverdue(r.dueTime) ? styles.reminderDueOverdue : ''}`}>
            {isOverdue(r.dueTime) ? 'Overdue · ' : ''}
            {new Date(r.dueTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
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
