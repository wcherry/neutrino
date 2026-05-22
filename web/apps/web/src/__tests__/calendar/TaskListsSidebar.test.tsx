/**
 * Tests for TaskListsSidebar component.
 *
 * Covers:
 *   - Renders the "Tasks" section heading
 *   - Selected list name appears in the dropdown button
 *   - Tasks for the auto-selected list are rendered
 *   - Completed tasks have line-through styling
 *   - Clicking a task checkbox calls onToggleTask with correct args
 *   - Empty task lists shows create-list prompt
 *   - A list with no tasks shows empty state message
 *   - A list with a color value renders with that color as an accent
 *   - Typing a new name in the dropdown shows the Create option
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { TaskListsSidebar } from '../../app/(apps)/calendar/TaskListsSidebar';
import type { TaskListResponse, TaskResponse } from '../../lib/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../lib/api', () => ({
  calendarApi: {},
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const listA: TaskListResponse = {
  id: 'list-1',
  name: 'Work',
  color: '#2563eb',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const listB: TaskListResponse = {
  id: 'list-2',
  name: 'Personal',
  color: null,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const taskPending: TaskResponse = {
  id: 'task-1',
  title: 'Write tests',
  notes: null,
  done: false,
  dueDate: null,
  position: 0,
  listId: 'list-1',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const taskDone: TaskResponse = {
  id: 'task-2',
  title: 'Deploy to staging',
  notes: null,
  done: true,
  dueDate: null,
  position: 1,
  listId: 'list-1',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const taskInListB: TaskResponse = {
  id: 'task-3',
  title: 'Buy groceries',
  notes: null,
  done: false,
  dueDate: null,
  position: 0,
  listId: 'list-2',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderSidebar(
  taskLists: TaskListResponse[],
  tasks: TaskResponse[],
  onToggleTask = vi.fn(),
  onCreateTaskList = vi.fn().mockResolvedValue({ id: 'new-list', name: 'New', color: null, createdAt: '', updatedAt: '' })
) {
  render(
    <TaskListsSidebar
      taskLists={taskLists}
      tasks={tasks}
      onToggleTask={onToggleTask}
      onCreateTask={vi.fn()}
      isCreatingTask={false}
      onCreateTaskList={vi.fn().mockResolvedValue({ id: 'new-list', name: 'New', color: null, createdAt: '', updatedAt: '' })}
      isCreatingTaskList={false}
    />
  );
  return { onToggleTask, onCreateTaskList };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskListsSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the "Tasks" section heading', () => {
    renderSidebar([listA], [taskPending]);
    expect(screen.getByText('Tasks')).toBeDefined();
  });

  it('auto-selects the first list and shows its name in the dropdown button', () => {
    renderSidebar([listA, listB], [taskPending, taskInListB]);
    expect(screen.getByText('Work')).toBeDefined();
  });

  it('renders tasks for the auto-selected (first) list', () => {
    renderSidebar([listA, listB], [taskPending, taskInListB]);
    expect(screen.getByText('Write tests')).toBeDefined();
    // listB tasks should not be visible until user selects listB
    expect(screen.queryByText('Buy groceries')).toBeNull();
  });

  it('does not show tasks from non-selected lists', () => {
    renderSidebar([listA, listB], [taskPending, taskInListB]);
    expect(screen.queryByText('Buy groceries')).toBeNull();
  });

  it('applies the done class to a completed task title', () => {
    renderSidebar([listA], [taskPending, taskDone]);
    const doneTitle = screen.getByText('Deploy to staging');
    expect(doneTitle.style.textDecoration).toBe('line-through');
  });

  it('calls onToggleTask with id and true when a pending task checkbox is clicked', () => {
    const { onToggleTask } = renderSidebar([listA], [taskPending]);
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(onToggleTask).toHaveBeenCalledOnce();
    expect(onToggleTask).toHaveBeenCalledWith('task-1', true);
  });

  it('calls onToggleTask with id and false when a done task checkbox is clicked', () => {
    const { onToggleTask } = renderSidebar([listA], [taskDone]);
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(onToggleTask).toHaveBeenCalledOnce();
    expect(onToggleTask).toHaveBeenCalledWith('task-2', false);
  });

  it('shows a create-list prompt when the taskLists array is empty', () => {
    renderSidebar([], []);
    expect(screen.getByText('Open the dropdown to create your first list')).toBeDefined();
  });

  it('renders empty state when a list has no tasks', () => {
    renderSidebar([listA], []);
    expect(screen.getByText('No tasks — click + to add one')).toBeDefined();
  });

  it('renders a color accent element for a list that has a color', () => {
    renderSidebar([listA], [taskPending]);
    // jsdom normalises #2563eb → rgb(37, 99, 235)
    const colorEl = document.querySelector('[style*="rgb(37, 99, 235)"]');
    expect(colorEl).not.toBeNull();
  });

  it('shows a Create option in the dropdown when a novel name is typed', () => {
    renderSidebar([listA], []);
    // open dropdown
    fireEvent.click(screen.getByText('Work'));
    const input = screen.getByPlaceholderText(/search or type/i);
    fireEvent.change(input, { target: { value: 'Hobbies' } });
    expect(screen.getByText(/create "Hobbies"/i)).toBeDefined();
  });

  it('does not show a Create option when the typed name matches an existing list exactly', () => {
    renderSidebar([listA], []);
    fireEvent.click(screen.getByText('Work'));
    const input = screen.getByPlaceholderText(/search or type/i);
    fireEvent.change(input, { target: { value: 'Work' } });
    expect(screen.queryByText(/create "Work"/i)).toBeNull();
  });
});
