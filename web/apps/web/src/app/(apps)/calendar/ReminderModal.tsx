'use client';

import React, { useState } from 'react';
import { Button, Modal, ModalHeader, ModalBody, ModalFooter } from '@neutrino/ui';
import type { CreateReminderRequest, UpdateReminderRequest } from '@/lib/api';
import type { ReminderModalProps } from './calendarTypes';
import { buildRepeatRule, parseRepeatRule, type RepeatRule } from './repeatRule';
import RepeatFields from './RepeatFields';
import { scopeLabel } from './RecurrenceScopeModal';
import styles from './page.module.css';

export default function ReminderModal({ initial, scope, onClose, onSave, isPending }: ReminderModalProps) {
  // One occurrence on its own doesn't repeat.
  const showsRepeat = scope !== 'this';
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
  // The form's times are the browser's, so its zone is the one a repeat's end date is read in.
  const repeatContext = { allDay: false, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  const [repeat, setRepeat] = useState<RepeatRule | null>(() =>
    initialRule ? parseRepeatRule(initialRule, repeatContext) : null);
  // Until the repeat is changed, the stored rule stands exactly as it was, so opening and saving
  // a reminder never rewrites a rule from the iOS app, a synced calendar or the API.
  const [repeatTouched, setRepeatTouched] = useState(false);

  const recurrence = !repeatTouched ? initialRule : repeat ? buildRepeatRule(repeat, repeatContext) : '';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (repeat?.end.kind === 'on' && repeat.end.date < dueTime.slice(0, 10)) return;
    const base = { title: title.trim(), dueTime: new Date(dueTime).toISOString() };
    if (!initial) {
      onSave({ ...base, recurrenceRule: recurrence || null } satisfies CreateReminderRequest);
      return;
    }
    // Sent only when changed, and as '' to clear it: the server reads an absent field as
    // "leave alone", so there is no other way to say "stop repeating".
    const req: UpdateReminderRequest = { ...base };
    if (showsRepeat && recurrence !== initialRule) req.recurrenceRule = recurrence;
    onSave(req);
  }

  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title={initial ? 'Edit Reminder' : 'New Reminder'} onClose={onClose} />
      <ModalBody>
        <form id="reminder-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {scope && <div className={styles.formHint} data-testid="edit-scope">Saving to: {scopeLabel(scope, 'reminder')}</div>}
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
          {showsRepeat && (
            <>
              <RepeatFields
                rule={repeat}
                customRule={!repeatTouched && !repeat && initialRule ? initialRule : null}
                start={dueTime}
                onChange={(rule) => {
                  setRepeat(rule);
                  setRepeatTouched(true);
                }}
              />
              {recurrence && (
                <div className={styles.formHint}>Completing it moves it to the next time it&apos;s due.</div>
              )}
            </>
          )}
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
