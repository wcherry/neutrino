'use client';

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EventResponse } from '@/lib/api';
import { DAYS } from './calendarConstants';
import { buildMonthGrid, isSameDay, buildWeekEventSegments, fmtTime } from './calendarHelpers';
import { eventColorStyle } from './calendars';
import { availabilityClass, availabilityOf } from './availability';
import { isTaskEvent, type TaskOccurrence } from './calendarTasks';
import { TaskCheckbox } from './TaskCheckbox';
import styles from './page.module.css';

/** Local `YYYY-MM-DD` — not `toISOString`, which would shift the day by the UTC offset. */
function isoDate(day: Date): string {
  const m = `${day.getMonth() + 1}`.padStart(2, '0');
  const d = `${day.getDate()}`.padStart(2, '0');
  return `${day.getFullYear()}-${m}-${d}`;
}

/** Height of one bar plus the gap under it, in px — mirrors `.weekEventBar` in the CSS. */
const LANE_HEIGHT = 20;
/** Lanes shown before the grid has been measured (and where it can't be, as in tests). */
const UNMEASURED_LANES = 3;
/** Where the bars start in a row: 6px cell padding + a 26px day number + its 4px margin. */
const BARS_TOP = 36;
/** Left empty under the bars so there's always somewhere in the day to click to add an event. */
const ADD_RESERVE = 20;
/** Mirrors `.monthWeek { min-height }`: rows never get shorter, the grid scrolls instead. */
const MIN_ROW_HEIGHT = 100;
/** Gap between a bar and its cell's edge, in px. */
const BAR_INSET = 4;

interface MonthViewProps {
  cursor: Date;
  events: EventResponse[];
  onDayClick: (day: Date) => void;
  onEventClick: (e: EventResponse) => void;
  startDay: number;
  /** The colour to draw an event in: its calendar's. Absent, the default colour. */
  colorOf?: (e: EventResponse) => string | undefined;
  /** Ticks or unticks a task drawn on the calendar (`calendarTasks.ts`). */
  onToggleTask?: (task: TaskOccurrence) => void;
  /** A day's "+N more": show every event of that day (the agenda). */
  onShowMore?: (day: Date) => void;
}

export default function MonthView({
  cursor,
  events,
  onDayClick,
  onEventClick,
  startDay,
  colorOf,
  onToggleTask,
  onShowMore,
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

  // How many lanes of bars a week row has room for. Measured from the grid, not the rows: a row
  // grows to fit its bars (`flex: 1 0 auto`), so its own height would only ever say "more".
  const gridRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(0);
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const available = el.clientHeight - (headerRef.current?.offsetHeight ?? 0);
      setRowHeight(available > 0 ? Math.max(MIN_ROW_HEIGHT, available / grid.length) : 0);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [grid.length]);
  /** How many lanes a week with `lanes` of them shows; the rest go into each day's "+N more". */
  const lanesShown = (lanes: number) => {
    if (rowHeight <= 0) return Math.min(lanes, UNMEASURED_LANES);
    const fit = Math.max(1, Math.floor((rowHeight - BARS_TOP - ADD_RESERVE) / LANE_HEIGHT));
    // Every lane when they all fit; otherwise the last lane that fits holds the "+N more".
    return lanes <= fit ? lanes : Math.max(1, fit - 1);
  };

  return (
    <div ref={gridRef} className={styles.monthGrid} data-testid="month-grid">
      <div ref={headerRef} className={styles.weekHeader} data-testid="month-week-header">
        {orderedDays.map((d) => (
          <div key={d} className={styles.weekHeaderCell}>{d}</div>
        ))}
      </div>
      {grid.map((week, wi) => {
        const segments = weekSegments[wi];
        const shown = lanesShown(segments.reduce((n, s) => Math.max(n, s.lane + 1), 0));
        const visible = segments.filter((s) => s.lane < shown);
        const overflow = segments.filter((s) => s.lane >= shown);
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
                      <button
                        type="button"
                        className={styles.moreEvents}
                        data-testid="more-events"
                        onClick={(e) => { e.stopPropagation(); onShowMore?.(new Date(day)); }}
                      >
                        +{hiddenCount} more
                      </button>
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
                const position = {
                  left: `calc(${(seg.startIndex / week.length) * 100}% + ${insetLeft}px)`,
                  width: `calc(${(seg.span / week.length) * 100}% - ${insetLeft + insetRight}px)`,
                  top: seg.lane * LANE_HEIGHT,
                };
                const task = seg.event;
                if (isTaskEvent(task)) {
                  // A div, not a button: the checkbox can't sit inside one.
                  return (
                    <div
                      key={seg.key}
                      className={`${styles.weekEventBar} ${styles.calendarTask} ${task.done ? styles.calendarTaskDone : ''}`}
                      data-testid="task-bar"
                      data-event-start-date={isoDate(week[seg.startIndex])}
                      style={position}
                      title={task.title}
                    >
                      <TaskCheckbox task={task} onToggle={onToggleTask} />
                      <button
                        type="button"
                        className={styles.calendarTaskTitle}
                        onClick={(e) => { e.stopPropagation(); onEventClick(task); }}
                      >
                        {!task.allDay && <span className={styles.weekEventBarTime}>{fmtTime(task.startTime)}</span>}
                        {task.title}
                      </button>
                    </div>
                  );
                }
                return (
                <button
                  key={seg.key}
                  type="button"
                  className={`${styles.weekEventBar} ${seg.continuesBefore ? styles.weekEventBarContinuesBefore : ''} ${seg.continuesAfter ? styles.weekEventBarContinuesAfter : ''} ${availabilityClass(seg.event)}`}
                  data-testid="event-bar"
                  data-availability={availabilityOf(seg.event)}
                  data-event-span={seg.span}
                  data-event-start-date={isoDate(week[seg.startIndex])}
                  style={{ ...position, ...eventColorStyle(colorOf?.(seg.event)) }}
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
