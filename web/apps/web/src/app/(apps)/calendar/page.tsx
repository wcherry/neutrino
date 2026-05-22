'use client';
// Intentionally a full client component: view, cursor, event/reminder mutations,
// ICS drag-drop, and browser notification state are all deeply coupled across the
// toolbar, calendar area, and sidebar.  No meaningful static server shell exists.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@neutrino/ui';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  calendarApi,
  type CreateEventRequest,
  type UpdateEventRequest,
  type CreateReminderRequest,
  type CreateAttachmentRequest,
  type EventResponse,
  type UpdateReminderRequest,
  type TaskResponse,
  type CreateTaskRequest,
  type CreateTaskListRequest,
} from '@/lib/api';
import {
  WEEK_START_KEY,
  DAY_START_HOUR_KEY,
  DAY_END_HOUR_KEY,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_DAY_END_HOUR,
} from './constants';

import type { View, ParsedIcsEvent } from './calendarTypes';
import { monthRange, weekStartDate, fmtRangeLabel, parseIcs, expandRecurringEvents } from './calendarHelpers';
import MonthView from './MonthView';
import WeekView from './WeekView';
import AgendaView from './AgendaView';
import NewEventModal from './NewEventModal';
import ReminderModal from './ReminderModal';
import { RemindersSidebar } from './RemindersSidebar';
import { TaskListsSidebar } from './TaskListsSidebar';
import { EventDetail, EventViewModal } from './EventDetail';
import styles from './page.module.css';

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [startDay, setStartDay] = useState(0);
  const [dayStartHour, setDayStartHour] = useState(DEFAULT_DAY_START_HOUR);
  const [dayEndHour, setDayEndHour] = useState(DEFAULT_DAY_END_HOUR);
  const calendarAreaRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(WEEK_START_KEY);
    if (stored !== null) setStartDay(Number(stored));

    const storedStart = localStorage.getItem(DAY_START_HOUR_KEY);
    if (storedStart !== null) setDayStartHour(Number(storedStart));

    const storedEnd = localStorage.getItem(DAY_END_HOUR_KEY);
    if (storedEnd !== null) setDayEndHour(Number(storedEnd));

    function onStorage(e: StorageEvent) {
      if (e.key === WEEK_START_KEY && e.newValue !== null) {
        setStartDay(Number(e.newValue));
      }
      if (e.key === DAY_START_HOUR_KEY && e.newValue !== null) {
        setDayStartHour(Number(e.newValue));
      }
      if (e.key === DAY_END_HOUR_KEY && e.newValue !== null) {
        setDayEndHour(Number(e.newValue));
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const [selectedEvent, setSelectedEvent] = useState<EventResponse | null>(null);
  const [viewingEvent, setViewingEvent] = useState<EventResponse | null>(null);
  const [editingEvent, setEditingEvent] = useState<EventResponse | null>(null);
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [newEventDate, setNewEventDate] = useState<Date>(() => new Date());
  const [icsPrefill, setIcsPrefill] = useState<ParsedIcsEvent | undefined>();
  const [reminderModal, setReminderModal] = useState<{ open: boolean; editing: import('@/lib/api').ReminderResponse | null }>({ open: false, editing: null });

  const { from, to } = monthRange(cursor);

  const { data: eventsData } = useQuery({
    queryKey: ['events', from, to],
    queryFn: () => calendarApi.listEvents(from, to),
  });

  const { data: remindersData } = useQuery({
    queryKey: ['reminders'],
    queryFn: () => calendarApi.listReminders(),
    refetchInterval: 60_000,
  });

  // ── Task lists ────────────────────────────────────────────────────────────
  const { data: taskListsData } = useQuery({
    queryKey: ['taskLists'],
    queryFn: () => calendarApi.listTaskLists(),
  });
  const taskLists = taskListsData?.taskLists ?? [];

  // Fetch all tasks in a single call (backend returns list_id on each task)
  const { data: allTasksData } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => calendarApi.listAllTasks(),
  });
  const allTasks: TaskResponse[] = allTasksData ?? [];

  // Browser notifications for due reminders
  const notifiedIds = useRef<Set<string>>(new Set());
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('neutrino:notified-reminders');
      if (stored) {
        (JSON.parse(stored) as string[]).forEach((id) => notifiedIds.current.add(id));
      }
    } catch { /* ignore */ }

    if (typeof Notification === 'undefined') return;
    setNotifPermission(Notification.permission);
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(setNotifPermission);
    }
  }, []);

  useEffect(() => {
    if (!remindersData || notifPermission !== 'granted') return;
    const now = new Date();
    for (const r of remindersData.reminders) {
      if (r.completed || notifiedIds.current.has(r.id)) continue;
      if (new Date(r.dueTime) <= now) {
        new Notification('Reminder', { body: r.title, tag: r.id });
        notifiedIds.current.add(r.id);
      }
    }
    try {
      localStorage.setItem(
        'neutrino:notified-reminders',
        JSON.stringify([...notifiedIds.current])
      );
    } catch { /* ignore */ }
  }, [remindersData, notifPermission]);

  const createEvent = useMutation({
    mutationFn: async ({ req, reminderOffsets, pendingAttachments }: { req: CreateEventRequest; reminderOffsets: number[]; pendingAttachments: CreateAttachmentRequest[] }) => {
      const event = await calendarApi.createEvent(req);
      const startMs = new Date(event.startTime).getTime();
      await Promise.all([
        ...reminderOffsets.map((minutes) =>
          calendarApi.createReminder({
            title: event.title,
            dueTime: new Date(startMs - minutes * 60_000).toISOString(),
            linkedEventId: event.id,
          })
        ),
        ...pendingAttachments.map((attachment) =>
          calendarApi.createAttachment(event.id, attachment)
        ),
      ]);
      return event;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['reminders'] });
      setShowNewEvent(false);
      setIcsPrefill(undefined);
    },
  });

  const deleteEvent = useMutation({
    mutationFn: (id: string) => calendarApi.deleteEvent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      setSelectedEvent(null);
      setViewingEvent(null);
      setEditingEvent(null);
    },
  });

  const updateEvent = useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateEventRequest }) =>
      calendarApi.updateEvent(id, req),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['events'] });
      // Keep the detail panel open, showing the refreshed event data
      setSelectedEvent(updated);
      setEditingEvent(null);
    },
  });

  const toggleReminder = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      calendarApi.updateReminder(id, { completed }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });

  const createReminder = useMutation({
    mutationFn: (req: CreateReminderRequest) => calendarApi.createReminder(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] });
      setReminderModal({ open: false, editing: null });
    },
  });

  const updateReminder = useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateReminderRequest }) =>
      calendarApi.updateReminder(id, req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] });
      setReminderModal({ open: false, editing: null });
    },
  });

  const deleteReminder = useMutation({
    mutationFn: (id: string) => calendarApi.deleteReminder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });

  const toggleTask = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      calendarApi.updateTask(id, { done }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const createTask = useMutation({
    mutationFn: async ({ req, listId }: { req: CreateTaskRequest; listId: string }) => {
      const task = await calendarApi.createTask(req);
      await calendarApi.addTaskToList(task.id, listId);
      return { ...task, listId };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const createTaskList = useMutation({
    mutationFn: (req: CreateTaskListRequest) => calendarApi.createTaskList(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['taskLists'] }),
  });

  const reorderTasks = useCallback(
    async (listId: string, orderedTaskIds: string[]) => {
      await calendarApi.reorderTasks({ listId, taskIds: orderedTaskIds });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    [qc]
  );

  const rawEvents = eventsData?.events ?? [];
  const events = React.useMemo(
    () => expandRecurringEvents(rawEvents, new Date(from), new Date(to)),
    [rawEvents, from, to]
  );
  const reminders = remindersData?.reminders ?? [];

  function navigate(dir: 1 | -1) {
    setCursor((prev) => {
      const d = new Date(prev);
      if (view === 'month' || view === 'agenda') {
        d.setMonth(d.getMonth() + dir);
      } else {
        d.setDate(weekStartDate(d, startDay).getDate() + dir * 7);
      }
      return d;
    });
  }

  const handleDayClick = useCallback((day: Date) => {
    setNewEventDate(day);
    setSelectedEvent(null);
  }, []);

  const handleEventClick = useCallback((ev: EventResponse) => {
    setViewingEvent(ev);
  }, []);

  // ICS drag-drop
  function handleDragOver(e: React.DragEvent) {
    if ([...e.dataTransfer.items].some((i) => i.kind === 'file' && i.type === 'text/calendar')) {
      e.preventDefault();
      setIsDragOver(true);
    }
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = [...e.dataTransfer.files].find((f) => f.name.endsWith('.ics') || f.type === 'text/calendar');
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseIcs(text);
      if (parsed) {
        setIcsPrefill(parsed);
        setNewEventDate(parsed.startTime ? new Date(parsed.startTime) : new Date());
        setShowNewEvent(true);
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className={styles.page}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <Button
            icon={<Plus size={16} />}
            onClick={() => {
              setIcsPrefill(undefined);
              setNewEventDate(new Date());
              setShowNewEvent(true);
            }}
          >
            New Event
          </Button>
        </div>

        <div className={styles.toolbarCenter}>
          <button className={styles.navBtn} onClick={() => navigate(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button className={styles.todayBtn} onClick={() => setCursor(new Date())}>
            Today
          </button>
          <button className={styles.navBtn} onClick={() => navigate(1)}>
            <ChevronRight size={16} />
          </button>
          <span className={styles.periodLabel}>{fmtRangeLabel(view, cursor, startDay)}</span>
        </div>

        <div className={styles.toolbarRight}>
          <div className={styles.viewToggle}>
            {(['month', 'week', 'agenda'] as View[]).map((v) => (
              <button
                key={v}
                className={`${styles.viewBtn} ${view === v ? styles.viewBtnActive : ''}`}
                onClick={() => setView(v)}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className={styles.body}>
        <div
          ref={calendarAreaRef}
          className={`${styles.calendarArea} ${isDragOver ? styles.calendarAreaDragOver : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragOver && (
            <div className={styles.dropOverlay}>
              <CalendarDays size={32} />
              <span>Drop .ics file to import event</span>
            </div>
          )}
          {view === 'month' && (
            <MonthView
              cursor={cursor}
              events={events}
              onDayClick={(day) => { handleDayClick(day); setIcsPrefill(undefined); setShowNewEvent(true); setNewEventDate(day); }}
              onEventClick={handleEventClick}
              startDay={startDay}
            />
          )}
          {view === 'week' && (
            <WeekView
              cursor={cursor}
              events={events}
              onDayClick={(day) => { handleDayClick(day); setIcsPrefill(undefined); setShowNewEvent(true); setNewEventDate(day); }}
              onEventClick={handleEventClick}
              startDay={startDay}
              dayStartHour={dayStartHour}
              dayEndHour={dayEndHour}
            />
          )}
          {view === 'agenda' && (
            <AgendaView cursor={cursor} events={events} onEventClick={handleEventClick} />
          )}
        </div>

        {/* Right sidebar */}
        <div className={styles.sidebar}>
          {selectedEvent ? (
            <div className={styles.sidebarSection}>
              <EventDetail
                event={selectedEvent}
                onClose={() => setSelectedEvent(null)}
                onDelete={(id) => deleteEvent.mutate(id)}
                onEdit={(ev) => setEditingEvent(ev)}
              />
              <div style={{ padding: 16 }}>
                <RemindersSidebar
                  reminders={reminders.filter((r) => !r.linkedEventId)}
                  onToggle={(id, completed) => toggleReminder.mutate({ id, completed })}
                  onEdit={(r) => setReminderModal({ open: true, editing: r })}
                  onDelete={(id) => deleteReminder.mutate(id)}
                  onNew={() => setReminderModal({ open: true, editing: null })}
                />
                <TaskListsSidebar
                    taskLists={taskLists}
                    tasks={allTasks}
                    onToggleTask={(id, done) => toggleTask.mutate({ id, done })}
                    onCreateTask={(req, listId) => createTask.mutate({ req, listId })}
                    isCreatingTask={createTask.isPending}
                    onCreateTaskList={(req) => createTaskList.mutateAsync(req)}
                    isCreatingTaskList={createTaskList.isPending}
                    onReorderTasks={reorderTasks}
                    dragReorderEnabled={true}
                  />
              </div>
            </div>
          ) : (
            <div className={styles.sidebarSection}>
              <RemindersSidebar
                reminders={reminders.filter((r) => !r.linkedEventId)}
                onToggle={(id, completed) => toggleReminder.mutate({ id, completed })}
                onEdit={(r) => setReminderModal({ open: true, editing: r })}
                onDelete={(id) => deleteReminder.mutate(id)}
                onNew={() => setReminderModal({ open: true, editing: null })}
              />
              <TaskListsSidebar
                  taskLists={taskLists}
                  tasks={allTasks}
                  onToggleTask={(id, done) => toggleTask.mutate({ id, done })}
                  onCreateTask={(req, listId) => createTask.mutate({ req, listId })}
                  isCreatingTask={createTask.isPending}
                  onCreateTaskList={(req) => createTaskList.mutateAsync(req)}
                  isCreatingTaskList={createTaskList.isPending}
                  onReorderTasks={reorderTasks}
                  dragReorderEnabled={true}
                />
            </div>
          )}
        </div>
      </div>

      {/* New event modal */}
      {showNewEvent && (
        <NewEventModal
          defaultDate={newEventDate}
          prefill={icsPrefill}
          onClose={() => { setShowNewEvent(false); setIcsPrefill(undefined); }}
          onCreate={(req, reminderOffsets, pendingAttachments) => createEvent.mutate({ req, reminderOffsets, pendingAttachments })}
          isPending={createEvent.isPending}
        />
      )}

      {/* View event modal */}
      {viewingEvent && (
        <EventViewModal
          event={viewingEvent}
          onClose={() => setViewingEvent(null)}
          onEdit={() => { setEditingEvent(viewingEvent); setViewingEvent(null); }}
          onDelete={(id) => deleteEvent.mutate(id)}
        />
      )}

      {/* Edit event modal */}
      {editingEvent && (
        <NewEventModal
          defaultDate={new Date(editingEvent.startTime)}
          existingEvent={editingEvent}
          onClose={() => setEditingEvent(null)}
          onCreate={() => { /* unused in edit mode — onUpdate handles saves */ }}
          onUpdate={(req, id) => updateEvent.mutate({ id, req })}
          isPending={updateEvent.isPending}
        />
      )}

      {/* Reminder create/edit modal */}
      {reminderModal.open && (
        <ReminderModal
          initial={reminderModal.editing ?? undefined}
          onClose={() => setReminderModal({ open: false, editing: null })}
          onSave={(data) => {
            if (reminderModal.editing) {
              updateReminder.mutate({ id: reminderModal.editing.id, req: data as UpdateReminderRequest });
            } else {
              createReminder.mutate(data as CreateReminderRequest);
            }
          }}
          isPending={createReminder.isPending || updateReminder.isPending}
        />
      )}
    </div>
  );
}
