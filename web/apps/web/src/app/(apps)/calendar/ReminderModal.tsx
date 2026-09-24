'use client';

import React, { useState } from 'react';
import { Button, Modal, ModalHeader, ModalBody, ModalFooter } from '@neutrino/ui';
import type { CreateReminderRequest, UpdateReminderRequest } from '@/lib/api';
import type { ReminderModalProps } from './calendarTypes';
import { REPEAT_OPTIONS } from './calendarConstants';
import styles from './page.module.css';

export default function ReminderModal({ initial, onClose, onSave, isPending }: ReminderModalProps) {
  const toLocal = (iso: string) =>
    new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);

  const defaultDue = () => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return toLocal(d.toISOString());
  };

  const initialRule = initial?.recurrenceRule ?? '';
  const [title, setTitle] = useState(initial?.title ?? '');
  const [dueTime, setDueTime] = useState(() =>
    initial ? toLocal(initial.dueTime) : defaultDue()
  );
  const [recurrence, setRecurrence] = useState(initialRule);

  // A rule written somewhere else (the iOS app, a synced calendar, the API) that isn't one of the
  // standard choices is offered as it is, so opening and saving a reminder never rewrites it.
  const isCustomRule = initialRule !== '' && !REPEAT_OPTIONS.some((o) => o.value === initialRule);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const base = { title: title.trim(), dueTime: new Date(dueTime).toISOString() };
    if (!initial) {
      onSave({ ...base, recurrenceRule: recurrence || null } satisfies CreateReminderRequest);
      return;
    }
    // Sent only when changed, and as '' to clear it: the server reads an absent field as
    // "leave alone", so there is no other way to say "stop repeating".
    const req: UpdateReminderRequest = { ...base };
    if (recurrence !== initialRule) req.recurrenceRule = recurrence;
    onSave(req);
  }

  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title={initial ? 'Edit Reminder' : 'New Reminder'} onClose={onClose} />
      <ModalBody>
        <form id="reminder-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Title</label>
            <input
              className={styles.formInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Reminder title"
              autoFocus
              required
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Due</label>
            <input
              className={styles.formInput}
              type="datetime-local"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="reminder-repeat">Repeats</label>
            <select
              id="reminder-repeat"
              className={styles.formInput}
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
            >
              {REPEAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
              {isCustomRule && <option value={initialRule}>Custom ({initialRule})</option>}
            </select>
            {recurrence && (
              <div className={styles.formHint}>Completing it moves it to the next time it&apos;s due.</div>
            )}
          </div>
        </form>
      </ModalBody>
      <ModalFooter>
        <Button type="button" onClick={onClose}>Cancel</Button>
        <Button form="reminder-form" type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : initial ? 'Save' : 'Create Reminder'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
