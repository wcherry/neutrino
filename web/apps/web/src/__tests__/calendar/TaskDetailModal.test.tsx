/**
 * Tests for TaskDetailModal — the editor behind ⌘/Ctrl+Enter and a click on a
 * task's title.
 *
 * The three things it exists for each get a test, plus the two ways it can
 * quietly corrupt a task:
 *   - opening an already-scheduled task must read its event's real times, not a
 *     default slot, or Save moves an event just for having been looked at
 *   - clearing notes or the due date must send `null` rather than omitting the
 *     field, since an omitted field means "leave it alone"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import TaskDetailModal from '../../app/(apps)/calendar/TaskDetailModal';
import type { TaskResponse } from '../../lib/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const api = {
  listTaskReminders: vi.fn(() => Promise.resolve({ reminders: [] })),
  createReminder: vi.fn(() => Promise.resolve({})),
  deleteReminder: vi.fn(() => Promise.resolve()),
  listTaskAttachments: vi.fn(() => Promise.resolve({ attachments: [] })),
  createTaskAttachment: vi.fn(() => Promise.resolve({})),
  deleteTaskAttachment: vi.fn(() => Promise.resolve()),
  scheduleTask: vi.fn(() => Promise.resolve({})),
  unscheduleTask: vi.fn(() => Promise.resolve({})),
  getEvent: vi.fn(() => Promise.resolve({})),
};

vi.mock('@/lib/api', () => ({
  calendarApi: new Proxy({}, { get: (_t, k: string) => (api as Record<string, unknown>)[k] }),
  storageApi: {},
}));

vi.mock('@neutrino/ui', () => ({
  Modal: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="modal">{children}</div> : null,
  ModalHeader: ({ title, onClose }: { title: string; onClose: () => void }) => (
    <div>
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
    <button
      onClick={onClick}
      type={(type as 'button' | 'submit' | 'reset') ?? 'button'}
      form={form}
      disabled={disabled}
    >
      {children}
    </button>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<TaskResponse> = {}): TaskResponse {
  return {
    id: 'task-1',
    title: 'Clean ceiling fans',
    notes: null,
    done: false,
    dueDate: null,
    position: 0,
    listId: null,
    eventId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderModal(task: TaskResponse = makeTask()) {
  const onSave = vi.fn(async () => task);
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TaskDetailModal task={task} onClose={onClose} onSave={onSave} />
    </QueryClientProvider>
  );
  return { onSave, onClose };
}

const saveButton = () => screen.getByText('Save');

// ---------------------------------------------------------------------------

describe('TaskDetailModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listTaskReminders.mockResolvedValue({ reminders: [] } as never);
    api.listTaskAttachments.mockResolvedValue({ attachments: [] } as never);
  });

  it('opens on the task it was given', () => {
    renderModal(makeTask({ title: 'Clean ceiling fans', notes: 'Use the long duster' }));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Clean ceiling fans');
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Use the long duster');
  });

  it('offers reminders, calendar scheduling and attachments', () => {
    renderModal();
    expect(screen.getByText('Reminders')).toBeDefined();
    expect(screen.getByText('Add to calendar')).toBeDefined();
    expect(screen.getByText('Attachments')).toBeDefined();
  });

  it('hides the times until the task is actually put on the calendar', () => {
    renderModal();
    expect(screen.queryByLabelText('Start')).toBeNull();
    fireEvent.click(screen.getByLabelText('Add to calendar'));
    expect(screen.getByLabelText('Start')).toBeDefined();
  });

  it('schedules the task on save once "Add to calendar" is ticked', async () => {
    const { onSave } = renderModal();
    fireEvent.click(screen.getByLabelText('Add to calendar'));
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    await waitFor(() => expect(api.scheduleTask).toHaveBeenCalledWith('task-1', expect.anything()));
  });

  it('does not touch the calendar for a task that is not on it', async () => {
    const { onSave } = renderModal();
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(api.scheduleTask).not.toHaveBeenCalled();
    expect(api.unscheduleTask).not.toHaveBeenCalled();
  });

  it('unschedules a task when "Add to calendar" is un-ticked', async () => {
    api.getEvent.mockResolvedValue({
      id: 'event-1',
      startTime: '2026-10-01T09:00:00Z',
      endTime: '2026-10-01T10:00:00Z',
      allDay: false,
    } as never);
    renderModal(makeTask({ eventId: 'event-1' }));

    const toggle = screen.getByLabelText('Add to calendar') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.unscheduleTask).toHaveBeenCalledWith('task-1'));
    expect(api.scheduleTask).not.toHaveBeenCalled();
  });

  it('reads an already-scheduled task’s real times rather than a default slot', async () => {
    api.getEvent.mockResolvedValue({
      id: 'event-1',
      startTime: '2026-10-01T09:00:00Z',
      endTime: '2026-10-01T10:30:00Z',
      allDay: true,
    } as never);
    renderModal(makeTask({ eventId: 'event-1' }));

    await waitFor(() =>
      expect((screen.getByLabelText('Start') as HTMLInputElement).value).toBe('2026-10-01')
    );
    expect((screen.getByLabelText('End') as HTMLInputElement).value).toBe('2026-10-01');
    expect((screen.getByLabelText('All day') as HTMLInputElement).checked).toBe(true);
  });

  it('adds a reminder against the task, not loose in the sidebar', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Remind me at'), {
      target: { value: '2026-10-01T08:00' },
    });
    fireEvent.click(screen.getByText('Add'));

    await waitFor(() =>
      expect(api.createReminder).toHaveBeenCalledWith(
        expect.objectContaining({ linkedTaskId: 'task-1', title: 'Clean ceiling fans' })
      )
    );
  });

  it('lists the reminders already on the task, with a way to remove one', async () => {
    api.listTaskReminders.mockResolvedValue({
      reminders: [
        {
          id: 'rem-1',
          title: 'Clean ceiling fans',
          dueTime: '2026-10-01T08:00:00Z',
          completed: false,
          recurrenceRule: null,
          linkedEventId: null,
          linkedTaskId: 'task-1',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    } as never);
    renderModal();

    const remove = await screen.findByLabelText('Remove reminder');
    fireEvent.click(remove);
    await waitFor(() => expect(api.deleteReminder).toHaveBeenCalledWith('rem-1'));
  });

  it('lists the task’s attachments', async () => {
    api.listTaskAttachments.mockResolvedValue({
      attachments: [
        { id: 'att-1', taskId: 'task-1', fileId: null, name: null, note: 'Buy a longer duster' },
      ],
    } as never);
    renderModal();
    expect(await screen.findByText('Buy a longer duster')).toBeDefined();
  });

  it('clears notes and the due date with null rather than by omitting them', async () => {
    const { onSave } = renderModal(
      makeTask({ notes: 'Use the long duster', dueDate: '2026-10-01T00:00:00Z' })
    );

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ notes: null, dueDate: null })
    );
  });

  it('refuses to save a task with no title', async () => {
    const { onSave, onClose } = renderModal();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '   ' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText(/needs a title/)).toBeDefined());
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reads a friendly due date and sends it as the instant it names', async () => {
    const { onSave } = renderModal();
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: 'oct 3 2026 5pm' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        dueDate: new Date(2026, 9, 3, 17, 0).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        dueHasTime: true,
      })
    );
  });

  it('refuses to save a due date it cannot read', async () => {
    const { onSave } = renderModal();
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: 'whenever' } });
    expect(screen.getByText("Couldn't read that")).toBeDefined();
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText(/Couldn't read the due date/)).toBeDefined());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps a stored due date that was never edited, even though its display does not parse', async () => {
    const { onSave } = renderModal(makeTask({ dueDate: '2026-10-01T00:00:00Z' }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ dueDate: '2026-10-01T00:00:00Z', dueHasTime: false })
    );
  });

  it('saves repeat, estimate, priority, tags and location from their own fields', async () => {
    const { onSave } = renderModal();
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'after 2 weeks' } });
    fireEvent.change(screen.getByLabelText('Estimate'), { target: { value: '1h30m' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: '#Home, garden #home' } });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Shed' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        recurrenceRule: 'FREQ=WEEKLY;INTERVAL=2',
        repeatAfterCompletion: true,
        estimateMinutes: 90,
        priority: 2,
        tags: ['home', 'garden'],
        location: 'Shed',
      })
    );
  });

  it('opens with the stored repeat described in words that read back', () => {
    renderModal(makeTask({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,TH' }));
    expect((screen.getByLabelText('Repeat') as HTMLInputElement).value).toBe('every Mon, Thu');
  });
});
