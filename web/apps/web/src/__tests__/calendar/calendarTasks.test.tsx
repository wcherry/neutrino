/**
 * Tasks with a due date drawn on the calendar (`calendar/calendarTasks.ts`): which tasks, when,
 * and the checkbox that completes them in the month, week and agenda views.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import type { TaskResponse } from '@neutrino/api-calendar';
import { isTaskEvent, taskEvents } from '../../app/(apps)/calendar/calendarTasks';
import MonthView from '../../app/(apps)/calendar/MonthView';
import WeekView from '../../app/(apps)/calendar/WeekView';
import AgendaView from '../../app/(apps)/calendar/AgendaView';

function task(id: string, overrides: Partial<TaskResponse> = {}): TaskResponse {
  return {
    id,
    title: `Task ${id}`,
    notes: null,
    done: false,
    dueDate: null,
    position: 0,
    eventId: null,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

const MARCH = ['2026-03-01T00:00:00Z', '2026-03-31T23:59:59Z'] as const;

describe('taskEvents', () => {
  it('draws a task due on a date as all-day on that date, open and unticked', () => {
    const [occurrence] = taskEvents([task('a', { dueDate: '2026-03-10T00:00:00Z', dueHasTime: false })], ...MARCH);
    expect(occurrence).toMatchObject({
      id: 'task:a',
      taskId: 'a',
      title: 'Task a',
      allDay: true,
      startTime: '2026-03-10T00:00:00Z',
      endTime: '2026-03-10T23:59:59Z',
      done: false,
    });
    expect(isTaskEvent(occurrence)).toBe(true);
  });

  it('draws a task due at a time at that time, for its estimate or half an hour', () => {
    const [plain, estimated] = taskEvents(
      [
        task('a', { dueDate: '2026-03-10T15:00:00Z', dueHasTime: true }),
        task('b', { dueDate: '2026-03-11T09:00:00Z', dueHasTime: true, estimateMinutes: 90 }),
      ],
      ...MARCH,
    );
    expect(plain).toMatchObject({ allDay: false, startTime: '2026-03-10T15:00:00.000Z', endTime: '2026-03-10T15:30:00.000Z' });
    expect(estimated.endTime).toBe('2026-03-11T10:30:00.000Z');
  });

  it('leaves out tasks with no due date, out of range, or already on the calendar as an event', () => {
    const shown = taskEvents(
      [
        task('none'),
        task('april', { dueDate: '2026-04-02T00:00:00Z' }),
        task('scheduled', { dueDate: '2026-03-10T00:00:00Z', eventId: 'evt-1' }),
        task('due', { dueDate: '2026-03-31T00:00:00Z' }),
      ],
      ...MARCH,
    );
    expect(shown.map((e) => e.taskId)).toEqual(['due']);
  });

  it('keeps a completed task, ticked', () => {
    const [occurrence] = taskEvents([task('a', { dueDate: '2026-03-10T00:00:00Z', done: true })], ...MARCH);
    expect(occurrence.done).toBe(true);
  });
});

describe('a task on the calendar', () => {
  const due = taskEvents(
    [
      task('a', { title: 'Pay rent', dueDate: '2026-03-10T00:00:00Z' }),
      task('b', { title: 'Call Sam', dueDate: '2026-03-11T00:00:00Z', done: true }),
    ],
    ...MARCH,
  );

  it('has an unticked checkbox in month view that completes it without opening it', () => {
    const onToggleTask = vi.fn();
    const onEventClick = vi.fn();
    const onDayClick = vi.fn();
    render(
      <MonthView cursor={new Date(2026, 2, 15)} events={due} startDay={0} onDayClick={onDayClick}
        onEventClick={onEventClick} onToggleTask={onToggleTask} />,
    );
    const rent = screen.getAllByTestId('task-bar').find((b) => b.textContent?.includes('Pay rent'))!;
    const box = within(rent).getByRole('checkbox', { name: 'Complete Pay rent' });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(onToggleTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'a', done: false }));
    expect(onEventClick).not.toHaveBeenCalled();
    expect(onDayClick).not.toHaveBeenCalled();

    expect(screen.getByRole('checkbox', { name: 'Reopen Call Sam' })).toBeChecked();
  });

  it('opens the task when its title is clicked', () => {
    const onEventClick = vi.fn();
    render(
      <MonthView cursor={new Date(2026, 2, 15)} events={due} startDay={0} onDayClick={vi.fn()} onEventClick={onEventClick} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pay rent' }));
    expect(onEventClick).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'a' }));
  });

  it('is drawn apart from events, not as an event bar', () => {
    render(<MonthView cursor={new Date(2026, 2, 15)} events={due} startDay={0} onDayClick={vi.fn()} onEventClick={vi.fn()} />);
    expect(screen.queryAllByTestId('event-bar')).toHaveLength(0);
    expect(screen.getAllByTestId('task-bar')).toHaveLength(2);
  });

  it('has a checkbox in week view', () => {
    const onToggleTask = vi.fn();
    render(
      <WeekView cursor={new Date(2026, 2, 10)} events={due} startDay={0} onDayClick={vi.fn()}
        onEventClick={vi.fn()} onToggleTask={onToggleTask} />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete Pay rent' }));
    expect(onToggleTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'a' }));
  });

  it('has a checkbox in agenda view', () => {
    const onToggleTask = vi.fn();
    render(<AgendaView cursor={new Date(2026, 2, 1)} events={due} onEventClick={vi.fn()} onToggleTask={onToggleTask} />);
    expect(screen.getAllByTestId('agenda-task')).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete Pay rent' }));
    expect(onToggleTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'a' }));
  });
});
