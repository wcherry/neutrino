/**
 * Page-level test for the Reminders sidebar.
 *
 * `RemindersSidebar.test.tsx` hands the component its reminders directly, so it
 * proves the panel renders what it is given and nothing about what it is given.
 * The seam that was never covered is the one in between — the page's query, the
 * `linkedEventId`/`linkedTaskId` filter, and the props handed down — which is
 * where "no reminders show at all" would live.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import CalendarPage from '../../app/(apps)/calendar/page';
import type { ReminderResponse } from '../../lib/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));

const listReminders = vi.fn();
const listAllTasks = vi.fn();

vi.mock('@/lib/api', () => ({
  calendarApi: {
    listEvents: vi.fn(() => Promise.resolve({ events: [] })),
    listReminders: (...args: unknown[]) => listReminders(...args),
    listAllTasks: (...args: unknown[]) => listAllTasks(...args),
    listAttachments: vi.fn(() => Promise.resolve({ attachments: [] })),
  },
  storageApi: {},
}));

function reminder(overrides: Partial<ReminderResponse> = {}): ReminderResponse {
  return {
    id: 'rem-1',
    title: 'Water the plants',
    dueTime: '2026-09-24T18:00:00Z',
    completed: false,
    recurrenceRule: null,
    linkedEventId: null,
    linkedTaskId: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CalendarPage />
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------

describe('Calendar page — Reminders sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listReminders.mockResolvedValue({ reminders: [] });
    listAllTasks.mockResolvedValue([]);
  });

  it('shows a standalone reminder returned by the API', async () => {
    listReminders.mockResolvedValue({ reminders: [reminder()] });
    renderPage();
    expect(await screen.findByText('Water the plants')).toBeDefined();
  });

  it('shows a reminder from a backend that predates linkedTaskId', async () => {
    // An older server omits the field entirely rather than sending null; the
    // page must not treat "absent" as "belongs to a task".
    const legacy = reminder({ title: 'Legacy reminder' });
    delete (legacy as Partial<ReminderResponse>).linkedTaskId;
    listReminders.mockResolvedValue({ reminders: [legacy] });
    renderPage();
    expect(await screen.findByText('Legacy reminder')).toBeDefined();
  });

  it('keeps an event-linked reminder out of the standalone list', async () => {
    listReminders.mockResolvedValue({
      reminders: [reminder({ title: 'On an event', linkedEventId: 'evt-1' })],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('No reminders')).toBeDefined());
    expect(screen.queryByText('On an event')).toBeNull();
  });

  // The bug this file was written for: a reminder set in the task editor is a
  // date and time the user typed, and leaving it out of the panel meant setting
  // a reminder and watching it disappear.
  it('lists a task-linked reminder', async () => {
    listReminders.mockResolvedValue({
      reminders: [reminder({ title: 'Call the plumber', linkedTaskId: 'task-1' })],
    });
    renderPage();
    expect(await screen.findByText('Call the plumber')).toBeDefined();
  });

  it('marks a task-linked reminder as belonging to a task', async () => {
    listReminders.mockResolvedValue({
      reminders: [reminder({ title: 'Call the plumber', linkedTaskId: 'task-1' })],
    });
    renderPage();
    expect(await screen.findByLabelText('On a task')).toBeDefined();
  });

  it('names the task the reminder belongs to', async () => {
    listAllTasks.mockResolvedValue([
      { id: 'task-1', title: 'Fix the sink', notes: null, done: false, dueDate: null,
        position: 0, listId: null, eventId: null,
        createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' },
    ]);
    listReminders.mockResolvedValue({
      reminders: [reminder({ title: 'Call the plumber', linkedTaskId: 'task-1' })],
    });
    renderPage();
    // By title, not by text: the task's own name is also on screen in the Tasks
    // panel below, so a bare text query matches twice.
    expect(await screen.findByTitle('On task: Fix the sink')).toBeDefined();
  });

  it('calls the unfiltered reminders endpoint, with no event or task id', async () => {
    renderPage();
    await waitFor(() => expect(listReminders).toHaveBeenCalled());
    expect(listReminders).toHaveBeenCalledWith();
  });
});
