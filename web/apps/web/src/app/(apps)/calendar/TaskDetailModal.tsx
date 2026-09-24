'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { Button, Modal, ModalHeader, ModalBody, ModalFooter } from '@neutrino/ui';
import {
  calendarApi,
  type CreateAttachmentRequest,
  type TaskResponse,
  type UpdateTaskRequest,
} from '@/lib/api';
import { AddAttachmentModal, AttachmentItem } from './EventDetail';
import styles from './page.module.css';

/** An hour, the length a task gets when it is first put on the calendar. */
const DEFAULT_SLOT_MINUTES = 60;

export interface TaskDetailModalProps {
  task: TaskResponse;
  onClose: () => void;
  /** Applied to the task row itself; scheduling has its own endpoints. */
  onSave: (id: string, req: UpdateTaskRequest) => Promise<TaskResponse>;
}

/**
 * The task editor: the one place a task is more than a line of text.
 *
 * Three things live here and each is written through its own endpoint rather
 * than through the form's Save, because each needs the task to already exist
 * and the task always does by the time this opens — the sidebar creates it
 * first, including on ⌘/Ctrl+Enter. So reminders and attachments are added and
 * removed the moment the user asks, and Save applies only the fields on the
 * task row plus the schedule.
 */
export default function TaskDetailModal({ task, onClose, onSave }: TaskDetailModalProps) {
  const qc = useQueryClient();

  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [dueDate, setDueDate] = useState(() => task.dueDate?.slice(0, 10) ?? '');
  const [error, setError] = useState('');

  const [onCalendar, setOnCalendar] = useState(Boolean(task.eventId));
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState(() => defaultStart(task));
  const [end, setEnd] = useState(() => addMinutes(defaultStart(task), DEFAULT_SLOT_MINUTES));

  const [showAddAttachment, setShowAddAttachment] = useState(false);
  const [newReminderAt, setNewReminderAt] = useState('');

  // ── The event an already-scheduled task is on ─────────────────────────────
  //
  // Without this the form would open showing a default slot and Save would move
  // the event to it — a dialog that changes what it is describing just by being
  // opened. Seeded once, so a refetch cannot overwrite what is being edited.

  const { data: linkedEvent } = useQuery({
    queryKey: ['event', task.eventId],
    queryFn: () => calendarApi.getEvent(task.eventId as string),
    enabled: Boolean(task.eventId),
  });

  const seededFromEvent = useRef(false);
  useEffect(() => {
    if (!linkedEvent || seededFromEvent.current) return;
    seededFromEvent.current = true;
    setAllDay(linkedEvent.allDay);
    setStart(toFormValue(linkedEvent.startTime, linkedEvent.allDay));
    setEnd(toFormValue(linkedEvent.endTime, linkedEvent.allDay));
  }, [linkedEvent]);

  // ── Reminders ─────────────────────────────────────────────────────────────

  const { data: remindersData } = useQuery({
    queryKey: ['reminders', 'task', task.id],
    queryFn: () => calendarApi.listTaskReminders(task.id),
  });
  const reminders = remindersData?.reminders ?? [];

  const invalidateReminders = () => {
    qc.invalidateQueries({ queryKey: ['reminders', 'task', task.id] });
    // The sidebar's standalone list is every reminder with no owner, so it has
    // to re-read when a task gains or loses one.
    qc.invalidateQueries({ queryKey: ['reminders'] });
  };

  const createReminder = useMutation({
    mutationFn: (dueTime: string) =>
      calendarApi.createReminder({ title: title.trim() || task.title, dueTime, linkedTaskId: task.id }),
    onSuccess: () => {
      setNewReminderAt('');
      invalidateReminders();
    },
  });

  const deleteReminder = useMutation({
    mutationFn: (id: string) => calendarApi.deleteReminder(id),
    onSuccess: invalidateReminders,
  });

  // ── Attachments ───────────────────────────────────────────────────────────

  const { data: attachmentsData } = useQuery({
    queryKey: ['taskAttachments', task.id],
    queryFn: () => calendarApi.listTaskAttachments(task.id),
  });
  const attachments = attachmentsData?.attachments ?? [];

  const createAttachment = useMutation({
    mutationFn: (req: CreateAttachmentRequest) => calendarApi.createTaskAttachment(task.id, req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['taskAttachments', task.id] });
      setShowAddAttachment(false);
    },
  });

  const deleteAttachment = useMutation({
    mutationFn: (attachmentId: string) => calendarApi.deleteTaskAttachment(task.id, attachmentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['taskAttachments', task.id] }),
  });

  // ── Save ──────────────────────────────────────────────────────────────────

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = title.trim();
      if (!trimmed) throw new Error('A task needs a title');

      // `null` rather than an omitted field: the API reads an absent field as
      // "leave it alone", so emptying a box has to say so explicitly.
      await onSave(task.id, {
        title: trimmed,
        notes: notes.trim() || null,
        dueDate: dueDate ? `${dueDate}T00:00:00Z` : null,
      });

      // Scheduling is deliberately after the task write: the event carries the
      // task's title, and the server reads it from the stored row.
      if (onCalendar) {
        await calendarApi.scheduleTask(task.id, {
          startTime: allDay ? `${start.slice(0, 10)}T00:00:00Z` : new Date(start).toISOString(),
          endTime: allDay ? `${end.slice(0, 10)}T23:59:59Z` : new Date(end).toISOString(),
          allDay,
          timezone: allDay ? null : Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      } else if (task.eventId) {
        await calendarApi.unscheduleTask(task.id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['events'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message || 'Could not save this task.'),
  });

  /** Moving the start keeps the slot's length rather than inverting it. */
  function handleStartChange(next: string) {
    const previous = new Date(start).getTime();
    const lengthMs = new Date(end).getTime() - previous;
    setStart(next);
    if (Number.isFinite(lengthMs) && lengthMs > 0) {
      setEnd(addMinutes(next, lengthMs / 60_000));
    }
  }

  return (
    <>
      <Modal open onClose={onClose} size="md">
        <ModalHeader title="Edit Task" onClose={onClose} />
        <ModalBody>
          <form
            id="task-detail-form"
            onSubmit={(e) => {
              e.preventDefault();
              setError('');
              save.mutate();
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="task-title">Title</label>
              <input
                id="task-title"
                className={styles.formInput}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="task-notes">Notes</label>
              <textarea
                id="task-notes"
                className={`${styles.formInput} ${styles.formTextarea}`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                rows={3}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="task-due">Due date</label>
              <input
                id="task-due"
                className={styles.formInput}
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            {/* ── Calendar ─────────────────────────────────────────────────── */}
            <div className={styles.formGroup}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  id="task-on-calendar"
                  checked={onCalendar}
                  onChange={(e) => setOnCalendar(e.target.checked)}
                />
                <label htmlFor="task-on-calendar" className={styles.formLabel} style={{ margin: 0 }}>
                  Add to calendar
                </label>
              </div>

              {onCalendar && (
                <>
                  <div className={styles.formRow} style={{ marginTop: 8 }}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel} htmlFor="task-start">Start</label>
                      <input
                        id="task-start"
                        className={styles.formInput}
                        type={allDay ? 'date' : 'datetime-local'}
                        value={allDay ? start.slice(0, 10) : start}
                        onChange={(e) =>
                          handleStartChange(allDay ? `${e.target.value}T09:00` : e.target.value)
                        }
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel} htmlFor="task-end">End</label>
                      <input
                        id="task-end"
                        className={styles.formInput}
                        type={allDay ? 'date' : 'datetime-local'}
                        value={allDay ? end.slice(0, 10) : end}
                        onChange={(e) =>
                          setEnd(allDay ? `${e.target.value}T10:00` : e.target.value)
                        }
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <input
                      type="checkbox"
                      id="task-all-day"
                      checked={allDay}
                      onChange={(e) => setAllDay(e.target.checked)}
                    />
                    <label htmlFor="task-all-day" className={styles.formLabel} style={{ margin: 0 }}>
                      All day
                    </label>
                  </div>
                </>
              )}
            </div>

            {/* ── Reminders ────────────────────────────────────────────────── */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Reminders</label>
              {reminders.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                  None
                </div>
              )}
              {reminders.map((r) => (
                <div key={r.id} className={styles.detailReminderRow}>
                  <span style={{ fontSize: 12, flex: 1 }}>
                    {new Date(r.dueTime).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                  <button
                    type="button"
                    className={`${styles.reminderActionBtn} ${styles.reminderActionDelete}`}
                    onClick={() => deleteReminder.mutate(r.id)}
                    title="Remove reminder"
                    aria-label="Remove reminder"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input
                  className={styles.formInput}
                  type="datetime-local"
                  aria-label="Remind me at"
                  value={newReminderAt}
                  onChange={(e) => setNewReminderAt(e.target.value)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!newReminderAt || createReminder.isPending}
                  onClick={() =>
                    createReminder.mutate(new Date(newReminderAt).toISOString())
                  }
                >
                  Add
                </Button>
              </div>
            </div>

            {/* ── Attachments ──────────────────────────────────────────────── */}
            <div className={styles.formGroup}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label className={styles.formLabel}>Attachments</label>
                <button
                  type="button"
                  className={styles.reminderNewBtn}
                  onClick={() => setShowAddAttachment(true)}
                  title="Add attachment"
                  aria-label="Add attachment"
                >
                  <Plus size={12} />
                </button>
              </div>
              {attachments.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                  None
                </div>
              )}
              {attachments.map((a) => (
                <AttachmentItem
                  key={a.id}
                  attachment={a}
                  onDelete={() => deleteAttachment.mutate(a.id)}
                />
              ))}
            </div>

            {error && <div className={styles.taskUploadError}>{error}</div>}
          </form>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button form="task-detail-form" type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </ModalFooter>
      </Modal>

      {showAddAttachment && (
        <AddAttachmentModal
          onClose={() => setShowAddAttachment(false)}
          onCreate={(req) => createAttachment.mutate(req)}
          isPending={createAttachment.isPending}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Date helpers — `datetime-local` wants a local wall-clock string, not an ISO
// instant, so every value here is in the browser's own zone until it is sent.
// ---------------------------------------------------------------------------

function toLocalInput(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/**
 * An all-day event's stored time is a calendar date, not an instant, so it is
 * read off the string rather than through `Date` — which would shift it a day
 * west of UTC.
 */
function toFormValue(iso: string, allDay: boolean): string {
  if (allDay) return `${iso.slice(0, 10)}T09:00`;
  return toLocalInput(new Date(iso));
}

/**
 * A task being put on the calendar for the first time starts at its due date,
 * or at the next hour when it has none — the due date is the answer the user
 * has already given to "when?".
 */
function defaultStart(task: TaskResponse): string {
  if (task.dueDate) {
    const due = new Date(task.dueDate);
    if (!Number.isNaN(due.getTime())) {
      due.setHours(9, 0, 0, 0);
      return toLocalInput(due);
    }
  }
  const next = new Date();
  next.setHours(next.getHours() + 1, 0, 0, 0);
  return toLocalInput(next);
}

function addMinutes(localValue: string, minutes: number): string {
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return localValue;
  d.setMinutes(d.getMinutes() + minutes);
  return toLocalInput(d);
}
