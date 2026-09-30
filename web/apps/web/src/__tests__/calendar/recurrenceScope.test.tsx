/**
 * The "this / this and following / all" choice for a repeating event or reminder, and the forms
 * it opens (agent_docs/recurrence-exceptions.md).
 *
 * - The scope modal offers the three choices, named for events or reminders, and reports the one
 *   picked.
 * - An edit of one occurrence ("this") hides the repeat fields and sends no rule, since one
 *   occurrence on its own can't repeat. The other scopes keep them.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import RecurrenceScopeModal from '../../app/(apps)/calendar/RecurrenceScopeModal';
import NewEventModal from '../../app/(apps)/calendar/NewEventModal';
import ReminderModal from '../../app/(apps)/calendar/ReminderModal';
import type { EventResponse, ReminderResponse } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  calendarApi: {
    listAttachments: vi.fn(() => Promise.resolve({ attachments: [] })),
    createAttachment: vi.fn(() => Promise.resolve({})),
    deleteAttachment: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@neutrino/ui', () => ({
  Modal: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="modal">{children}</div> : null,
  ModalHeader: ({ title }: { title: string }) => <span data-testid="modal-title">{title}</span>,
  ModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick, type, form, disabled }: {
    children: React.ReactNode;
    onClick?: () => void;
    type?: string;
    form?: string;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} type={(type as 'button' | 'submit' | 'reset') ?? 'button'} form={form} disabled={disabled}>
      {children}
    </button>
  ),
}));

const standup: EventResponse = {
  id: 'series',
  title: 'Standup',
  description: null,
  startTime: '2027-01-04T09:00:00.000Z',
  endTime: '2027-01-04T09:30:00.000Z',
  allDay: false,
  location: null,
  recurrenceRule: 'FREQ=DAILY',
  attendees: [],
  source: 'local',
  createdAt: '2027-01-01T00:00:00Z',
  updatedAt: '2027-01-01T00:00:00Z',
  timezone: null,
};

const vitamins: ReminderResponse = {
  id: 'r1',
  title: 'Take vitamins',
  dueTime: '2026-09-24T16:00:00Z',
  completed: false,
  recurrenceRule: 'FREQ=DAILY',
  linkedEventId: null,
  linkedTaskId: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

describe('RecurrenceScopeModal', () => {
  it('offers this, this and following, and all, and reports the choice', () => {
    const onChoose = vi.fn();
    render(<RecurrenceScopeModal action="edit" kind="event" onChoose={onChoose} onClose={vi.fn()} />);

    expect(screen.getByTestId('modal-title')).toHaveTextContent('Edit repeating event');
    const choices = screen.getByRole('group').querySelectorAll('button');
    expect(Array.from(choices).map((b) => b.textContent))
      .toEqual(['This event', 'This and following events', 'All events']);

    fireEvent.click(screen.getByText('This and following events'));
    expect(onChoose).toHaveBeenCalledWith('following');
  });

  it('names reminders for a reminder, and says when it is a delete', () => {
    render(<RecurrenceScopeModal action="delete" kind="reminder" onChoose={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('modal-title')).toHaveTextContent('Delete repeating reminder');
    expect(screen.getByText('This reminder')).toBeInTheDocument();
    expect(screen.getByText('All reminders')).toBeInTheDocument();
  });

  it('does nothing but close when cancelled', () => {
    const onChoose = vi.fn();
    const onClose = vi.fn();
    render(<RecurrenceScopeModal action="delete" kind="event" onChoose={onChoose} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });
});

function renderEventForm(scope: 'this' | 'following' | 'all') {
  const onUpdate = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NewEventModal
        defaultDate={new Date(standup.startTime)}
        existingEvent={standup}
        scope={scope}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        isPending={false}
      />
    </QueryClientProvider>,
  );
  return onUpdate;
}

describe('the event form in a scope', () => {
  it('hides the repeat fields for one occurrence, and sends no rule', () => {
    const onUpdate = renderEventForm('this');
    expect(screen.queryByLabelText('Repeats')).not.toBeInTheDocument();
    expect(screen.getByTestId('edit-scope')).toHaveTextContent('This event');

    fireEvent.submit(document.getElementById('new-event-form')!);
    const [req] = onUpdate.mock.calls[0];
    expect(req).not.toHaveProperty('recurrenceRule');
    expect(req.title).toBe('Standup');
  });

  it('keeps the repeat fields, and the rule, for this and following', () => {
    const onUpdate = renderEventForm('following');
    expect(screen.getByLabelText('Repeats')).toBeInTheDocument();
    fireEvent.submit(document.getElementById('new-event-form')!);
    expect(onUpdate.mock.calls[0][0].recurrenceRule).toBe('FREQ=DAILY');
  });
});

describe('the reminder form in a scope', () => {
  it('hides the repeat choice for this reminder, and sends no rule', () => {
    const onSave = vi.fn();
    render(<ReminderModal initial={vitamins} scope="this" onClose={vi.fn()} onSave={onSave} isPending={false} />);
    expect(screen.queryByLabelText('Repeats')).not.toBeInTheDocument();
    expect(screen.getByTestId('edit-scope')).toHaveTextContent('This reminder');

    fireEvent.submit(document.getElementById('reminder-form')!);
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('recurrenceRule');
  });

  it('keeps the repeat choice for all reminders', () => {
    render(<ReminderModal initial={vitamins} scope="all" onClose={vi.fn()} onSave={vi.fn()} isPending={false} />);
    expect(screen.getByLabelText('Repeats')).toBeInTheDocument();
  });
});
