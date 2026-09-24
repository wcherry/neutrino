/**
 * Tests for ReminderModal's repeat field.
 *
 * The server moves a completed repeating reminder to its next occurrence, so what this form sends
 * as `recurrenceRule` is behaviour, not decoration: a new reminder sends its rule or null, and an
 * edit sends the rule only when it changed, as '' to stop repeating.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ReminderModal from '../../app/(apps)/calendar/ReminderModal';
import type { ReminderResponse } from '../../lib/api';

vi.mock('@neutrino/ui', () => ({
  Modal: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="modal">{children}</div> : null,
  ModalHeader: ({ title }: { title: string }) => <span data-testid="modal-title">{title}</span>,
  ModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick, type, form, disabled }: {
    children: React.ReactNode;
    onClick?: () => void;
    type?: string;
    form?: string;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} type={(type as 'button' | 'submit' | 'reset') ?? 'button'} form={form} disabled={disabled}>
      {children}
    </button>
  ),
}));

function existing(recurrenceRule: string | null): ReminderResponse {
  return {
    id: 'r1',
    title: 'Take vitamins',
    dueTime: '2026-09-24T16:00:00Z',
    completed: false,
    recurrenceRule,
    linkedEventId: null,
    linkedTaskId: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };
}

function renderModal(initial?: ReminderResponse) {
  const onSave = vi.fn();
  render(<ReminderModal initial={initial} onClose={vi.fn()} onSave={onSave} isPending={false} />);
  return onSave;
}

const repeat = () => screen.getByLabelText('Repeats') as HTMLSelectElement;
const submit = () => fireEvent.submit(document.getElementById('reminder-form')!);

describe('ReminderModal repeat field', () => {
  it('offers the same choices as the event form, defaulting to not repeating', () => {
    renderModal();
    expect(Array.from(repeat().options).map((o) => o.textContent)).toEqual([
      'Does not repeat', 'Daily', 'Weekly', 'Monthly', 'Yearly', 'Every weekday (Mon–Fri)',
    ]);
    expect(repeat().value).toBe('');
  });

  it('creates a one-off reminder with a null rule', () => {
    const onSave = renderModal();
    fireEvent.change(screen.getByPlaceholderText('Reminder title'), { target: { value: 'Call Mum' } });
    submit();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Call Mum', recurrenceRule: null }));
  });

  it('creates a repeating reminder with its rule, and says what completing it will do', () => {
    const onSave = renderModal();
    fireEvent.change(screen.getByPlaceholderText('Reminder title'), { target: { value: 'Stretch' } });
    fireEvent.change(repeat(), { target: { value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' } });
    expect(screen.getByText(/moves it to the next time it/)).toBeTruthy();
    submit();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' })
    );
  });

  it('shows an existing rule and leaves it out of an edit that does not change it', () => {
    const onSave = renderModal(existing('FREQ=DAILY'));
    expect(repeat().value).toBe('FREQ=DAILY');
    submit();
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('recurrenceRule');
  });

  it('clears a rule with an empty string, which the server reads as "stop repeating"', () => {
    const onSave = renderModal(existing('FREQ=DAILY'));
    fireEvent.change(repeat(), { target: { value: '' } });
    submit();
    expect(onSave.mock.calls[0][0]).toHaveProperty('recurrenceRule', '');
  });

  it('keeps a rule it has no choice for, rather than rewriting it on save', () => {
    const onSave = renderModal(existing('FREQ=MONTHLY;INTERVAL=3'));
    expect(repeat().value).toBe('FREQ=MONTHLY;INTERVAL=3');
    expect(screen.getByText('Custom (FREQ=MONTHLY;INTERVAL=3)')).toBeTruthy();
    submit();
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('recurrenceRule');
  });
});
