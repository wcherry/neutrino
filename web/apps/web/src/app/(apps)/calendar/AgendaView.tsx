'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { CalendarDays } from 'lucide-react';
import type { EventResponse } from '@/lib/api';
import { DAYS } from './calendarConstants';
import { eventsForDay, fmtTime } from './calendarHelpers';
import { eventColorStyle } from './calendars';
import { availabilityClass, availabilityOf } from './availability';
import { isTaskEvent, type TaskOccurrence } from './calendarTasks';
import { TaskCheckbox } from './TaskCheckbox';
import styles from './page.module.css';

interface AgendaViewProps {
  cursor: Date;
  events: EventResponse[];
  onEventClick: (e: EventResponse) => void;
  /** The colour to draw an event in: its calendar's. Absent, the default colour. */
  colorOf?: (e: EventResponse) => string | undefined;
  /** Ticks or unticks a task drawn on the calendar (`calendarTasks.ts`). */
  onToggleTask?: (task: TaskOccurrence) => void;
  /** A day to scroll to, from the month view's "+N more". */
  focusDay?: Date | null;
}

/** Local `YYYY-MM-DD`. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

export default function AgendaView({
  cursor,
  events,
  onEventClick,
  colorOf,
  onToggleTask,
  focusDay,
}: AgendaViewProps) {
  const days = useMemo(() => {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    return Array.from({ length: 31 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const daysWithEvents = days
    .map((d) => ({ day: d, events: eventsForDay(events, d) }))
    .filter((x) => x.events.length > 0);

  // Scrolled to once its day is there: the events for a month just switched to may still be loading.
  const listRef = useRef<HTMLDivElement>(null);
  const focusKey = focusDay ? dayKey(focusDay) : null;
  const focusShown = focusKey !== null && daysWithEvents.some((x) => dayKey(x.day) === focusKey);
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!focusShown || scrolledTo.current === focusKey) return;
    scrolledTo.current = focusKey;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-date="${focusKey}"]`)
      ?.scrollIntoView?.({ block: 'start' });
  }, [focusKey, focusShown]);

  if (daysWithEvents.length === 0) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 60, color: 'var(--color-text-tertiary, var(--color-neutral-400))' }}>
        <CalendarDays size={40} strokeWidth={1.5} style={{ margin: '0 auto 12px' }} />
        <p>No events this month.</p>
      </div>
    );
  }

  return (
    <div ref={listRef} className={styles.agendaList}>
      {daysWithEvents.map(({ day, events: dayEvents }) => (
        <div key={day.toISOString()} className={styles.agendaDay} data-date={dayKey(day)}>
          <div className={styles.agendaDate}>
            <div className={styles.agendaDateNum}>{day.getDate()}</div>
            <div className={styles.agendaDateDay}>{DAYS[day.getDay()]}</div>
          </div>
          <div className={styles.agendaEvents}>
            {dayEvents.map((ev) => (
              <div
                key={ev.id}
                className={isTaskEvent(ev)
                  ? `${styles.agendaEvent} ${styles.calendarTask} ${ev.done ? styles.calendarTaskDone : ''}`
                  : `${styles.agendaEvent} ${availabilityClass(ev)}`}
                data-testid={isTaskEvent(ev) ? 'agenda-task' : 'agenda-event'}
                data-availability={isTaskEvent(ev) ? undefined : availabilityOf(ev)}
                style={isTaskEvent(ev) ? undefined : eventColorStyle(colorOf?.(ev))}
                onClick={() => onEventClick(ev)}
              >
                {isTaskEvent(ev) && <TaskCheckbox task={ev} onToggle={onToggleTask} />}
                <div className={styles.agendaEventTime}>
                  {isTaskEvent(ev)
                    ? (ev.allDay ? 'Due' : `Due ${fmtTime(ev.startTime)}`)
                    : ev.allDay ? 'All day' : `${fmtTime(ev.startTime)} – ${fmtTime(ev.endTime)}`}
                </div>
                <div>
                  <div className={styles.agendaEventTitle}>{ev.title}</div>
                  {ev.location && <div className={styles.agendaEventLocation}>{ev.location}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
