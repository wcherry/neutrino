/**
 * Tests for NewEventModal in both create and edit modes.
 *
 * Create mode:
 *   - Renders "New Event" title and "Create Event" submit button
 *   - Shows reminders section
 *   - Calls onCreate with the form values on submit
 *   - Pre-populates fields from the `prefill` (ICS) prop when provided
 *
 * Edit mode (existingEvent prop present):
 *   - Renders "Edit Event" title and "Save Changes" submit button
 *   - Hides the reminders section
 *   - Pre-populates all fields from the existing event (title, location,
 *     description, attendees, start/end, allDay)
 *   - Calls onUpdate (not onCreate) on submit
 *   - Does not call onCreate when saving in edit mode
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import NewEventModal from '../../app/(apps)/calendar/NewEventModal';
import type { EventResponse } from '../../app/(apps)/calendar/../../../lib/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// The modal reads and mutates event attachments through react-query.
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
  ModalHeader: ({ title, onClose }: { title: string; onClose: () => void }) => (
    <div data-testid="modal-header">
      <span data-testid="modal-title">{title}</span>
      <button onClick={onClose}>close</button>
    </div>
  ),
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const defaultDate = new Date('2025-06-15T10:00:00.000Z');

const existingEvent: EventResponse = {
  id: 'evt-1',
  title: 'Team Standup',
  description: 'Daily sync meeting',
  startTime: '2025-06-15T09:00:00.000Z',
  endTime: '2025-06-15T09:30:00.000Z',
  allDay: false,
  location: 'Zoom',
  recurrenceRule: null,
  attendees: ['alice@example.com', 'bob@example.com'],
  source: 'local',
  createdAt: '2025-06-01T00:00:00.000Z',
  updatedAt: '2025-06-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** The modal calls `useQueryClient`, so it must render under a provider. */
function renderWithClient(ui: React.ReactElement) {
  return render(<QueryClientProvider client={makeQueryClient()}>{ui}</QueryClientProvider>);
}

function renderCreateModal(overrides: Partial<Parameters<typeof NewEventModal>[0]> = {}) {
  const onCreate = vi.fn();
  const onClose = vi.fn();
  const { container } = renderWithClient(
    <NewEventModal
      defaultDate={defaultDate}
      onClose={onClose}
      onCreate={onCreate}
      isPending={false}
      {...overrides}
    />
  );
  return { onCreate, onClose, container };
}

/**
 * The Start and End labels are not associated with their inputs, so the date
 * fields are addressed by type and order — Start first, End second.
 */
function dateFields(container: HTMLElement) {
  const inputs = container.querySelectorAll<HTMLInputElement>(
    'input[type="datetime-local"], input[type="date"]'
  );
  return { start: inputs[0], end: inputs[1] };
}

function renderEditModal(overrides: Partial<Parameters<typeof NewEventModal>[0]> = {}) {
  const onUpdate = vi.fn();
  const onCreate = vi.fn();
  const onClose = vi.fn();
  const { container } = renderWithClient(
    <NewEventModal
      defaultDate={defaultDate}
      existingEvent={existingEvent}
      onClose={onClose}
      onCreate={onCreate}
      onUpdate={onUpdate}
      isPending={false}
      {...overrides}
    />
  );
  return { onUpdate, onCreate, onClose, container };
}

// ---------------------------------------------------------------------------
// Tests — Create mode
// ---------------------------------------------------------------------------

describe('NewEventModal – create mode', () => {
  it('renders "New Event" as the modal title', () => {
    renderCreateModal();
    expect(screen.getByTestId('modal-title')).toHaveTextContent('New Event');
  });

  it('renders "Create Event" on the submit button', () => {
    renderCreateModal();
    expect(screen.getByRole('button', { name: /create event/i })).toBeInTheDocument();
  });

  it('shows the reminders section', () => {
    renderCreateModal();
    expect(screen.getByText(/reminders/i)).toBeInTheDocument();
  });

  it('calls onCreate with the entered values on submit', async () => {
    const { onCreate } = renderCreateModal();

    fireEvent.change(screen.getByPlaceholderText('Event title'), { target: { value: 'My Meeting' } });
    fireEvent.click(screen.getByRole('button', { name: /create event/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledOnce();
      const [req] = onCreate.mock.calls[0];
      expect(req.title).toBe('My Meeting');
    });
  });

  it('does not call onCreate when title is empty', async () => {
    const { onCreate } = renderCreateModal();
    fireEvent.click(screen.getByRole('button', { name: /create event/i }));
    await waitFor(() => {
      expect(onCreate).not.toHaveBeenCalled();
    });
  });

  it('pre-populates fields from the prefill (ICS) prop', () => {
    renderCreateModal({
      prefill: {
        title: 'ICS Event',
        location: 'Conference Room A',
        description: 'Imported from ICS',
        attendees: ['carol@example.com'],
      },
    });
    expect(screen.getByDisplayValue('ICS Event')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Conference Room A')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Imported from ICS')).toBeInTheDocument();
    expect(screen.getByText('carol@example.com')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — Edit mode
// ---------------------------------------------------------------------------

describe('NewEventModal – edit mode', () => {
  it('renders "Edit Event" as the modal title', () => {
    renderEditModal();
    expect(screen.getByTestId('modal-title')).toHaveTextContent('Edit Event');
  });

  it('renders "Save Changes" on the submit button', () => {
    renderEditModal();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });

  it('does not render "Create Event" on the submit button', () => {
    renderEditModal();
    expect(screen.queryByRole('button', { name: /create event/i })).not.toBeInTheDocument();
  });

  it('hides the reminders section', () => {
    renderEditModal();
    expect(screen.queryByText(/reminders/i)).not.toBeInTheDocument();
  });

  it('pre-populates the title field from the existing event', () => {
    renderEditModal();
    expect(screen.getByDisplayValue('Team Standup')).toBeInTheDocument();
  });

  it('pre-populates the location field from the existing event', () => {
    renderEditModal();
    expect(screen.getByDisplayValue('Zoom')).toBeInTheDocument();
  });

  it('pre-populates the description field from the existing event', () => {
    renderEditModal();
    expect(screen.getByDisplayValue('Daily sync meeting')).toBeInTheDocument();
  });

  it('pre-populates the attendees list from the existing event', () => {
    renderEditModal();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('calls onUpdate (not onCreate) when the form is submitted', async () => {
    const { onUpdate, onCreate } = renderEditModal();

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledOnce();
      expect(onCreate).not.toHaveBeenCalled();
    });
  });

  it('passes updated title to onUpdate when title is changed before save', async () => {
    const { onUpdate } = renderEditModal();

    const titleInput = screen.getByDisplayValue('Team Standup');
    fireEvent.change(titleInput, { target: { value: 'Updated Standup' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const [req] = onUpdate.mock.calls[0];
      expect(req.title).toBe('Updated Standup');
    });
  });

  it('passes the event id to onUpdate', async () => {
    const { onUpdate } = renderEditModal();

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const [, id] = onUpdate.mock.calls[0];
      expect(id).toBe('evt-1');
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — start/end coupling (issue #129)
// ---------------------------------------------------------------------------

describe('NewEventModal – moving the start moves the end', () => {
  it('pushes the end out by the same gap when the start is moved forward', () => {
    const { container } = renderCreateModal();
    const { start, end } = dateFields(container);

    fireEvent.change(start, { target: { value: '2026-03-12T09:00' } });
    fireEvent.change(end, { target: { value: '2026-03-14T09:00' } });
    fireEvent.change(start, { target: { value: '2026-03-15T09:00' } });

    expect(end.value).toBe('2026-03-17T09:00');
  });

  it('pulls the end back by the same gap when the start is moved backward', () => {
    const { container } = renderCreateModal();
    const { start, end } = dateFields(container);

    fireEvent.change(start, { target: { value: '2026-03-15T09:00' } });
    fireEvent.change(end, { target: { value: '2026-03-17T09:00' } });
    fireEvent.change(start, { target: { value: '2026-03-12T09:00' } });

    expect(end.value).toBe('2026-03-14T09:00');
  });

  it('keeps a sub-day duration when only the time is changed', () => {
    const { container } = renderCreateModal();
    const { start, end } = dateFields(container);

    fireEvent.change(start, { target: { value: '2026-03-12T09:00' } });
    fireEvent.change(end, { target: { value: '2026-03-12T10:00' } });
    fireEvent.change(start, { target: { value: '2026-03-12T14:00' } });

    expect(end.value).toBe('2026-03-12T15:00');
  });

  it('leaves the start alone when only the end is edited', () => {
    const { container } = renderCreateModal();
    const { start, end } = dateFields(container);

    fireEvent.change(start, { target: { value: '2026-03-12T09:00' } });
    fireEvent.change(end, { target: { value: '2026-03-20T09:00' } });

    expect(start.value).toBe('2026-03-12T09:00');
    expect(end.value).toBe('2026-03-20T09:00');
  });

  it('submits the shifted end, so the saved event does not end before it starts', async () => {
    const { container, onUpdate } = renderEditModal();
    const { start, end } = dateFields(container);

    fireEvent.change(start, { target: { value: '2026-03-12T09:00' } });
    fireEvent.change(end, { target: { value: '2026-03-14T09:00' } });
    fireEvent.change(start, { target: { value: '2026-03-15T09:00' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const [req] = onUpdate.mock.calls[0];
      expect(new Date(req.endTime).getTime()).toBeGreaterThan(new Date(req.startTime).getTime());
    });
  });
});
