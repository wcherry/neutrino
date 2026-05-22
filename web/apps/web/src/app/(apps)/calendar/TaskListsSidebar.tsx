'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, Plus } from 'lucide-react';
import type {
  TaskListResponse,
  TaskResponse,
  CreateTaskRequest,
  CreateTaskListRequest,
} from '@/lib/api';
import styles from './page.module.css';

interface TaskListsSidebarProps {
  taskLists: TaskListResponse[];
  tasks: TaskResponse[];
  onToggleTask: (id: string, done: boolean) => void;
  onCreateTask: (req: CreateTaskRequest, listId: string) => void;
  isCreatingTask: boolean;
  onCreateTaskList: (req: CreateTaskListRequest) => Promise<TaskListResponse>;
  isCreatingTaskList: boolean;
  onReorderTasks?: (listId: string, orderedTaskIds: string[]) => Promise<void>;
  dragReorderEnabled?: boolean;
}

export function TaskListsSidebar({
  taskLists,
  tasks,
  onToggleTask,
  onCreateTask,
  isCreatingTask,
  onCreateTaskList,
  isCreatingTaskList,
  onReorderTasks,
  dragReorderEnabled = false,
}: TaskListsSidebarProps) {
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [createError, setCreateError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectedListId === null && taskLists.length > 0) {
      setSelectedListId(taskLists[0].id);
    }
  }, [taskLists, selectedListId]);

  useEffect(() => {
    if (!dropdownOpen) return;
    function onOutsideClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, [dropdownOpen]);

  useEffect(() => {
    if (dropdownOpen) filterInputRef.current?.focus();
  }, [dropdownOpen]);

  function closeDropdown() {
    setDropdownOpen(false);
    setFilterText('');
    setCreateError('');
  }

  function selectList(id: string) {
    setSelectedListId(id);
    setAddingTask(false);
    setUploadError('');
    closeDropdown();
  }

  const trimmedFilter = filterText.trim();
  const isValidName = trimmedFilter.length > 0 && trimmedFilter.length <= 100;
  const filteredLists = taskLists.filter((l) =>
    l.name.toLowerCase().includes(trimmedFilter.toLowerCase())
  );
  const exactMatch = taskLists.some(
    (l) => l.name.toLowerCase() === trimmedFilter.toLowerCase()
  );
  const showCreateOption = isValidName && !exactMatch;

  async function handleCreateList() {
    if (!isValidName) return;
    setCreateError('');
    try {
      const newList = await onCreateTaskList({ name: trimmedFilter });
      setSelectedListId(newList.id);
      closeDropdown();
    } catch {
      setCreateError('Failed to create list. Please try again.');
    }
  }

  function handleFilterKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') closeDropdown();
    if (e.key === 'Enter' && showCreateOption) handleCreateList();
  }

  function handleAddClick(e: React.MouseEvent) {
    if (!selectedListId) return;
    if (e.shiftKey) {
      setUploadError('');
      fileInputRef.current?.click();
    } else {
      setAddingTask((v) => !v);
      setUploadError('');
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedListId) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const titles = parseUploadedFile(file.name, text);
      if (titles === null) {
        setUploadError(
          'Could not parse file. Use one task per line (.txt) or a CSV with a "title" column.'
        );
        return;
      }
      if (titles.length === 0) {
        setUploadError('No tasks found in file.');
        return;
      }
      titles.forEach((title) => onCreateTask({ title }, selectedListId));
    };
    reader.readAsText(file);
  }

  const selectedList = taskLists.find((l) => l.id === selectedListId) ?? null;
  const listTasks = tasks.filter((t) => t.listId === selectedListId);
  const pendingTasks = listTasks.filter((t) => !t.done);
  const doneTasks = listTasks.filter((t) => t.done);

  return (
    <div className={styles.taskListsSection}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.csv"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <hr className={styles.taskListsDivider} />
      <div className={styles.sidebarHeading}>
        <span className={styles.sidebarTitle}>Tasks</span>
        <button
          className={styles.reminderNewBtn}
          title={selectedListId ? 'Add task (Shift+click to bulk upload)' : 'Select a list first'}
          disabled={!selectedListId}
          onClick={handleAddClick}
        >
          <Plus size={14} />
        </button>
      </div>

      <div className={styles.taskListSelector} ref={dropdownRef}>
        <button
          className={styles.taskListSelectorBtn}
          onClick={() => setDropdownOpen((v) => !v)}
        >
          {selectedList ? (
            <>
              {selectedList.color && (
                <span
                  className={styles.taskListColorDot}
                  style={{ background: selectedList.color }}
                />
              )}
              <span className={styles.taskListSelectorName}>{selectedList.name}</span>
            </>
          ) : (
            <span className={styles.taskListSelectorPlaceholder}>
              {taskLists.length === 0 ? 'No lists — create one below' : 'Select a list…'}
            </span>
          )}
          <ChevronDown size={12} className={styles.taskListSelectorChevron} />
        </button>

        {dropdownOpen && (
          <div className={styles.taskListDropdown}>
            <input
              ref={filterInputRef}
              className={styles.taskListDropdownInput}
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
                setCreateError('');
              }}
              onKeyDown={handleFilterKeyDown}
              placeholder="Search or type a new name…"
              maxLength={100}
            />
            <div className={styles.taskListDropdownList}>
              {filteredLists.map((list) => (
                <button
                  key={list.id}
                  className={
                    list.id === selectedListId
                      ? `${styles.taskListDropdownItem} ${styles.taskListDropdownItemActive}`
                      : styles.taskListDropdownItem
                  }
                  onClick={() => selectList(list.id)}
                >
                  {list.color && (
                    <span
                      className={styles.taskListColorDot}
                      style={{ background: list.color }}
                    />
                  )}
                  {list.name}
                </button>
              ))}
              {filteredLists.length === 0 && !showCreateOption && (
                <div className={styles.taskListDropdownEmpty}>No lists match</div>
              )}
              {showCreateOption && (
                <>
                  {filteredLists.length > 0 && (
                    <div className={styles.taskListDropdownDivider} />
                  )}
                  <button
                    className={styles.taskListDropdownCreate}
                    onClick={handleCreateList}
                    disabled={isCreatingTaskList}
                  >
                    {isCreatingTaskList ? 'Creating…' : `Create "${trimmedFilter}"`}
                  </button>
                </>
              )}
              {createError && (
                <div className={styles.taskUploadError}>{createError}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {uploadError && <div className={styles.taskUploadError}>{uploadError}</div>}

      {addingTask && selectedListId && (
        <AddTaskForm
          isPending={isCreatingTask}
          onSave={(title) => {
            onCreateTask({ title }, selectedListId);
            setAddingTask(false);
          }}
          onCancel={() => setAddingTask(false)}
        />
      )}

      {selectedListId ? (
        <>
          {listTasks.length === 0 && !addingTask && (
            <div className={styles.taskListEmpty}>No tasks — click + to add one</div>
          )}
          {dragReorderEnabled ? (
            <DraggablePendingList
              listId={selectedListId}
              pendingTasks={pendingTasks}
              onToggle={onToggleTask}
              onReorderTasks={onReorderTasks}
            />
          ) : (
            pendingTasks.map((task) => (
              <TaskItem key={task.id} task={task} onToggle={onToggleTask} />
            ))
          )}
          {doneTasks.length > 0 && (
            <div style={{ opacity: 0.55 }}>
              {doneTasks.map((task) => (
                <TaskItem key={task.id} task={task} onToggle={onToggleTask} />
              ))}
            </div>
          )}
        </>
      ) : (
        taskLists.length === 0 && !dropdownOpen && (
          <div className={styles.noItems}>Open the dropdown to create your first list</div>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draggable pending-tasks list
// ---------------------------------------------------------------------------

interface DraggablePendingListProps {
  listId: string;
  pendingTasks: TaskResponse[];
  onToggle: (id: string, done: boolean) => void;
  onReorderTasks?: (listId: string, orderedTaskIds: string[]) => Promise<void>;
}

function DraggablePendingList({
  listId,
  pendingTasks,
  onToggle,
  onReorderTasks,
}: DraggablePendingListProps) {
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // Reset when the user switches to a different list.
  useEffect(() => {
    setLocalOrder(null);
  }, [listId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const orderedTasks: TaskResponse[] = localOrder
    ? localOrder
        .map((id) => pendingTasks.find((t) => t.id === id))
        .filter((t): t is TaskResponse => t !== undefined)
    : pendingTasks;

  // Keep a ref so the event handlers always read the latest ordered list,
  // regardless of which render's closure dnd-kit captured.
  const orderedTasksRef = useRef(orderedTasks);
  orderedTasksRef.current = orderedTasks;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = orderedTasksRef.current.map((t) => t.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const newIds = arrayMove(ids, oldIndex, newIndex);
    setLocalOrder(newIds);
    // Don't reset on failure — keep the optimistic order; the next refetch
    // will reconcile with the server.
    onReorderTasks?.(listId, newIds);
  }, [listId, onReorderTasks]);

  const activeDragTask = activeDragId
    ? orderedTasks.find((t) => t.id === activeDragId) ?? null
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={orderedTasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        {orderedTasks.map((task) => (
          <SortableTaskItem
            key={task.id}
            task={task}
            onToggle={onToggle}
            isDragging={task.id === activeDragId}
          />
        ))}
      </SortableContext>
      <DragOverlay>
        {activeDragTask ? (
          <div className={`${styles.taskItem} ${styles.taskItemDragOverlay}`}>
            <input type="checkbox" className={styles.taskCheckbox} checked={false} readOnly />
            <span className={styles.taskTitle}>{activeDragTask.title}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// Sortable task item (with drag handle)
// ---------------------------------------------------------------------------

function SortableTaskItem({
  task,
  onToggle,
  isDragging,
}: {
  task: TaskResponse;
  onToggle: (id: string, done: boolean) => void;
  isDragging: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: task.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={styles.taskItem} {...attributes} {...listeners}>
      <input
        type="checkbox"
        className={styles.taskCheckbox}
        checked={task.done}
        onChange={() => onToggle(task.id, !task.done)}
        onPointerDown={(e) => e.stopPropagation()}
      />
      <span
        className={`${styles.taskTitle}${task.done ? ` ${styles.taskDone}` : ''}`}
        style={task.done ? { textDecoration: 'line-through' } : undefined}
      >
        {task.title}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plain task item (no drag handle)
// ---------------------------------------------------------------------------

function TaskItem({
  task,
  onToggle,
}: {
  task: TaskResponse;
  onToggle: (id: string, done: boolean) => void;
}) {
  return (
    <div className={styles.taskItem}>
      <input
        type="checkbox"
        className={styles.taskCheckbox}
        checked={task.done}
        onChange={() => onToggle(task.id, !task.done)}
      />
      <span className={`${styles.taskTitle}${task.done ? ` ${styles.taskDone}` : ''}`}>
        {task.title}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline add-task form
// ---------------------------------------------------------------------------

interface AddTaskFormProps {
  isPending: boolean;
  onSave: (title: string) => void;
  onCancel: () => void;
}

function AddTaskForm({ isPending, onSave, onCancel }: AddTaskFormProps) {
  const [title, setTitle] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setTitle('');
  }

  return (
    <form className={styles.addTaskForm} onSubmit={handleSubmit}>
      <input
        className={styles.addTaskInput}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        placeholder="Task title"
        autoFocus
        disabled={isPending}
      />
      <div className={styles.addTaskActions}>
        <button
          type="submit"
          className={styles.addTaskSaveBtn}
          disabled={isPending || !title.trim()}
        >
          {isPending ? 'Adding…' : 'Add'}
        </button>
        <button
          type="button"
          className={styles.addTaskCancelBtn}
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// File parsing helpers
// ---------------------------------------------------------------------------

function parseUploadedFile(filename: string, text: string): string[] | null {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.txt')) {
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }

  if (lower.endsWith('.csv')) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) return [];
    const headers = parseCsvRow(lines[0]).map((h) => h.toLowerCase());
    const titleIdx = headers.indexOf('title');
    const colIdx = titleIdx !== -1 ? titleIdx : 0;
    return lines
      .slice(1)
      .map((line) => parseCsvRow(line)[colIdx]?.trim() ?? '')
      .filter(Boolean);
  }

  return null;
}

function parseCsvRow(row: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
