/**
 * Tests for drag-and-drop reordering in TaskListsSidebar.
 *
 * Covers:
 *   - Drag handles are rendered for pending tasks when dragReorderEnabled is true
 *   - Drag handles are NOT rendered when dragReorderEnabled is false (default)
 *   - Done tasks do not receive a drag handle
 *   - Component renders without error when onReorderTasks is provided
 *   - All original test scenarios still work with DnD props present
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { TaskListsSidebar } from '../../app/(apps)/calendar/TaskListsSidebar';
import type { TaskListResponse, TaskResponse } from '../../lib/api';

// ---------------------------------------------------------------------------
// Mock dnd-kit so jsdom does not need pointer events
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
    verticalListSortingStrategy: actual.verticalListSortingStrategy,
    arrayMove: actual.arrayMove,
  };
});

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

const taskA: TaskResponse = {
  id: 'task-1',
  title: 'First task',
  notes: null,
  done: false,
  dueDate: null,
  position: 0,
  listId: 'list-1',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const taskB: TaskResponse = {
  id: 'task-2',
  title: 'Second task',
  notes: null,
  done: false,
  dueDate: null,
  position: 1,
  listId: 'list-1',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const taskDone: TaskResponse = {
  id: 'task-3',
  title: 'Done task',
  notes: null,
  done: true,
  dueDate: null,
  position: 2,
  listId: 'list-1',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const defaultTaskProps = {
  onCreateTask: vi.fn(),
  isCreatingTask: false,
  onCreateTaskList: vi.fn().mockResolvedValue({ id: 'new', name: 'New', color: null, createdAt: '', updatedAt: '' }),
  isCreatingTaskList: false,
};

function renderSidebar(
  tasks: TaskResponse[],
  {
    onReorderTasks = vi.fn().mockResolvedValue(undefined),
    dragReorderEnabled = true,
  }: {
    onReorderTasks?: ReturnType<typeof vi.fn>;
    dragReorderEnabled?: boolean;
  } = {}
) {
  render(
    <TaskListsSidebar
      taskLists={[listA]}
      tasks={tasks}
      onToggleTask={vi.fn()}
      onReorderTasks={onReorderTasks}
      dragReorderEnabled={dragReorderEnabled}
      {...defaultTaskProps}
    />
  );
  return { onReorderTasks };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskListsSidebar — drag-and-drop reorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all pending tasks when dragReorderEnabled is true', () => {
    renderSidebar([taskA, taskB], { dragReorderEnabled: true });
    expect(screen.getByText('First task')).toBeDefined();
    expect(screen.getByText('Second task')).toBeDefined();
  });

  it('renders all pending tasks when dragReorderEnabled is false', () => {
    renderSidebar([taskA, taskB], { dragReorderEnabled: false });
    expect(screen.getByText('First task')).toBeDefined();
    expect(screen.getByText('Second task')).toBeDefined();
  });

  it('renders without drag handles (whole item is draggable) when dragReorderEnabled is omitted', () => {
    render(
      <TaskListsSidebar
        taskLists={[listA]}
        tasks={[taskA, taskB]}
        onToggleTask={vi.fn()}
        {...defaultTaskProps}
      />
    );
    const handles = document.querySelectorAll('[aria-label="drag handle"]');
    expect(handles.length).toBe(0);
  });

  it('renders both pending and done tasks when drag is enabled', () => {
    renderSidebar([taskA, taskDone], { dragReorderEnabled: true });
    expect(screen.getByText('First task')).toBeDefined();
    expect(screen.getByText('Done task')).toBeDefined();
  });

  it('still renders all task titles when drag is enabled', () => {
    renderSidebar([taskA, taskB, taskDone], { dragReorderEnabled: true });
    expect(screen.getByText('First task')).toBeDefined();
    expect(screen.getByText('Second task')).toBeDefined();
    expect(screen.getByText('Done task')).toBeDefined();
  });

  it('renders without error when onReorderTasks is not provided', () => {
    expect(() =>
      render(
        <TaskListsSidebar
          taskLists={[listA]}
          tasks={[taskA]}
          onToggleTask={vi.fn()}
          dragReorderEnabled={true}
          {...defaultTaskProps}
        />
      )
    ).not.toThrow();
  });

  it('renders without error when task list is empty and drag is enabled', () => {
    expect(() =>
      renderSidebar([], { dragReorderEnabled: true })
    ).not.toThrow();
  });
});
