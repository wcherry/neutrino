import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal, ModalBody, ModalHeader } from './Modal';

/**
 * Two inputs inside a modal whose `onClose` is an inline arrow — the shape every
 * real caller has. Typing re-renders the parent, so `onClose` gets a fresh
 * identity on each keystroke.
 */
function TwoFieldDialog() {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [open, setOpen] = useState(true);
  return (
    <Modal open={open} onClose={() => setOpen(false)} closeOnBackdrop={false}>
      <ModalHeader>Protect your encryption key</ModalHeader>
      <ModalBody>
        <input aria-label="First" value={first} onChange={(e) => setFirst(e.target.value)} />
        <input aria-label="Second" value={second} onChange={(e) => setSecond(e.target.value)} />
      </ModalBody>
    </Modal>
  );
}

describe('Modal focus handling', () => {
  it('focuses the first focusable element on open', async () => {
    render(<TwoFieldDialog />);
    expect(document.activeElement).toBe(screen.getByLabelText('First'));
  });

  it('keeps focus in the field being typed into across re-renders', async () => {
    const user = userEvent.setup();
    render(<TwoFieldDialog />);

    const second = screen.getByLabelText('Second') as HTMLInputElement;
    await user.click(second);
    await user.type(second, 'hunter2');

    expect(second.value).toBe('hunter2');
    expect(document.activeElement).toBe(second);
    expect((screen.getByLabelText('First') as HTMLInputElement).value).toBe('');
  });
});
