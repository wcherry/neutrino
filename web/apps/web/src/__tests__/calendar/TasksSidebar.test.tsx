/**
 * Tests for TasksSidebar — the calendar sidebar's tasks panel.
 *
 * What is pinned down here is the panel's whole contract after the list
 * dropdown was removed:
 *   - there is no list selector, and every task is shown as one flat sequence
 *   - the composer is always visible; Enter adds a task and clears the box
 *   - ⌘/Ctrl+Enter adds the task *and* opens it for editing
 *   - a failed create keeps what was typed rather than throwing it away
 *   - clicking a task's title opens it
 *   - drag reorder still renders, and reorders without a list id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { TasksSidebar } from '../../app/(apps)/calendar/TasksSidebar';
import type { TaskResponse } from '../../lib/api';

// ---------------------------------------------------------------------------
// Mocks — dnd-kit needs pointer events jsdom does not have.
// ---------------------------------------------------------------------------

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('@dnd-kit/sortable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/sortable')>();
  return {
    ...actual,
    SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: null,
      isDragging: false,
    }),
  };
});

vi.mock('../../lib/api', () => ({
  calendarApi: {},
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function task(overrides: Partial<TaskResponse> & { id: string; title: string }): TaskResponse {
  return {
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

const pending = task({ id: 'task-1', title: 'Clean ceiling fans' });
const done = task({ id: 'task-2', title: 'Pay rent', done: true, position: 1 });

function renderSidebar(
  tasks: TaskResponse[] = [pending],
  overrides: Partial<React.ComponentProps<typeof TasksSidebar>> = {}
) {
  const props = {
    tasks,
    onToggleTask: vi.fn(),
    onCreateTask: vi.fn(async (req: { title: string }) =>
      task({ id: 'created', title: req.title })
    ),
    isCreatingTask: false,
    onOpenTask: vi.fn(),
    onReorderTasks: vi.fn().mockResolvedValue(undefined),
    dragReorderEnabled: true,
    ...overrides,
  };
  render(<TasksSidebar {...props} />);
  return props;
}

const composer = () => screen.getByLabelText('Add a task') as HTMLInputElement;

// ---------------------------------------------------------------------------

describe('TasksSidebar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has no list selector at all', () => {
    renderSidebar([pending]);
    expect(screen.queryByText('Select a list…')).toBeNull();
    expect(screen.queryByPlaceholderText('Search or type a new name…')).toBeNull();
  });

  it('shows every task regardless of which list it came from', () => {
    renderSidebar([
      task({ id: 'a', title: 'From a list', listId: 'list-1' }),
      task({ id: 'b', title: 'From no list' }),
    ]);
    expect(screen.getByText('From a list')).toBeDefined();
    expect(screen.getByText('From no list')).toBeDefined();
  });

  it('renders the composer without anything being clicked first', () => {
    renderSidebar([]);
    expect(composer()).toBeDefined();
    expect(composer().placeholder).toBe('Add a task…');
  });

  it('adds a task on Enter and clears the box', async () => {
    const { onCreateTask, onOpenTask } = renderSidebar([]);
    fireEvent.change(composer(), { target: { value: '  Clean ceiling fans  ' } });
    fireEvent.keyDown(composer(), { key: 'Enter' });

    await waitFor(() => expect(onCreateTask).toHaveBeenCalledWith({ title: 'Clean ceiling fans' }));
    await waitFor(() => expect(composer().value).toBe(''));
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it('does nothing on Enter when the box holds only whitespace', () => {
    const { onCreateTask } = renderSidebar([]);
    fireEvent.change(composer(), { target: { value: '   ' } });
    fireEvent.keyDown(composer(), { key: 'Enter' });
    expect(onCreateTask).not.toHaveBeenCalled();
  });

  it('adds the task and opens it on Ctrl+Enter', async () => {
    const { onCreateTask, onOpenTask } = renderSidebar([]);
    fireEvent.change(composer(), { target: { value: 'Book the dentist' } });
    fireEvent.keyDown(composer(), { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(onCreateTask).toHaveBeenCalledWith({ title: 'Book the dentist' }));
    await waitFor(() =>
      expect(onOpenTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'created', title: 'Book the dentist' })
      )
    );
  });

  it('adds the task and opens it on Cmd+Enter', async () => {
    const { onOpenTask } = renderSidebar([]);
    fireEvent.change(composer(), { target: { value: 'Book the dentist' } });
    fireEvent.keyDown(composer(), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(onOpenTask).toHaveBeenCalled());
  });

  it('keeps what was typed when the create fails', async () => {
    const { onCreateTask } = renderSidebar([], {
      onCreateTask: vi.fn().mockRejectedValue(new Error('offline')),
    });
    fireEvent.change(composer(), { target: { value: 'Clean ceiling fans' } });
    fireEvent.keyDown(composer(), { key: 'Enter' });

    await waitFor(() => expect(onCreateTask).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/Could not add that task/)).toBeDefined());
    expect(composer().value).toBe('Clean ceiling fans');
  });

  it('will not fire a second create while one is in flight', () => {
    const { onCreateTask } = renderSidebar([], { isCreatingTask: true });
    expect(composer().disabled).toBe(true);
    fireEvent.keyDown(composer(), { key: 'Enter' });
    expect(onCreateTask).not.toHaveBeenCalled();
  });

  it('opens a task when its title is clicked', () => {
    const { onOpenTask } = renderSidebar([pending]);
    fireEvent.click(screen.getByText('Clean ceiling fans'));
    expect(onOpenTask).toHaveBeenCalledWith(pending);
  });

  it('toggles a task from its checkbox', () => {
    const { onToggleTask } = renderSidebar([pending]);
    fireEvent.click(screen.getByLabelText('Clean ceiling fans'));
    expect(onToggleTask).toHaveBeenCalledWith('task-1', true);
  });

  it('shows completed tasks struck through, below the pending ones', () => {
    renderSidebar([pending, done]);
    const completed = screen.getByText('Pay rent');
    expect(completed.className).toContain('taskDone');
  });

  it('marks a scheduled task so the calendar link is visible from the list', () => {
    renderSidebar([task({ id: 'a', title: 'Scheduled', eventId: 'event-1' })]);
    expect(screen.getByLabelText('On the calendar')).toBeDefined();
  });

  it('shows an empty state rather than a bare panel', () => {
    renderSidebar([]);
    expect(screen.getByText(/No tasks/)).toBeDefined();
  });

  it('renders the same tasks with drag reorder off', () => {
    renderSidebar([pending, done], { dragReorderEnabled: false });
    expect(screen.getByText('Clean ceiling fans')).toBeDefined();
    expect(screen.getByText('Pay rent')).toBeDefined();
  });

  it('renders without error when no reorder handler is supplied', () => {
    expect(() => renderSidebar([pending], { onReorderTasks: undefined })).not.toThrow();
  });
});
