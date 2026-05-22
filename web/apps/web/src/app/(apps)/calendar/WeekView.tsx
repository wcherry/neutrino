'use client';

import React, { useMemo, useRef, useState } from 'react';
import type { EventResponse } from '@/lib/api';
import { DAYS } from './calendarConstants';
import {
  isSameDay,
  eventsForDay,
  fmtTime,
  weekStartDate,
  getEventTopOffset,
  getEventHeight,
} from './calendarHelpers';
import styles from './page.module.css';
import gridStyles from './WeekView.module.css';

// ── Constants ────────────────────────────────────────────────────────────────

const HOUR_HEIGHT = 60; // px per hour
const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);
const TOTAL_GRID_HEIGHT = 24 * HOUR_HEIGHT;

// ── Types ─────────────────────────────────────────────────────────────────────

interface WeekViewProps {
  cursor: Date;
  events: EventResponse[];
  onDayClick: (day: Date) => void;
  onEventClick: (e: EventResponse) => void;
  startDay: number;
  dayStartHour?: number;
  dayEndHour?: number;
}

// ── Legacy flat view (flag off) ───────────────────────────────────────────────

function WeekViewLegacy({
  cursor,
  events,
  onDayClick,
  onEventClick,
  startDay,
}: Omit<WeekViewProps, 'dayStartHour' | 'dayEndHour'>) {
  const today = new Date();
  const weekFirst = useMemo(() => weekStartDate(cursor, startDay), [cursor, startDay]);

  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekFirst);
    d.setDate(weekFirst.getDate() + i);
    return d;
  });

  return (
    <div className={styles.monthGrid}>
      <div className={styles.weekHeader}>
        {week.map((day) => (
          <div key={day.toISOString()} className={styles.weekHeaderCell}>
            {DAYS[day.getDay()]} {day.getDate()}
          </div>
        ))}
      </div>
      <div className={styles.monthWeek}>
        {week.map((day, di) => {
          const isToday = isSameDay(day, today);
          const dayEvents = eventsForDay(events, day);
          return (
            <div
              key={di}
              className={`${styles.dayCell} ${isToday ? styles.dayCellToday : ''}`}
              style={{ minHeight: 200 }}
              onClick={() => onDayClick(new Date(day))}
            >
              <span className={styles.dayNumber}>{day.getDate()}</span>
              <div className={styles.dayEvents}>
                {dayEvents.map((ev) => (
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
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Hour-grid view (flag on) ──────────────────────────────────────────────────

function fmtHourLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

function WeekViewGrid({
  cursor,
  events,
  onDayClick,
  onEventClick,
  startDay,
  dayStartHour = 8,
  dayEndHour = 20,
}: WeekViewProps) {
  const today = new Date();
  const weekFirst = useMemo(() => weekStartDate(cursor, startDay), [cursor, startDay]);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekFirst);
    d.setDate(weekFirst.getDate() + i);
    return d;
  });

  // All timed events per day on the full 24-hour grid
  const dayBuckets = week.map((day) => {
    const dayEvs = eventsForDay(events, day);
    const allDay: EventResponse[] = [];
    const timed: EventResponse[] = [];

    for (const ev of dayEvs) {
      if (ev.allDay) {
        allDay.push(ev);
      } else {
        timed.push(ev);
      }
    }
    return { day, allDay, timed };
  });

  // Out-of-range hour slots (for dimmed background)
  const dimmedHours = ALL_HOURS.filter(
    (h) => h < dayStartHour || h >= dayEndHour
  );

  const scrollAreaHeight = scrollAreaRef.current?.clientHeight ?? 0;

  return (
    <div className={gridStyles.container}>
      {/* ── Day header row ──────────────────────────────────────────────── */}
      <div className={gridStyles.headerRow}>
        <div className={gridStyles.gutterHeader} />
        {week.map((day) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              className={`${gridStyles.dayHeader} ${isToday ? gridStyles.dayHeaderToday : ''}`}
            >
              <span>{DAYS[day.getDay()]}</span>
              {isToday ? (
                <span className={gridStyles.dayHeaderTodayNum}>{day.getDate()}</span>
              ) : (
                <span className={gridStyles.dayHeaderNum}>{day.getDate()}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* ── All-day band ────────────────────────────────────────────────── */}
      <div className={gridStyles.alldayBand} data-testid="allday-band">
        <div className={gridStyles.alldayGutter}>all day</div>
        {dayBuckets.map(({ day, allDay }) => (
          <div key={day.toISOString()} className={gridStyles.alldayCol}>
            {allDay.map((ev) => (
              <button
                key={ev.id}
                className={gridStyles.eventChipInline}
                onClick={() => onEventClick(ev)}
                title={ev.title}
              >
                {ev.title}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* ── Scrollable timed area ────────────────────────────────────────── */}
      <div
        className={gridStyles.scrollArea}
        ref={scrollAreaRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div className={gridStyles.timedGrid}>
          {/* Time gutter */}
          <div className={gridStyles.timeGutter} style={{ height: TOTAL_GRID_HEIGHT }}>
            {ALL_HOURS.map((hour) => (
              <div
                key={hour}
                className={gridStyles.hourLabel}
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {fmtHourLabel(hour)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          <div className={gridStyles.dayColumns}>
            {dayBuckets.map(({ day, timed }) => {
              const isToday = isSameDay(day, today);

              // Compute scroll-based overflow indicators
              const visibleTop = scrollTop;
              const visibleBottom = scrollTop + scrollAreaHeight;

              const aboveEvents = timed.filter((ev) => {
                const top = getEventTopOffset(ev.startTime, 0, HOUR_HEIGHT);
                const height = getEventHeight(ev.startTime, ev.endTime, HOUR_HEIGHT);
                return top + height < visibleTop;
              });

              const belowEvents = timed.filter((ev) => {
                const top = getEventTopOffset(ev.startTime, 0, HOUR_HEIGHT);
                return top > visibleBottom;
              });

              return (
                <div
                  key={day.toISOString()}
                  className={gridStyles.dayColumn}
                  style={{ height: TOTAL_GRID_HEIGHT }}
                  onClick={() => onDayClick(new Date(day))}
                >
                  {/* Today tint */}
                  {isToday && <div className={gridStyles.dayColumnToday} />}

                  {/* Dimmed background for out-of-range hours */}
                  {dimmedHours.map((hour) => (
                    <div
                      key={hour}
                      className={gridStyles.hourSlotDimmed}
                      style={{ top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                    />
                  ))}

                  {/* Hour grid lines */}
                  {ALL_HOURS.map((hour) => (
                    <React.Fragment key={hour}>
                      <div
                        className={gridStyles.hourLine}
                        style={{ top: hour * HOUR_HEIGHT }}
                      />
                      <div
                        className={gridStyles.halfHourLine}
                        style={{ top: hour * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
                      />
                    </React.Fragment>
                  ))}

                  {/* Timed events — positioned on the full 24-hour grid */}
                  {timed.map((ev) => {
                    const top = getEventTopOffset(ev.startTime, 0, HOUR_HEIGHT);
                    const height = getEventHeight(ev.startTime, ev.endTime, HOUR_HEIGHT);
                    return (
                      <button
                        key={ev.id}
                        className={gridStyles.eventChip}
                        style={{ top, height }}
                        onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
                        title={ev.title}
                      >
                        <span className={gridStyles.eventChipTime}>{fmtTime(ev.startTime)}</span>
                        {ev.title}
                      </button>
                    );
                  })}

                  {/* Sticky above-fold indicator */}
                  {aboveEvents.length > 0 && (
                    <button
                      className={gridStyles.overflowIndicatorTop}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(aboveEvents[aboveEvents.length - 1]);
                      }}
                      title={`${aboveEvents.length} event${aboveEvents.length > 1 ? 's' : ''} above`}
                    >
                      ↑ {aboveEvents.length}
                    </button>
                  )}

                  {/* Sticky below-fold indicator */}
                  {belowEvents.length > 0 && (
                    <button
                      className={gridStyles.overflowIndicatorBottom}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(belowEvents[0]);
                      }}
                      title={`${belowEvents.length} event${belowEvents.length > 1 ? 's' : ''} below`}
                    >
                      ↓ {belowEvents.length}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Public export ─────────────────────────────────────────────────────────────

export default function WeekView(props: WeekViewProps) {
  return <WeekViewGrid {...props} />;
}
