'use client';

import React, { useState } from 'react';
import { Button, Modal, ModalHeader, ModalBody, ModalFooter } from '@neutrino/ui';
import type { CreateReminderRequest, UpdateReminderRequest } from '@/lib/api';
import type { ReminderModalProps } from './calendarTypes';
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

  const [title, setTitle] = useState(initial?.title ?? '');
  const [dueTime, setDueTime] = useState(() =>
    initial ? toLocal(initial.dueTime) : defaultDue()
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title: title.trim(), dueTime: new Date(dueTime).toISOString() });
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
