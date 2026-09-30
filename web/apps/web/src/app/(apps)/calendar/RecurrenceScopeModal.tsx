'use client';

import React from 'react';
import { Button, Modal, ModalHeader, ModalBody, ModalFooter } from '@neutrino/ui';
import styles from './page.module.css';

/**
 * Which occurrences of a repeating event or reminder an edit or delete is for. See
 * `agent_docs/recurrence-exceptions.md`.
 */
export type RecurrenceScope = 'this' | 'following' | 'all';

export interface RecurrenceScopeModalProps {
  action: 'edit' | 'delete';
  kind: 'event' | 'reminder';
  onChoose: (scope: RecurrenceScope) => void;
  onClose: () => void;
}

const SCOPES: RecurrenceScope[] = ['this', 'following', 'all'];

export function scopeLabel(scope: RecurrenceScope, kind: 'event' | 'reminder'): string {
  const noun = kind === 'event' ? 'event' : 'reminder';
  switch (scope) {
    case 'this': return `This ${noun}`;
    case 'following': return `This and following ${noun}s`;
    case 'all': return `All ${noun}s`;
  }
}

/** Asks, before an edit or delete of a repeating event or reminder, which occurrences it is for. */
export default function RecurrenceScopeModal({ action, kind, onChoose, onClose }: RecurrenceScopeModalProps) {
  const title = `${action === 'edit' ? 'Edit' : 'Delete'} repeating ${kind}`;
  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title={title} onClose={onClose} />
      <ModalBody>
        <div role="group" aria-label={title} className={styles.scopeChoices}>
          {SCOPES.map((scope) => (
            <Button
              key={scope}
              variant={action === 'delete' ? 'danger' : 'secondary'}
              onClick={() => onChoose(scope)}
            >
              {scopeLabel(scope, kind)}
            </Button>
          ))}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button type="button" onClick={onClose}>Cancel</Button>
      </ModalFooter>
    </Modal>
  );
}
