'use client';

import React, { useMemo } from 'react';
import type { EventResponse } from '@/lib/api';
import { DAYS } from './calendarConstants';
import { buildMonthGrid, isSameDay, buildWeekEventSegments, fmtTime } from './calendarHelpers';
import styles from './page.module.css';

/** Local `YYYY-MM-DD` — not `toISOString`, which would shift the day by the UTC offset. */
function isoDate(day: Date): string {
  const m = `${day.getMonth() + 1}`.padStart(2, '0');
  const d = `${day.getDate()}`.padStart(2, '0');
  return `${day.getFullYear()}-${m}-${d}`;
}

/** Height of one bar plus the gap under it, in px — mirrors `.weekEventBar` in the CSS. */
const LANE_HEIGHT = 20;
/** Bars past this many lanes collapse into the day cell's "+N more". */
const MAX_LANES = 3;
/** Gap between a bar and its cell's edge, in px. */
const BAR_INSET = 4;

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

  // One bar per event per week row, so a multi-day event is a single widget
  // covering its days rather than a chip on the first one — issue #130.
  const weekSegments = useMemo(
    () => grid.map((week) => buildWeekEventSegments(events, week)),
    [grid, events],
  );

  return (
    <div className={styles.monthGrid} data-testid="month-grid">
      <div className={styles.weekHeader} data-testid="month-week-header">
        {orderedDays.map((d) => (
          <div key={d} className={styles.weekHeaderCell}>{d}</div>
        ))}
      </div>
      {grid.map((week, wi) => {
        const segments = weekSegments[wi];
        const visible = segments.filter((s) => s.lane < MAX_LANES);
        const overflow = segments.filter((s) => s.lane >= MAX_LANES);
        const laneCount = visible.reduce((n, s) => Math.max(n, s.lane + 1), 0);

        return (
          <div key={wi} className={styles.monthWeek} data-testid="month-week">
            {week.map((day, di) => {
              const isCurrentMonth = day.getMonth() === cursor.getMonth();
              const isToday = isSameDay(day, today);
              const isPast = !isToday && day < today;
              const hiddenCount = overflow.filter(
                (s) => di >= s.startIndex && di < s.startIndex + s.span,
              ).length;
              return (
                <div
                  key={di}
                  className={`${styles.dayCell} ${!isCurrentMonth ? styles.dayCellOtherMonth : ''} ${isToday ? styles.dayCellToday : ''} ${isCurrentMonth && isPast ? styles.dayCellPast : ''}`}
                  data-testid="day-cell"
                  data-date={isoDate(day)}
                  onClick={() => onDayClick(new Date(day))}
                >
                  <span className={`${styles.dayNumber} ${!isCurrentMonth ? styles.dayNumberOtherMonth : ''} ${isCurrentMonth && isPast ? styles.dayNumberPast : ''}`}>
                    {day.getDate()}
                  </span>
                  <div className={styles.dayEvents}>
                    {/* The bars are laid over the whole week row, so each cell
                        reserves their height instead of holding them. */}
                    <div className={styles.dayEventsSpacer} style={{ height: laneCount * LANE_HEIGHT }} />
                    {hiddenCount > 0 && (
                      <div className={styles.moreEvents}>+{hiddenCount} more</div>
                    )}
                  </div>
                </div>
              );
            })}

            <div className={styles.weekEventLayer}>
              {visible.map((seg) => {
                // Inset from the cell edges, except on a side the bar runs past —
                // there it meets the row edge so the run reads as continuing.
                const insetLeft = seg.continuesBefore ? 0 : BAR_INSET;
                const insetRight = seg.continuesAfter ? 0 : BAR_INSET;
                return (
                <button
                  key={seg.key}
                  type="button"
                  className={`${styles.weekEventBar} ${seg.continuesBefore ? styles.weekEventBarContinuesBefore : ''} ${seg.continuesAfter ? styles.weekEventBarContinuesAfter : ''}`}
                  data-testid="event-bar"
                  data-event-span={seg.span}
                  data-event-start-date={isoDate(week[seg.startIndex])}
                  style={{
                    left: `calc(${(seg.startIndex / week.length) * 100}% + ${insetLeft}px)`,
                    width: `calc(${(seg.span / week.length) * 100}% - ${insetLeft + insetRight}px)`,
                    top: seg.lane * LANE_HEIGHT,
                  }}
                  onClick={(e) => { e.stopPropagation(); onEventClick(seg.event); }}
                  title={seg.event.title}
                >
                  {!seg.event.allDay && !seg.continuesBefore && (
                    <span className={styles.weekEventBarTime}>{fmtTime(seg.event.startTime)}</span>
                  )}
                  {seg.event.title}
                </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
