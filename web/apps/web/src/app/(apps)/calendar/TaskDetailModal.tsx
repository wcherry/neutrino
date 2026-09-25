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
import {
  describeRepeat,
  formatEstimate,
  formatSmartDate,
  parseEstimate,
  parseFriendlyDate,
  parseRepeat,
  smartDateFromWire,
  smartDateToWire,
  type SmartDate,
} from './smartAdd';
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
  const due = useParsedField<SmartDate>(
    task.dueDate ? smartDateFromWire(task.dueDate, Boolean(task.dueHasTime)) : null,
    formatSmartDate,
    (text) => parseFriendlyDate(text),
  );
  const startDate = useParsedField<SmartDate>(
    task.startDate ? smartDateFromWire(task.startDate, Boolean(task.startHasTime)) : null,
    formatSmartDate,
    (text) => parseFriendlyDate(text),
  );
  const repeat = useParsedField<{ rule: string; after: boolean }>(
    task.recurrenceRule
      ? { rule: task.recurrenceRule, after: Boolean(task.repeatAfterCompletion) }
      : null,
    (r) => describeRepeat(r.rule, r.after),
    parseRepeat,
  );
  const estimate = useParsedField<number>(task.estimateMinutes ?? null, formatEstimate, parseEstimate);
  const [priority, setPriority] = useState<number | null>(task.priority ?? null);
  const [tagsText, setTagsText] = useState(() => (task.tags ?? []).map((t) => `#${t}`).join(' '));
  const [location, setLocation] = useState(task.location ?? '');
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
      for (const [field, label] of [[due, 'due date'], [startDate, 'start date'], [repeat, 'repeat'], [estimate, 'estimate']] as const) {
        if (field.invalid) throw new Error(`Couldn't read the ${label} "${field.text.trim()}"`);
      }

      const dueWire = due.value ? smartDateToWire(due.value) : null;
      const startWire = startDate.value ? smartDateToWire(startDate.value) : null;

      // `null` rather than an omitted field: the API reads an absent field as
      // "leave it alone", so emptying a box has to say so explicitly.
      await onSave(task.id, {
        title: trimmed,
        notes: notes.trim() || null,
        dueDate: dueWire?.iso ?? null,
        dueHasTime: dueWire?.hasTime ?? false,
        startDate: startWire?.iso ?? null,
        startHasTime: startWire?.hasTime ?? false,
        priority,
        estimateMinutes: estimate.value,
        location: location.trim() || null,
        recurrenceRule: repeat.value?.rule ?? null,
        repeatAfterCompletion: repeat.value?.after ?? false,
        tags: parseTags(tagsText),
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

            <div className={styles.formRow}>
              <FriendlyDateField id="task-due" label="Due date" field={due} placeholder="e.g. next fri 3pm" />
              <FriendlyDateField id="task-start-date" label="Start date" field={startDate} placeholder="e.g. today" />
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel} htmlFor="task-priority">Priority</label>
                <select
                  id="task-priority"
                  className={styles.formInput}
                  value={priority ?? ''}
                  onChange={(e) => setPriority(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">None</option>
                  <option value="1">1 — High</option>
                  <option value="2">2 — Medium</option>
                  <option value="3">3 — Low</option>
                </select>
              </div>
              <ParsedTextField
                id="task-estimate"
                label="Estimate"
                field={estimate}
                placeholder="e.g. 1h30m"
                describe={formatEstimate}
              />
            </div>

            <ParsedTextField
              id="task-repeat"
              label="Repeat"
              field={repeat}
              placeholder="e.g. every mon and thu, after 2 weeks"
              describe={(r) => describeRepeat(r.rule, r.after) + (r.after ? ', from when it is completed' : '')}
            />

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel} htmlFor="task-tags">Tags</label>
                <input
                  id="task-tags"
                  className={styles.formInput}
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  placeholder="#errands #home"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel} htmlFor="task-location">Location</label>
                <input
                  id="task-location"
                  className={styles.formInput}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Optional"
                />
              </div>
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

// ── Friendly fields ───────────────────────────────────────────────────────

/**
 * A text box read by a parser: "next fri 3pm", "every other week", "1h30m".
 *
 * What was typed and what it means are kept apart. The box opens showing the
 * stored value formatted for reading, which need not parse back — "Fri, Oct 2"
 * is not something the grammar reads — so the stored value is kept until the
 * text is actually edited, and only then re-read from it.
 */
interface ParsedField<T> {
  text: string;
  value: T | null;
  /** Something is typed and it doesn't parse. */
  invalid: boolean;
  setText: (text: string) => void;
  setValue: (value: T | null) => void;
}

function useParsedField<T>(
  initial: T | null,
  format: (value: T) => string,
  parse: (text: string) => T | null,
): ParsedField<T> {
  const [text, setTextState] = useState(() => (initial === null ? '' : format(initial)));
  const [value, setValueState] = useState<T | null>(initial);
  const [invalid, setInvalid] = useState(false);
  return {
    text,
    value,
    invalid,
    setText: (next) => {
      setTextState(next);
      if (!next.trim()) {
        setValueState(null);
        setInvalid(false);
        return;
      }
      const parsed = parse(next);
      setValueState(parsed);
      setInvalid(parsed === null);
    },
    setValue: (next) => {
      setValueState(next);
      setTextState(next === null ? '' : format(next));
      setInvalid(false);
    },
  };
}

function ParsedTextField<T>({
  id,
  label,
  field,
  placeholder,
  describe,
  children,
}: {
  id: string;
  label: string;
  field: ParsedField<T>;
  placeholder: string;
  describe: (value: T) => string;
  children?: React.ReactNode;
}) {
  const [edited, setEdited] = useState(false);
  return (
    <div className={styles.formGroup}>
      <label className={styles.formLabel} htmlFor={id}>{label}</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          id={id}
          className={styles.formInput}
          value={field.text}
          onChange={(e) => {
            setEdited(true);
            field.setText(e.target.value);
          }}
          placeholder={placeholder}
          aria-invalid={field.invalid}
          aria-describedby={`${id}-feedback`}
          style={{ flex: 1, minWidth: 0 }}
        />
        {children}
      </div>
      <div
        id={`${id}-feedback`}
        className={styles.taskComposerHint}
        style={field.invalid ? { color: 'var(--color-danger, #dc2626)' } : undefined}
      >
        {field.invalid
          ? "Couldn't read that"
          : edited && field.value !== null
            ? describe(field.value)
            : '\u00a0'}
      </div>
    </div>
  );
}

/** A friendly date box, with a date picker beside it for anyone who would rather click. */
function FriendlyDateField({
  id,
  label,
  field,
  placeholder,
}: {
  id: string;
  label: string;
  field: ParsedField<SmartDate>;
  placeholder: string;
}) {
  return (
    <ParsedTextField id={id} label={label} field={field} placeholder={placeholder} describe={formatSmartDate}>
      <input
        type="date"
        className={styles.formInput}
        aria-label={`Pick ${label.toLowerCase()}`}
        value={field.value?.date ?? ''}
        onChange={(e) =>
          field.setValue(e.target.value ? { date: e.target.value, time: field.value?.time ?? null } : null)
        }
        style={{ width: 36, padding: '6px 4px', flex: 'none' }}
      />
    </ParsedTextField>
  );
}

/** "#errands home, #Work" → ["errands", "home", "work"]. */
function parseTags(text: string): string[] {
  const tags = text
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#+/, '').toLowerCase())
    .filter(Boolean);
  return [...new Set(tags)];
}
