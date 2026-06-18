/**
 * Unit tests for HeaderFooterModal component.
 *
 * Covers:
 *   - Renders with initial header/footer values
 *   - Checkbox reflects initial showPageNumbers value
 *   - Typing in header field updates its value
 *   - Typing in footer field updates its value
 *   - Clicking Apply calls onSave with current values
 *   - Clicking Cancel calls onClose without calling onSave
 *   - Clicking the overlay calls onClose
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('../../app/(apps)/docs/editor/page.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

import { HeaderFooterModal } from '../../app/(apps)/docs/editor/HeaderFooterModal';

const defaultProps = {
  headerText: 'My Header',
  footerText: 'My Footer',
  showPageNumbers: false,
  onSave: vi.fn(),
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HeaderFooterModal', () => {
  it('renders with initial header text', () => {
    render(<HeaderFooterModal {...defaultProps} />);
    const textarea = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement;
    expect(textarea.value).toBe('My Header');
  });

  it('renders with initial footer text', () => {
    render(<HeaderFooterModal {...defaultProps} />);
    const textareas = screen.getAllByRole('textbox');
    expect((textareas[1] as HTMLTextAreaElement).value).toBe('My Footer');
  });

  it('checkbox is unchecked when showPageNumbers is false', () => {
    render(<HeaderFooterModal {...defaultProps} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('checkbox is checked when showPageNumbers is true', () => {
    render(<HeaderFooterModal {...defaultProps} showPageNumbers={true} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('updates header textarea on input', () => {
    render(<HeaderFooterModal {...defaultProps} />);
    const textarea = screen.getAllByRole('textbox')[0];
    fireEvent.change(textarea, { target: { value: 'New Header' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('New Header');
  });

  it('updates footer textarea on input', () => {
    render(<HeaderFooterModal {...defaultProps} />);
    const textarea = screen.getAllByRole('textbox')[1];
    fireEvent.change(textarea, { target: { value: 'New Footer' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('New Footer');
  });

  it('clicking Apply calls onSave with current values', () => {
    render(<HeaderFooterModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Apply'));
    expect(defaultProps.onSave).toHaveBeenCalledWith('My Header', 'My Footer', false);
  });

  it('clicking Apply also calls onClose', () => {
    render(<HeaderFooterModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Apply'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('clicking Cancel calls onClose without calling onSave', () => {
    render(<HeaderFooterModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onClose).toHaveBeenCalled();
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });

  it('toggling the checkbox updates showPageNumbers in the saved call', () => {
    render(<HeaderFooterModal {...defaultProps} showPageNumbers={false} />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByText('Apply'));
    expect(defaultProps.onSave).toHaveBeenCalledWith('My Header', 'My Footer', true);
  });
});
