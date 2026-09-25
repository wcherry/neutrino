'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  CalendarClock,
  CalendarDays,
  Clock,
  FileText,
  Flag,
  Hourglass,
  MapPin,
  PlayCircle,
  Repeat,
  StickyNote,
  Tag,
  Upload,
} from 'lucide-react';
import type { TaskResponse, CreateTaskRequest } from '@/lib/api';
import {
  describeRepeat,
  formatEstimate,
  formatSmartDate,
  parseSmartAdd,
  smartAddContext,
  smartAddToCreateRequest,
  type SmartAddResult,
} from './smartAdd';
import styles from './page.module.css';

/**
 * The tasks section of the calendar sidebar.
 *
 * There is no list selector: tasks are one flat sequence in `position` order.
 * Task lists still exist server-side for the iOS clients and for the data
 * already in them, but nothing here groups by them — they are being replaced by
 * tags, and a selector for a concept on its way out was the thing standing
 * between the user and the one control this panel is for, which is typing a
 * task.
 */
interface TasksSidebarProps {
  tasks: TaskResponse[];
  onToggleTask: (id: string, done: boolean) => void;
  /** Resolves with the created task so ⌘/Ctrl+Enter can open it for editing. */
  onCreateTask: (req: CreateTaskRequest) => Promise<TaskResponse>;
  isCreatingTask: boolean;
  onOpenTask: (task: TaskResponse) => void;
  onReorderTasks?: (orderedTaskIds: string[]) => Promise<void>;
  dragReorderEnabled?: boolean;
}

export function TasksSidebar({
  tasks,
  onToggleTask,
  onCreateTask,
  isCreatingTask,
  onOpenTask,
  onReorderTasks,
  dragReorderEnabled = false,
}: TasksSidebarProps) {
  const [title, setTitle] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [createError, setCreateError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Enter adds the task; ⌘/Ctrl+Enter adds it and opens it, which is the only
   * way into reminders, scheduling and attachments for a task being typed now.
   * Both clear the box so the next one can be typed straight away.
   */
  // Parsed on every keystroke so the preview shows what Enter will create.
  const parsed = useMemo(
    () => (title.trim() ? parseSmartAdd(title.trim(), smartAddContext()) : null),
    [title],
  );

  async function submit(openAfter: boolean) {
    if (!parsed || isCreatingTask) return;
    if (!parsed.title) {
      setCreateError('Add a title as well as the details.');
      return;
    }
    setCreateError('');
    try {
      const created = await onCreateTask(smartAddToCreateRequest(parsed));
      setTitle('');
      if (openAfter) onOpenTask(created);
    } catch {
      // Keep what was typed: re-typing a task because the network blinked is
      // worse than an error message sitting under the box.
      setCreateError('Could not add that task. Please try again.');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    submit(e.metaKey || e.ctrlKey);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

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
      setUploadError('');
      // Each line is Smart Add text too, so a list exported from somewhere else keeps its dates.
      const ctx = smartAddContext();
      titles
        .map((t) => parseSmartAdd(t, ctx))
        .filter((p) => p.title)
        .forEach((p) => onCreateTask(smartAddToCreateRequest(p)).catch(() => {}));
    };
    reader.readAsText(file);
  }

  const pendingTasks = tasks.filter((t) => !t.done);
  const doneTasks = tasks.filter((t) => t.done);

  return (
    <div className={styles.tasksSection}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.csv"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <hr className={styles.tasksDivider} />
      <div className={styles.sidebarHeading}>
        <span className={styles.sidebarTitle}>Tasks</span>
        <button
          className={styles.reminderNewBtn}
          title="Add tasks from a .txt or .csv file"
          aria-label="Add tasks from a file"
          onClick={() => {
            setUploadError('');
            fileInputRef.current?.click();
          }}
        >
          <Upload size={14} />
        </button>
      </div>

      <div className={styles.taskComposer}>
        <input
          className={styles.taskComposerInput}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setCreateError('');
          }}
          onKeyDown={handleKeyDown}
          placeholder="Add a task…"
          aria-label="Add a task"
          maxLength={500}
          disabled={isCreatingTask}
        />
        {parsed && <SmartAddPreview parsed={parsed} />}
        <div
          className={styles.taskComposerHint}
          title={'^date  ~start  !1–!3 priority  #tag  *repeat  =estimate  @place  // note\n"Quote" a title to keep a date in it'}
        >
          Enter to add · {modifierLabel()}+Enter to add and edit · try ^fri 3pm #tag !1
        </div>
      </div>

      {createError && <div className={styles.taskUploadError}>{createError}</div>}
      {uploadError && <div className={styles.taskUploadError}>{uploadError}</div>}

      {tasks.length === 0 && (
        <div className={styles.tasksEmpty}>No tasks — type one above</div>
      )}

      {dragReorderEnabled ? (
        <DraggablePendingList
          pendingTasks={pendingTasks}
          onToggle={onToggleTask}
          onOpen={onOpenTask}
          onReorderTasks={onReorderTasks}
        />
      ) : (
        pendingTasks.map((task) => (
          <TaskItem key={task.id} task={task} onToggle={onToggleTask} onOpen={onOpenTask} />
        ))
      )}

      {doneTasks.length > 0 && (
        <div style={{ opacity: 0.55 }}>
          {doneTasks.map((task) => (
            <TaskItem key={task.id} task={task} onToggle={onToggleTask} onOpen={onOpenTask} />
          ))}
        </div>
      )}
    </div>
  );
}

/** ⌘ on a Mac, Ctrl everywhere else — the hint has to name the key that works. */
function modifierLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
}

// ---------------------------------------------------------------------------
// Draggable pending-tasks list
// ---------------------------------------------------------------------------

interface DraggablePendingListProps {
  pendingTasks: TaskResponse[];
  onToggle: (id: string, done: boolean) => void;
  onOpen: (task: TaskResponse) => void;
  onReorderTasks?: (orderedTaskIds: string[]) => Promise<void>;
}

function DraggablePendingList({
  pendingTasks,
  onToggle,
  onOpen,
  onReorderTasks,
}: DraggablePendingListProps) {
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // A task added or removed by anything other than a drag invalidates the
  // optimistic order, which is keyed by id and would otherwise hide the new row.
  const idsKey = pendingTasks.map((t) => t.id).join(',');
  useEffect(() => {
    setLocalOrder((prev) => {
      if (prev === null) return null;
      const ids = idsKey ? idsKey.split(',') : [];
      return ids.length === prev.length && ids.every((id) => prev.includes(id)) ? prev : null;
    });
  }, [idsKey]);

  // A pointer has to travel before it counts as a drag, which is what leaves a
  // plain click on the title free to open the task.
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
    onReorderTasks?.(newIds);
  }, [onReorderTasks]);

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
            onOpen={onOpen}
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
// Sortable task item (the whole row is the drag handle)
// ---------------------------------------------------------------------------

function SortableTaskItem({
  task,
  onToggle,
  onOpen,
  isDragging,
}: {
  task: TaskResponse;
  onToggle: (id: string, done: boolean) => void;
  onOpen: (task: TaskResponse) => void;
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
      <TaskCheckbox task={task} onToggle={onToggle} stopDrag />
      <TaskTitleButton task={task} onOpen={onOpen} />
      <TaskBadges task={task} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plain task item (no drag handle)
// ---------------------------------------------------------------------------

function TaskItem({
  task,
  onToggle,
  onOpen,
}: {
  task: TaskResponse;
  onToggle: (id: string, done: boolean) => void;
  onOpen: (task: TaskResponse) => void;
}) {
  return (
    <div className={styles.taskItem}>
      <TaskCheckbox task={task} onToggle={onToggle} />
      <TaskTitleButton task={task} onOpen={onOpen} />
      <TaskBadges task={task} />
    </div>
  );
}

function TaskCheckbox({
  task,
  onToggle,
  stopDrag = false,
}: {
  task: TaskResponse;
  onToggle: (id: string, done: boolean) => void;
  stopDrag?: boolean;
}) {
  return (
    <input
      type="checkbox"
      className={styles.taskCheckbox}
      checked={task.done}
      aria-label={task.title}
      onChange={() => onToggle(task.id, !task.done)}
      // Ticking a box must not be the start of a drag.
      onPointerDown={stopDrag ? (e) => e.stopPropagation() : undefined}
    />
  );
}

function TaskTitleButton({
  task,
  onOpen,
}: {
  task: TaskResponse;
  onOpen: (task: TaskResponse) => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.taskTitleBtn} ${styles.taskTitle}${task.done ? ` ${styles.taskDone}` : ''}`}
      onClick={() => onOpen(task)}
      title="Edit task"
    >
      {task.title}
    </button>
  );
}

/**
 * What a task carries that its title cannot say. Only the three fields already
 * on the task row are shown: reminders and attachments each need a request per
 * task, and a sidebar listing every task should not make one per row to draw an
 * icon — the task editor is where those are counted.
 */
function TaskBadges({ task }: { task: TaskResponse }) {
  const scheduled = Boolean(task.eventId);
  const hasNotes = Boolean(task.notes);
  const hasDue = Boolean(task.dueDate);
  const tags = task.tags ?? [];
  const priority = task.priority ?? null;
  const repeats = Boolean(task.recurrenceRule);
  const located = Boolean(task.location);
  if (!scheduled && !hasNotes && !hasDue && !tags.length && !priority && !repeats && !located) {
    return null;
  }

  return (
    <span className={styles.taskBadges}>
      {tags.map((tag) => (
        <span key={tag} className={styles.taskTag}>#{tag}</span>
      ))}
      {priority && (
        <Flag
          size={11}
          className={styles[`priority${priority}`]}
          aria-label={`Priority ${priority}`}
        />
      )}
      {hasDue && <Clock size={11} aria-label="Has a due date" />}
      {repeats && <Repeat size={11} aria-label="Repeats" />}
      {located && <MapPin size={11} aria-label={`At ${task.location}`} />}
      {scheduled && <CalendarClock size={11} aria-label="On the calendar" />}
      {hasNotes && <FileText size={11} aria-label="Has notes" />}
    </span>
  );
}

/** One chip per field Smart Add found in the line being typed. Nothing when it found none. */
function SmartAddPreview({ parsed }: { parsed: SmartAddResult }) {
  const chips: { key: string; icon: React.ReactNode; text: string; className?: string }[] = [];
  if (parsed.due) {
    chips.push({ key: 'due', icon: <CalendarDays size={10} />, text: formatSmartDate(parsed.due) });
  }
  if (parsed.start) {
    chips.push({ key: 'start', icon: <PlayCircle size={10} />, text: `starts ${formatSmartDate(parsed.start)}` });
  }
  if (parsed.priority) {
    chips.push({
      key: 'priority',
      icon: <Flag size={10} className={styles[`priority${parsed.priority}`]} />,
      text: `Priority ${parsed.priority}`,
    });
  }
  for (const tag of parsed.tags) {
    chips.push({ key: `tag-${tag}`, icon: <Tag size={10} />, text: tag });
  }
  if (parsed.recurrenceRule) {
    chips.push({
      key: 'repeat',
      icon: <Repeat size={10} />,
      text: describeRepeat(parsed.recurrenceRule, parsed.repeatAfterCompletion),
    });
  }
  if (parsed.estimateMinutes !== null) {
    chips.push({ key: 'estimate', icon: <Hourglass size={10} />, text: formatEstimate(parsed.estimateMinutes) });
  }
  if (parsed.location) {
    chips.push({ key: 'location', icon: <MapPin size={10} />, text: parsed.location });
  }
  if (parsed.note) {
    chips.push({ key: 'note', icon: <StickyNote size={10} />, text: parsed.note });
  }
  if (chips.length === 0) return null;

  return (
    <div className={styles.smartAddPreview} aria-label="Smart Add will set" role="list">
      {chips.map((c) => (
        <span key={c.key} className={styles.smartAddChip} role="listitem">
          {c.icon}
          {c.text}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File parsing helpers
// ---------------------------------------------------------------------------

export function parseUploadedFile(filename: string, text: string): string[] | null {
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
