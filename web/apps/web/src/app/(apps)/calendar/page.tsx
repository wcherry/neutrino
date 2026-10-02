'use client';
// Intentionally a full client component: view, cursor, event/reminder mutations,
// ICS drag-drop, and browser notification state are all deeply coupled across the
// toolbar, calendar area, and sidebar.  No meaningful static server shell exists.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter as useNextRouter } from 'next/navigation';
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
  type UpdateTaskRequest,
  type ReminderResponse,
} from '@/lib/api';
import type { CalendarResponse, UpdateCalendarRequest } from '@neutrino/api-calendar';
import {
  WEEK_START_KEY,
  DAY_START_HOUR_KEY,
  DAY_END_HOUR_KEY,
  DEFAULT_DAY_START_HOUR,
  DEFAULT_DAY_END_HOUR,
} from './constants';

import type { View, ParsedIcsEvent } from './calendarTypes';
import {
  monthRange,
  weekStartDate,
  fmtRangeLabel,
  parseIcs,
  expandRecurringEvents,
  ruleFromOccurrence,
  type CalendarOccurrence,
} from './calendarHelpers';
import RecurrenceScopeModal, { type RecurrenceScope } from './RecurrenceScopeModal';
import MonthView from './MonthView';
import WeekView from './WeekView';
import AgendaView from './AgendaView';
import NewEventModal from './NewEventModal';
import ReminderModal from './ReminderModal';
import { RemindersSidebar } from './RemindersSidebar';
import { CalendarsSidebar } from './CalendarsSidebar';
import { calendarMap, calendarOf, holidayEvents, isReadOnlyEvent, visibleEvents } from './calendars';
import { isTaskEvent, taskEvents, type TaskOccurrence } from './calendarTasks';
import { TasksSidebar } from './TasksSidebar';
import TaskDetailModal from './TaskDetailModal';
import { allTags } from './tags';
import { EventDetail, EventViewModal } from './EventDetail';
import styles from './page.module.css';

// ── Page ──────────────────────────────────────────────────────────────────────

/** An edit or delete of a repeating event or reminder, waiting on which occurrences it is for. */
type ScopePrompt =
  | { action: 'edit' | 'delete'; kind: 'event'; occurrence: CalendarOccurrence }
  | { action: 'edit' | 'delete'; kind: 'reminder'; reminder: ReminderResponse };

/** The event form open for an edit: what it shows, and what saving it changes. */
interface EventEdit {
  /** The event the form is filled from. */
  form: EventResponse;
  /** The occurrence the edit was started from. */
  occurrence: CalendarOccurrence;
  /** Which of a repeating event's occurrences it is for. Absent for a one-off event. */
  scope?: RecurrenceScope;
}

/** The zone a repeating reminder is stepped on in, as it is when completed. */
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The server's message for a failed request, which says why (read-only, still connected). */
function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Where in its series an occurrence falls; a one-off event is its own start. */
const occurrenceStartOf = (occurrence: CalendarOccurrence) =>
  occurrence.occurrenceStart ?? occurrence.startTime;

export default function CalendarPage() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const calendarRouter = useNextRouter();
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

  const [selectedEvent, setSelectedEvent] = useState<CalendarOccurrence | null>(null);
  const [viewingEvent, setViewingEvent] = useState<CalendarOccurrence | null>(null);
  const [editingEvent, setEditingEvent] = useState<EventEdit | null>(null);
  const [scopePrompt, setScopePrompt] = useState<ScopePrompt | null>(null);
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [newEventDate, setNewEventDate] = useState<Date>(() => new Date());
  const [icsPrefill, setIcsPrefill] = useState<ParsedIcsEvent | undefined>();
  const [reminderModal, setReminderModal] = useState<{ open: boolean; editing: ReminderResponse | null; scope?: RecurrenceScope }>({ open: false, editing: null });

  useEffect(() => {
    const newParam = searchParams.get('new');
    if (newParam === 'event') {
      setShowNewEvent(true);
      calendarRouter.replace('/calendar');
    } else if (newParam === 'reminder') {
      setReminderModal({ open: true, editing: null });
      calendarRouter.replace('/calendar');
    }
  }, [searchParams, calendarRouter]);

  const { from, to } = monthRange(cursor);

  const { data: eventsData } = useQuery({
    queryKey: ['events', from, to],
    queryFn: () => calendarApi.listEvents(from, to, { exceptions: true }),
  });

  // ── Calendars ─────────────────────────────────────────────────────────────
  const { data: calendarsData } = useQuery({
    queryKey: ['calendars'],
    queryFn: () => calendarApi.listCalendars(),
  });
  const calendars = React.useMemo(() => calendarsData?.calendars ?? [], [calendarsData]);
  const calendarsById = React.useMemo(() => calendarMap(calendars), [calendars]);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  // Holidays are computed here, not fetched: the key is what they depend on, so a change of
  // country, region or observances computes them again and nothing else does.
  const holidayCalendars = calendars.filter((c) => c.kind === 'holidays' && c.visible);
  const { data: holidays } = useQuery({
    queryKey: ['holidays', holidayCalendars.map((c) => [c.id, c.country, c.region, c.includeObservances]), from, to],
    queryFn: () => holidayEvents(holidayCalendars, from, to),
    enabled: holidayCalendars.length > 0,
    staleTime: Infinity,
  });

  const updateCalendar = useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateCalendarRequest }) => calendarApi.updateCalendar(id, req),
    // Shown at once: a show/hide that waited on the server would feel broken.
    onMutate: ({ id, req }) => {
      setCalendarError(null);
      const previous = qc.getQueryData<{ calendars: CalendarResponse[] }>(['calendars']);
      qc.setQueryData<{ calendars: CalendarResponse[] }>(['calendars'], (old) =>
        old && { calendars: old.calendars.map((c) => (c.id === id ? { ...c, ...req } : c)) });
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) qc.setQueryData(['calendars'], context.previous);
      setCalendarError(errorMessage(err, 'Could not update the calendar'));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['calendars'] }),
  });

  const createCalendar = useMutation({
    mutationFn: ({ name, color }: { name: string; color: string }) => calendarApi.createCalendar({ name, color }),
    onMutate: () => setCalendarError(null),
    onError: (err) => setCalendarError(errorMessage(err, 'Could not add the calendar')),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendars'] }),
  });

  const deleteCalendar = useMutation({
    mutationFn: (id: string) => calendarApi.deleteCalendar(id),
    onMutate: () => setCalendarError(null),
    onError: (err) => setCalendarError(errorMessage(err, 'Could not delete the calendar')),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendars'] });
      qc.invalidateQueries({ queryKey: ['events'] });
    },
  });

  const { data: remindersData } = useQuery({
    queryKey: ['reminders'],
    queryFn: () => calendarApi.listReminders(),
    refetchInterval: 60_000,
  });

  // ── Tasks ─────────────────────────────────────────────────────────────────
  //
  // One flat sequence, in `position` order. Task lists still exist server-side
  // but nothing here reads them: they are being replaced by tags.
  const { data: allTasksData } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => calendarApi.listAllTasks(),
  });
  const allTasks: TaskResponse[] = React.useMemo(() => allTasksData ?? [], [allTasksData]);
  const [editingTask, setEditingTask] = useState<TaskResponse | null>(null);

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
    mutationFn: ({ occurrence, scope }: { occurrence: CalendarOccurrence; scope?: RecurrenceScope }) => {
      const series = occurrence.series;
      if (!series || !scope) return calendarApi.deleteEvent(occurrence.id);
      const at = occurrenceStartOf(occurrence);
      switch (scope) {
        case 'this': return calendarApi.cancelOccurrence(series.id, at);
        case 'following': return calendarApi.deleteEventFrom(series.id, at);
        case 'all': return calendarApi.deleteEvent(series.id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      setSelectedEvent(null);
      setViewingEvent(null);
      setEditingEvent(null);
    },
  });

  const updateEvent = useMutation({
    mutationFn: ({ edit, req }: { edit: EventEdit; req: UpdateEventRequest }) => {
      const series = edit.occurrence.series;
      if (!series || !edit.scope) return calendarApi.updateEvent(edit.form.id, req);
      const at = occurrenceStartOf(edit.occurrence);
      switch (edit.scope) {
        case 'this': return calendarApi.editOccurrence(series.id, at, req);
        case 'following': return calendarApi.splitEvent(series.id, { ...req, originalStartTime: at });
        case 'all': return calendarApi.updateEvent(series.id, req);
      }
    },
    onSuccess: (updated, { edit }) => {
      qc.invalidateQueries({ queryKey: ['events'] });
      // Keep the detail panel open, showing the refreshed event data. An edit of a repeating
      // event may have moved or split it, so which occurrence was open is no longer known.
      setSelectedEvent(edit.scope ? null : updated);
      setEditingEvent(null);
    },
  });

  /** Opens the form on an event, asking first which occurrences it is for if it repeats. */
  function requestEdit(occurrence: CalendarOccurrence) {
    if (isReadOnlyEvent(occurrence, calendarsById)) return;
    if (occurrence.series) setScopePrompt({ action: 'edit', kind: 'event', occurrence });
    else setEditingEvent({ form: occurrence, occurrence });
  }

  /**
   * Opens the form on the occurrences `scope` names: the one occurrence as it is; the series as
   * it runs from this occurrence, its COUNT less the occurrences before; or the whole series
   * from its own start. From the first occurrence, "this and following" is the whole series.
   */
  function startEdit(occurrence: CalendarOccurrence, scope: RecurrenceScope) {
    const series = occurrence.series!;
    const at = occurrenceStartOf(occurrence);
    const effective = scope === 'following' && Date.parse(at) <= Date.parse(series.startTime) ? 'all' : scope;
    let form: EventResponse = series;
    if (effective === 'this') form = occurrence;
    if (effective === 'following') {
      const length = Date.parse(series.endTime) - Date.parse(series.startTime);
      form = {
        ...series,
        startTime: at,
        endTime: new Date(Date.parse(at) + length).toISOString(),
        recurrenceRule: ruleFromOccurrence(series, at),
      };
    }
    setEditingEvent({ form, occurrence, scope: effective });
  }

  function requestDelete(occurrence: CalendarOccurrence) {
    if (isReadOnlyEvent(occurrence, calendarsById)) return;
    if (occurrence.series) setScopePrompt({ action: 'delete', kind: 'event', occurrence });
    else deleteEvent.mutate({ occurrence });
  }

  const toggleReminder = useMutation({
    // The zone travels with the completion: a recurring reminder is moved to its next
    // occurrence server-side, stepped in this zone.
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      calendarApi.updateReminder(id, {
        completed,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
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

  // "This reminder" for a repeating one: the series moves on past the current occurrence.
  const skipReminder = useMutation({
    mutationFn: (id: string) => calendarApi.skipReminder(id, browserZone()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });

  const editReminderOccurrence = useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateReminderRequest }) =>
      calendarApi.editReminderOccurrence(id, { title: req.title, dueTime: req.dueTime, timezone: browserZone() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] });
      setReminderModal({ open: false, editing: null });
    },
  });

  /** A repeating reminder has just the one row, at its next occurrence, so "this and following"
   * and "all" both change the series. */
  function requestReminderEdit(reminder: ReminderResponse) {
    if (reminder.recurrenceRule) setScopePrompt({ action: 'edit', kind: 'reminder', reminder });
    else setReminderModal({ open: true, editing: reminder });
  }

  function requestReminderDelete(id: string) {
    const reminder = reminders.find((r) => r.id === id);
    if (reminder?.recurrenceRule) setScopePrompt({ action: 'delete', kind: 'reminder', reminder });
    else deleteReminder.mutate(id);
  }

  function chooseScope(scope: RecurrenceScope) {
    const prompt = scopePrompt;
    setScopePrompt(null);
    if (!prompt) return;
    if (prompt.kind === 'event') {
      if (prompt.action === 'edit') startEdit(prompt.occurrence, scope);
      else deleteEvent.mutate({ occurrence: prompt.occurrence, scope });
    } else if (prompt.action === 'edit') {
      setReminderModal({ open: true, editing: prompt.reminder, scope });
    } else if (scope === 'this') {
      skipReminder.mutate(prompt.reminder.id);
    } else {
      deleteReminder.mutate(prompt.reminder.id);
    }
  }

  const toggleTask = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      // The zone matters only when completing a repeating task: the server steps a timed one in
      // it, so a 9am task comes round at 9am after a DST change.
      calendarApi.updateTask(id, {
        done,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    // Ticked at once, in the sidebar and on the calendar alike, and unticked again on a failure.
    // Not awaiting the cancel: the box must tick in the same frame it was clicked.
    onMutate: ({ id, done }) => {
      void qc.cancelQueries({ queryKey: ['tasks'] });
      const previous = qc.getQueryData<TaskResponse[]>(['tasks']);
      qc.setQueryData<TaskResponse[]>(['tasks'], (old) => old?.map((t) => (t.id === id ? { ...t, done } : t)));
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(['tasks'], context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  /** Ticks or unticks a task drawn on the calendar. */
  const { mutate: mutateTask } = toggleTask;
  const toggleCalendarTask = useCallback(
    (task: TaskOccurrence) => mutateTask({ id: task.taskId, done: !task.done }),
    [mutateTask],
  );

  const createTask = useMutation({
    mutationFn: (req: CreateTaskRequest) => calendarApi.createTask(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const updateTask = useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateTaskRequest }) =>
      calendarApi.updateTask(id, req),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const reorderTasks = useCallback(
    async (orderedTaskIds: string[]) => {
      await calendarApi.reorderTasks({ taskIds: orderedTaskIds });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    [qc]
  );

  const rawEvents = eventsData?.events ?? [];
  // What the views draw: the occurrences in calendars that are shown, the holidays, and the
  // tasks due in the range.
  const events = React.useMemo(
    () => [
      ...visibleEvents(expandRecurringEvents(rawEvents, new Date(from), new Date(to)), calendarsById),
      ...((holidays ?? []) as CalendarOccurrence[]),
      ...taskEvents(allTasks, from, to),
    ],
    [rawEvents, from, to, calendarsById, holidays, allTasks]
  );
  const colorOf = useCallback(
    (ev: EventResponse) => calendarOf(ev, calendarsById)?.color,
    [calendarsById],
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

  // The views hand back what they were given: occurrences, from `expandRecurringEvents`.
  // A task drawn on the calendar opens the task, not the event view.
  const handleEventClick = useCallback((ev: EventResponse) => {
    if (isTaskEvent(ev)) {
      const task = allTasks.find((t) => t.id === ev.taskId);
      if (task) setEditingTask(task);
      return;
    }
    setViewingEvent(ev as CalendarOccurrence);
  }, [allTasks]);

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

  // The two sidebar arrangements (with and without an event open) show the same
  // panels, so they are built once rather than kept in step by hand.
  const calendarsPanel = (
    <CalendarsSidebar
      calendars={calendars}
      onToggle={(id, visible) => updateCalendar.mutate({ id, req: { visible } })}
      onRecolor={(id, color) => updateCalendar.mutate({ id, req: { color } })}
      onCreate={(name, color) => createCalendar.mutate({ name, color })}
      onDelete={(id) => deleteCalendar.mutate(id)}
      error={calendarError}
    />
  );

  const remindersPanel = (
    <RemindersSidebar
      reminders={reminders}
      taskTitles={Object.fromEntries(allTasks.map((t) => [t.id, t.title]))}
      onToggle={(id, completed) => toggleReminder.mutate({ id, completed })}
      onEdit={requestReminderEdit}
      onDelete={requestReminderDelete}
      onNew={() => setReminderModal({ open: true, editing: null })}
    />
  );

  const tasksPanel = (
    <TasksSidebar
      tasks={allTasks}
      onToggleTask={(id, done) => toggleTask.mutate({ id, done })}
      onCreateTask={(req) => createTask.mutateAsync(req)}
      isCreatingTask={createTask.isPending}
      onOpenTask={setEditingTask}
      onReorderTasks={reorderTasks}
      dragReorderEnabled={true}
    />
  );

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
          <button className={styles.navBtn} aria-label="Previous period" onClick={() => navigate(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button className={styles.todayBtn} onClick={() => setCursor(new Date())}>
            Today
          </button>
          <button className={styles.navBtn} aria-label="Next period" onClick={() => navigate(1)}>
            <ChevronRight size={16} />
          </button>
          <span className={styles.periodLabel} data-testid="period-label">{fmtRangeLabel(view, cursor, startDay)}</span>
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
              colorOf={colorOf}
              onToggleTask={toggleCalendarTask}
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
              colorOf={colorOf}
              onToggleTask={toggleCalendarTask}
            />
          )}
          {view === 'agenda' && (
            <AgendaView cursor={cursor} events={events} onEventClick={handleEventClick} colorOf={colorOf} onToggleTask={toggleCalendarTask} />
          )}
        </div>

        {/* Right sidebar */}
        <div className={styles.sidebar}>
          {selectedEvent ? (
            <div className={styles.sidebarSection}>
              <EventDetail
                event={selectedEvent}
                calendar={calendarOf(selectedEvent, calendarsById)}
                readOnly={isReadOnlyEvent(selectedEvent, calendarsById)}
                onClose={() => setSelectedEvent(null)}
                onDelete={() => requestDelete(selectedEvent)}
                onEdit={() => requestEdit(selectedEvent)}
              />
              <div style={{ padding: 16 }}>
                {calendarsPanel}
                {remindersPanel}
                {tasksPanel}
              </div>
            </div>
          ) : (
            <div className={styles.sidebarSection}>
              {calendarsPanel}
              {remindersPanel}
              {tasksPanel}
            </div>
          )}
        </div>
      </div>

      {/* New event modal */}
      {showNewEvent && (
        <NewEventModal
          defaultDate={newEventDate}
          prefill={icsPrefill}
          calendars={calendars}
          onClose={() => { setShowNewEvent(false); setIcsPrefill(undefined); }}
          onCreate={(req, reminderOffsets, pendingAttachments) => createEvent.mutate({ req, reminderOffsets, pendingAttachments })}
          isPending={createEvent.isPending}
        />
      )}

      {/* View event modal */}
      {viewingEvent && (
        <EventViewModal
          event={viewingEvent}
          calendar={calendarOf(viewingEvent, calendarsById)}
          readOnly={isReadOnlyEvent(viewingEvent, calendarsById)}
          onClose={() => setViewingEvent(null)}
          onEdit={() => { requestEdit(viewingEvent); setViewingEvent(null); }}
          onDelete={() => requestDelete(viewingEvent)}
        />
      )}

      {/* Edit event modal */}
      {editingEvent && (
        <NewEventModal
          key={`${editingEvent.form.id}-${editingEvent.scope ?? 'one-off'}`}
          defaultDate={new Date(editingEvent.form.startTime)}
          existingEvent={editingEvent.form}
          scope={editingEvent.scope}
          calendars={calendars}
          onClose={() => setEditingEvent(null)}
          onCreate={() => { /* unused in edit mode — onUpdate handles saves */ }}
          onUpdate={(req) => updateEvent.mutate({ edit: editingEvent, req })}
          isPending={updateEvent.isPending}
        />
      )}

      {/* Which occurrences of a repeating event or reminder an edit or delete is for */}
      {scopePrompt && (
        <RecurrenceScopeModal
          action={scopePrompt.action}
          kind={scopePrompt.kind}
          onChoose={chooseScope}
          onClose={() => setScopePrompt(null)}
        />
      )}

      {/* Task editor — reminders, calendar scheduling and attachments */}
      {editingTask && (
        <TaskDetailModal
          key={editingTask.id}
          task={allTasks.find((t) => t.id === editingTask.id) ?? editingTask}
          knownTags={allTags(allTasks)}
          onClose={() => setEditingTask(null)}
          onSave={(id, req) => updateTask.mutateAsync({ id, req })}
        />
      )}

      {/* Reminder create/edit modal */}
      {reminderModal.open && (
        <ReminderModal
          initial={reminderModal.editing ?? undefined}
          scope={reminderModal.scope}
          onClose={() => setReminderModal({ open: false, editing: null })}
          onSave={(data) => {
            if (reminderModal.editing && reminderModal.scope === 'this') {
              editReminderOccurrence.mutate({ id: reminderModal.editing.id, req: data as UpdateReminderRequest });
            } else if (reminderModal.editing) {
              updateReminder.mutate({ id: reminderModal.editing.id, req: data as UpdateReminderRequest });
            } else {
              createReminder.mutate(data as CreateReminderRequest);
            }
          }}
          isPending={createReminder.isPending || updateReminder.isPending || editReminderOccurrence.isPending}
        />
      )}
    </div>
  );
}
