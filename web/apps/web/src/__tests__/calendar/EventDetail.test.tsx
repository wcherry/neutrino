/**
 * Tests for EventDetail component — focused on the edit-event integration.
 *
 * Covers:
 *   - Renders the event title in the detail panel
 *   - Renders an "Edit" button
 *   - Clicking "Edit" calls the onEdit callback with the event
 *   - Renders the "Delete Event" button
 *   - Clicking "Delete Event" calls onDelete with the event id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { EventDetail, EventViewModal } from '../../app/(apps)/calendar/EventDetail';
import type { EventResponse } from '../../lib/api';
import { calendarApi } from '../../lib/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock calendarApi so no real HTTP calls are made
vi.mock('../../lib/api', () => ({
  calendarApi: {
    listReminders: vi.fn(() => Promise.resolve({ reminders: [] })),
    listAttachments: vi.fn(() => Promise.resolve({ attachments: [] })),
    deleteReminder: vi.fn(() => Promise.resolve()),
    createAttachment: vi.fn(() => Promise.resolve({ id: 'att-1', eventId: 'evt-1', fileId: null, name: null, note: 'test' })),
    deleteAttachment: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@neutrino/ui', () => ({
  Modal: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="modal">{children}</div> : null,
  ModalHeader: ({ title, onClose }: { title: string; onClose: () => void }) => (
    <div>
      <span>{title}</span>
      <button onClick={onClose}>close</button>
    </div>
  ),
  ModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleEvent: EventResponse = {
  id: 'evt-1',
  title: 'Product Review',
  description: 'Monthly product review session',
  startTime: '2025-06-15T14:00:00.000Z',
  endTime: '2025-06-15T15:00:00.000Z',
  allDay: false,
  location: 'Board Room',
  recurrenceRule: null,
  attendees: ['dave@example.com'],
  source: 'local',
  createdAt: '2025-06-01T00:00:00.000Z',
  updatedAt: '2025-06-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

function renderDetail(overrides: Partial<React.ComponentProps<typeof EventDetail>> = {}) {
  const onClose = vi.fn();
  const onDelete = vi.fn();
  const onEdit = vi.fn();

  const qc = makeQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <EventDetail
        event={sampleEvent}
        onClose={onClose}
        onDelete={onDelete}
        onEdit={onEdit}
        {...overrides}
      />
    </QueryClientProvider>
  );
  return { onClose, onDelete, onEdit };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the event title', () => {
    renderDetail();
    expect(screen.getByText('Product Review')).toBeInTheDocument();
  });

  it('renders an Edit button', () => {
    renderDetail();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });

  it('calls onEdit with the event when the Edit button is clicked', () => {
    const { onEdit } = renderDetail();
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledWith(sampleEvent);
  });

  it('renders a Delete Event button', () => {
    renderDetail();
    expect(screen.getByRole('button', { name: /delete event/i })).toBeInTheDocument();
  });

  it('calls onDelete with the event id when Delete Event is clicked', () => {
    const { onDelete } = renderDetail();
    fireEvent.click(screen.getByRole('button', { name: /delete event/i }));
    expect(onDelete).toHaveBeenCalledWith('evt-1');
  });
});

describe('a read-only event', () => {
  const holidays = {
    id: 'us', name: 'United States', color: '#8b5cf6', visible: true, readOnly: true,
    kind: 'holidays' as const, isDefault: false, source: null, country: 'US', region: null,
    includeObservances: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  };
  const holiday: EventResponse = {
    ...sampleEvent,
    id: 'holiday:us:2026-11-26:Thanksgiving Day',
    title: 'Thanksgiving Day',
    allDay: true,
    startTime: '2026-11-26T00:00:00Z',
    endTime: '2026-11-26T23:59:59Z',
    attendees: [],
    source: 'holidays',
    calendarId: 'us',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has no edit or delete in the sidebar, and names its calendar', () => {
    renderDetail({ event: holiday, calendar: holidays, readOnly: true });
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /delete event/i })).toBeNull();
    expect(screen.getByTestId('event-calendar')).toHaveTextContent('United States');
    expect(screen.getByTestId('event-calendar')).toHaveTextContent('Read-only');
  });

  it('has no edit or delete in the modal', () => {
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <EventViewModal event={holiday} calendar={holidays} readOnly onClose={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />
      </QueryClientProvider>
    );
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
  });

  it('asks the server for no reminders or attachments of a holiday, which has none stored', () => {
    renderDetail({ event: holiday, calendar: holidays, readOnly: true });
    expect(calendarApi.listReminders).not.toHaveBeenCalled();
    expect(calendarApi.listAttachments).not.toHaveBeenCalled();
  });
});
