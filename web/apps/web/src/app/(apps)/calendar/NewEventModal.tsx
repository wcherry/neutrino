'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, UserPlus, X, Paperclip } from 'lucide-react';
import { Button, Modal, ModalHeader, ModalBody, ModalFooter } from '@neutrino/ui';
import { calendarApi, type CreateAttachmentRequest } from '@/lib/api';
import type { NewEventModalProps, ReminderEntry } from './calendarTypes';
import { REMINDER_PRESETS } from './calendarConstants';
import { AddAttachmentModal, AttachmentItem } from './EventDetail';
import styles from './page.module.css';

export default function NewEventModal({ defaultDate, prefill, existingEvent, onClose, onCreate, onUpdate, isPending }: NewEventModalProps) {
  const isEditMode = existingEvent !== undefined;

  const toLocal = (d: Date) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  const [title, setTitle] = useState(existingEvent?.title ?? prefill?.title ?? '');
  const [description, setDescription] = useState(existingEvent?.description ?? prefill?.description ?? '');
  const [start, setStart] = useState(() => {
    if (existingEvent?.startTime) {
      return existingEvent.allDay
        ? existingEvent.startTime.slice(0, 10)
        : toLocal(new Date(existingEvent.startTime));
    }
    if (prefill?.startTime) return toLocal(new Date(prefill.startTime));
    return toLocal(defaultDate);
  });
  const [end, setEnd] = useState(() => {
    if (existingEvent?.endTime) {
      return existingEvent.allDay
        ? existingEvent.endTime.slice(0, 10)
        : toLocal(new Date(existingEvent.endTime));
    }
    if (prefill?.endTime) return toLocal(new Date(prefill.endTime));
    const d = new Date(defaultDate);
    d.setHours(d.getHours() + 1);
    return toLocal(d);
  });
  const [allDay, setAllDay] = useState(existingEvent?.allDay ?? prefill?.allDay ?? false);
  const [recurrence, setRecurrence] = useState<string>(existingEvent?.recurrenceRule ?? '');
  const [location, setLocation] = useState(existingEvent?.location ?? prefill?.location ?? '');
  const [attendees, setAttendees] = useState<string[]>(existingEvent?.attendees ?? prefill?.attendees ?? []);
  const [attendeeInput, setAttendeeInput] = useState('');
  const [reminders, setReminders] = useState<ReminderEntry[]>([]);
  const [showAddAttachment, setShowAddAttachment] = useState(false);
  // Pending attachments for create mode (no eventId yet — applied after event creation)
  const [pendingAttachments, setPendingAttachments] = useState<import('@/lib/api').CreateAttachmentRequest[]>([]);

  const qc = useQueryClient();
  const { data: attachmentsData } = useQuery({
    queryKey: ['attachments', existingEvent?.id],
    queryFn: () => calendarApi.listAttachments(existingEvent!.id),
    enabled: isEditMode,
  });
  const attachments = attachmentsData?.attachments ?? [];

  const createAttachment = useMutation({
    mutationFn: (req: CreateAttachmentRequest) => calendarApi.createAttachment(existingEvent!.id, req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attachments', existingEvent?.id] });
      setShowAddAttachment(false);
    },
  });

  const deleteAttachment = useMutation({
    mutationFn: (attachmentId: string) => calendarApi.deleteAttachment(existingEvent!.id, attachmentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attachments', existingEvent?.id] }),
  });

  function addAttendee() {
    const email = attendeeInput.trim().toLowerCase();
    if (!email || attendees.includes(email)) return;
    setAttendees((prev) => [...prev, email]);
    setAttendeeInput('');
  }

  function removeAttendee(email: string) {
    setAttendees((prev) => prev.filter((a) => a !== email));
  }

  function addReminder(minutes: number) {
    setReminders((prev) => [...prev, { id: crypto.randomUUID(), minutes }]);
  }

  function removeReminder(id: string) {
    setReminders((prev) => prev.filter((r) => r.id !== id));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const fields = {
      title: title.trim(),
      description: description.trim() || null,
      startTime: allDay ? `${start}T00:00:00Z` : new Date(start).toISOString(),
      endTime: allDay ? `${end}T23:59:59Z` : new Date(end).toISOString(),
      allDay,
      location: location.trim() || null,
      attendees,
      recurrenceRule: recurrence || null,
      timezone: allDay ? null : Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    if (isEditMode && existingEvent) {
      onUpdate?.(fields, existingEvent.id);
    } else {
      onCreate(fields, reminders.map((r) => r.minutes), pendingAttachments);
    }
  }

  const unusedPresets = REMINDER_PRESETS.filter(
    (p) => !reminders.some((r) => r.minutes === p.minutes)
  );

  return (
    <>
    <Modal open onClose={onClose} size="md">
      <ModalHeader title={isEditMode ? 'Edit Event' : 'New Event'} onClose={onClose} />
      <ModalBody>
        <form id="new-event-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Title */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Title</label>
            <input
              className={styles.formInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
              autoFocus
              required
            />
          </div>

          {/* Start / End */}
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Start</label>
              <input
                className={styles.formInput}
                type={allDay ? 'date' : 'datetime-local'}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>End</label>
              <input
                className={styles.formInput}
                type={allDay ? 'date' : 'datetime-local'}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          {/* All-day */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              id="allDay"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
            />
            <label htmlFor="allDay" className={styles.formLabel} style={{ margin: 0 }}>All day</label>
          </div>

          {/* Recurrence */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Repeats</label>
            <select
              className={styles.formInput}
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
            >
              <option value="">Does not repeat</option>
              <option value="FREQ=DAILY">Daily</option>
              <option value="FREQ=WEEKLY">Weekly</option>
              <option value="FREQ=MONTHLY">Monthly</option>
              <option value="FREQ=YEARLY">Yearly</option>
              <option value="FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR">Every weekday (Mon–Fri)</option>
            </select>
          </div>

          {/* Location */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Location</label>
            <input
              className={styles.formInput}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Optional"
            />
          </div>

          {/* Description */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Description</label>
            <textarea
              className={`${styles.formInput} ${styles.formTextarea}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              rows={3}
            />
          </div>

          {/* Attendees */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Guests</label>
            <div className={styles.attendeeInput}>
              <UserPlus size={14} className={styles.attendeeIcon} />
              <input
                className={styles.attendeeInputField}
                type="email"
                value={attendeeInput}
                onChange={(e) => setAttendeeInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAttendee(); } }}
                placeholder="Add guest email"
              />
              <button type="button" className={styles.attendeeAddBtn} onClick={addAttendee}>Add</button>
            </div>
            {attendees.length > 0 && (
              <div className={styles.attendeeList}>
                {attendees.map((email) => (
                  <div key={email} className={styles.attendeeChip}>
                    <span>{email}</span>
                    <button type="button" onClick={() => removeAttendee(email)} className={styles.attendeeRemoveBtn}>
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Attachments */}
          <div className={styles.formGroup}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label className={styles.formLabel}>Attachments</label>
              <button
                type="button"
                className={styles.reminderNewBtn}
                onClick={() => setShowAddAttachment(true)}
                title="Add attachment"
              >
                <Plus size={12} />
              </button>
            </div>

            {isEditMode ? (
              <>
                {attachments.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4 }}>None</div>
                )}
                {attachments.map((a) => (
                  <AttachmentItem
                    key={a.id}
                    attachment={a}
                    onDelete={() => deleteAttachment.mutate(a.id)}
                  />
                ))}
              </>
            ) : (
              <>
                {pendingAttachments.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4 }}>None</div>
                )}
                {pendingAttachments.map((a, i) => (
                  <div key={i} className={styles.detailAttachment}>
                    <Paperclip size={12} style={{ flexShrink: 0, color: 'var(--color-text-secondary)' }} />
                    <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                      {a.note ?? a.name ?? a.fileId}
                    </div>
                    <button
                      type="button"
                      className={`${styles.reminderActionBtn} ${styles.reminderActionDelete}`}
                      onClick={() => setPendingAttachments((prev) => prev.filter((_, j) => j !== i))}
                      title="Remove"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Reminders */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Reminders</label>
            {reminders.map((r) => {
              const preset = REMINDER_PRESETS.find((p) => p.minutes === r.minutes);
              return (
                <div key={r.id} className={styles.reminderEntry}>
                  <span className={styles.reminderEntryLabel}>{preset?.label ?? `${r.minutes} min before`}</span>
                  <button type="button" onClick={() => removeReminder(r.id)} className={styles.reminderEntryRemove}>
                    <X size={12} />
                  </button>
                </div>
              );
            })}
            {unusedPresets.length > 0 && (
              <select
                className={styles.formInput}
                value=""
                onChange={(e) => {
                  if (e.target.value !== '') addReminder(Number(e.target.value));
                }}
              >
                <option value="">+ Add reminder…</option>
                {unusedPresets.map((p) => (
                  <option key={p.minutes} value={p.minutes}>{p.label}</option>
                ))}
              </select>
            )}
          </div>
        </form>
      </ModalBody>
      <ModalFooter>
        <Button type="button" onClick={onClose}>Cancel</Button>
        <Button form="new-event-form" type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : isEditMode ? 'Save Changes' : 'Create Event'}
        </Button>
      </ModalFooter>
    </Modal>

    {showAddAttachment && (
      <AddAttachmentModal
        eventId={existingEvent?.id ?? ''}
        onClose={() => setShowAddAttachment(false)}
        onCreate={(req) => {
          if (isEditMode) {
            createAttachment.mutate(req);
          } else {
            setPendingAttachments((prev) => [...prev, req]);
            setShowAddAttachment(false);
          }
        }}
        isPending={isEditMode ? createAttachment.isPending : false}
      />
    )}
  </>
  );
}
