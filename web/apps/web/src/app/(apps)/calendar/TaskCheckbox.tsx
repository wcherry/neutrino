'use client';

import React from 'react';
import type { TaskOccurrence } from './calendarTasks';
import styles from './page.module.css';

/**
 * The box that completes a task drawn on the calendar. Its clicks stop here, so ticking it
 * neither opens the task nor counts as a click on the day behind it.
 */
export function TaskCheckbox({ task, onToggle }: { task: TaskOccurrence; onToggle?: (task: TaskOccurrence) => void }) {
  return (
    <input
      type="checkbox"
      className={styles.calendarTaskCheck}
      checked={task.done}
      disabled={!onToggle}
      onChange={() => onToggle?.(task)}
      onClick={(e) => e.stopPropagation()}
      aria-label={`${task.done ? 'Reopen' : 'Complete'} ${task.title}`}
      data-testid="calendar-task-check"
    />
  );
}
