'use client';

import React, { useMemo } from 'react';
import type { EventResponse } from '@/lib/api';
import { DAYS } from './calendarConstants';
import { buildMonthGrid, isSameDay, eventsForDay, fmtTime } from './calendarHelpers';
import styles from './page.module.css';

interface MonthViewProps {
  cursor: Date;
  events: EventResponse[];
  onDayClick: (day: Date) => void;
  onEventClick: (e: EventResponse) => void;
  startDay: number;
}

export default function MonthView({
  cursor,
  events,
  onDayClick,
  onEventClick,
  startDay,
}: MonthViewProps) {
  const today = new Date();
  const grid = useMemo(() => buildMonthGrid(cursor, startDay), [cursor, startDay]);
  const orderedDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => DAYS[(startDay + i) % 7]),
    [startDay],
  );

  return (
    <div className={styles.monthGrid}>
      <div className={styles.weekHeader}>
        {orderedDays.map((d) => (
          <div key={d} className={styles.weekHeaderCell}>{d}</div>
        ))}
      </div>
      {grid.map((week, wi) => (
        <div key={wi} className={styles.monthWeek}>
          {week.map((day, di) => {
            const isCurrentMonth = day.getMonth() === cursor.getMonth();
            const isToday = isSameDay(day, today);
            const isPast = !isToday && day < today;
            const dayEvents = eventsForDay(events, day);
            return (
              <div
                key={di}
                className={`${styles.dayCell} ${!isCurrentMonth ? styles.dayCellOtherMonth : ''} ${isToday ? styles.dayCellToday : ''} ${isCurrentMonth && isPast ? styles.dayCellPast : ''}`}
                onClick={() => onDayClick(new Date(day))}
              >
                <span className={`${styles.dayNumber} ${!isCurrentMonth ? styles.dayNumberOtherMonth : ''} ${isCurrentMonth && isPast ? styles.dayNumberPast : ''}`}>
                  {day.getDate()}
                </span>
                <div className={styles.dayEvents}>
                  {dayEvents.slice(0, 3).map((ev) => (
                    <div
                      key={ev.id}
                      className={styles.eventChip}
                      onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
                      title={ev.title}
                    >
                      {!ev.allDay && <span style={{ opacity: 0.7, marginRight: 3 }}>{fmtTime(ev.startTime)}</span>}
                      {ev.title}
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <div className={styles.moreEvents}>+{dayEvents.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
