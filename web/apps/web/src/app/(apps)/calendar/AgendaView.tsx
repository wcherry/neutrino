'use client';

import React, { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import type { EventResponse } from '@/lib/api';
import { DAYS } from './calendarConstants';
import { eventsForDay, fmtTime } from './calendarHelpers';
import styles from './page.module.css';

interface AgendaViewProps {
  cursor: Date;
  events: EventResponse[];
  onEventClick: (e: EventResponse) => void;
}

export default function AgendaView({
  cursor,
  events,
  onEventClick,
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

  if (daysWithEvents.length === 0) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 60, color: 'var(--color-text-tertiary, #9ca3af)' }}>
        <CalendarDays size={40} strokeWidth={1.5} style={{ margin: '0 auto 12px' }} />
        <p>No events this month.</p>
      </div>
    );
  }

  return (
    <div className={styles.agendaList}>
      {daysWithEvents.map(({ day, events: dayEvents }) => (
        <div key={day.toISOString()} className={styles.agendaDay}>
          <div className={styles.agendaDate}>
            <div className={styles.agendaDateNum}>{day.getDate()}</div>
            <div className={styles.agendaDateDay}>{DAYS[day.getDay()]}</div>
          </div>
          <div className={styles.agendaEvents}>
            {dayEvents.map((ev) => (
              <div key={ev.id} className={styles.agendaEvent} onClick={() => onEventClick(ev)}>
                <div className={styles.agendaEventTime}>
                  {ev.allDay ? 'All day' : `${fmtTime(ev.startTime)} – ${fmtTime(ev.endTime)}`}
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
