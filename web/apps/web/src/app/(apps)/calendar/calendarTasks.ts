// Tasks with a due date, drawn on the calendar beside events: a checkbox to complete them and a
// background of their own. They are not events: nothing is stored, the views just draw them.

import type { EventResponse, TaskResponse } from '@neutrino/api-calendar';

/** The `source` of a task drawn as an event, which no stored event has. */
export const TASK_SOURCE = 'task';

/** How long a task due at a time is drawn on the week grid, unless it has an estimate. */
const DEFAULT_TASK_MINUTES = 30;

/** A task as the views draw it: shaped like an event, carrying the task it stands for. */
export interface TaskOccurrence extends EventResponse {
  source: typeof TASK_SOURCE;
  taskId: string;
  done: boolean;
}

export function isTaskEvent(event: EventResponse): event is TaskOccurrence {
  return event.source === TASK_SOURCE && 'taskId' in event;
}

/**
 * The tasks due from `from` to `to` (inclusive, ISO instants), as events. A task due on a date
 * is all-day on that date, written as every all-day event is (`T00:00:00Z` to `T23:59:59Z`, read
 * by its date). One due at a time starts then and lasts its estimate, or half an hour.
 *
 * A task scheduled onto the calendar (`eventId`) is left out: its event is already drawn.
 * Completed tasks stay, ticked, so completing one doesn't make it vanish from under the pointer.
 */
export function taskEvents(tasks: readonly TaskResponse[], from: string, to: string): TaskOccurrence[] {
  const first = from.slice(0, 10);
  const last = to.slice(0, 10);
  const occurrences: TaskOccurrence[] = [];
  for (const task of tasks) {
    if (!task.dueDate || task.eventId) continue;
    const timed = task.dueHasTime === true;
    if (timed) {
      const start = Date.parse(task.dueDate);
      if (Number.isNaN(start) || start < Date.parse(from) || start > Date.parse(to)) continue;
    } else {
      const day = task.dueDate.slice(0, 10);
      if (day < first || day > last) continue;
    }
    const day = task.dueDate.slice(0, 10);
    const startTime = timed ? new Date(task.dueDate).toISOString() : `${day}T00:00:00Z`;
    const minutes = task.estimateMinutes && task.estimateMinutes > 0 ? task.estimateMinutes : DEFAULT_TASK_MINUTES;
    occurrences.push({
      id: `task:${task.id}`,
      title: task.title,
      description: task.notes,
      startTime,
      endTime: timed ? new Date(Date.parse(startTime) + minutes * 60_000).toISOString() : `${day}T23:59:59Z`,
      allDay: !timed,
      location: task.location ?? null,
      recurrenceRule: null,
      attendees: [],
      source: TASK_SOURCE,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      timezone: null,
      taskId: task.id,
      done: task.done,
    });
  }
  return occurrences;
}
