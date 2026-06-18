/**
 * Unit tests for WatermarkModal component.
 *
 * Covers:
 *   - Renders with initial watermark text
 *   - Typing in the watermark input updates the value
 *   - Apply calls onSave with the current values
 *   - Reset button sets background color to #ffffff (empty string in save)
 *   - Cancel calls onClose without calling onSave
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('../../app/(apps)/docs/editor/page.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

import { WatermarkModal } from '../../app/(apps)/docs/editor/WatermarkModal';

const defaultProps = {
  watermarkText: 'DRAFT',
  bgColor: '',
  onSave: vi.fn(),
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WatermarkModal', () => {
  it('renders with initial watermark text', () => {
    render(<WatermarkModal {...defaultProps} />);
    // The watermark text input
    const inputs = screen.getAllByRole('textbox');
    const wmInput = inputs.find(i => (i as HTMLInputElement).value === 'DRAFT');
    expect(wmInput).toBeTruthy();
  });

  it('updates watermark input on change', () => {
    render(<WatermarkModal {...defaultProps} />);
    const inputs = screen.getAllByRole('textbox');
    const wmInput = inputs.find(i => (i as HTMLInputElement).value === 'DRAFT')!;
    fireEvent.change(wmInput, { target: { value: 'CONFIDENTIAL' } });
    expect((wmInput as HTMLInputElement).value).toBe('CONFIDENTIAL');
  });

  it('clicking Apply calls onSave', () => {
    render(<WatermarkModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Apply'));
    expect(defaultProps.onSave).toHaveBeenCalled();
  });

  it('clicking Apply passes watermark text to onSave', () => {
    render(<WatermarkModal {...defaultProps} watermarkText="TEST" />);
    fireEvent.click(screen.getByText('Apply'));
    const [savedWm] = (defaultProps.onSave as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(savedWm).toBe('TEST');
  });

  it('clicking Cancel calls onClose without calling onSave', () => {
    render(<WatermarkModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onClose).toHaveBeenCalled();
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });

  it('Reset button resets bg to white (empty string in save)', () => {
    render(<WatermarkModal {...defaultProps} bgColor="#ff0000" />);
    fireEvent.click(screen.getByText('Reset'));
    fireEvent.click(screen.getByText('Apply'));
    const [, savedBg] = (defaultProps.onSave as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    // #ffffff is the "white" sentinel that gets saved as empty string
    expect(savedBg).toBe('');
  });
});
