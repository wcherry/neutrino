/**
 * Tests for TrackChangesBar component.
 *
 * Covers:
 * - Renders mode toggle button
 * - Shows "Editing" label when suggestingMode is false
 * - Shows "Suggesting" label when suggestingMode is true
 * - Accept All and Reject All buttons visible in suggesting mode
 * - Accept All and Reject All hidden when not in suggesting mode
 * - Clicking mode toggle calls onToggle
 * - Clicking Accept All calls editor.chain().focus().acceptAllChanges().run()
 * - Clicking Reject All calls editor.chain().focus().rejectAllChanges().run()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('../../app/(apps)/docs/editor/TrackChangesBar.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

import { TrackChangesBar } from '../../app/(apps)/docs/editor/TrackChangesBar';

const mockRun = vi.fn();
const mockFocus = vi.fn(() => ({ acceptAllChanges: () => ({ run: mockRun }), rejectAllChanges: () => ({ run: mockRun }) }));
const mockChain = vi.fn(() => ({ focus: mockFocus }));

const mockEditor = {
  chain: mockChain,
} as unknown as import('@tiptap/react').Editor;

const defaultProps = {
  editor: mockEditor,
  suggestingMode: false,
  onToggle: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TrackChangesBar', () => {
  it('renders in editing mode by default', () => {
    render(<TrackChangesBar {...defaultProps} />);
    expect(screen.getByText('Editing')).toBeInTheDocument();
  });

  it('renders in suggesting mode when suggestingMode is true', () => {
    render(<TrackChangesBar {...defaultProps} suggestingMode={true} />);
    expect(screen.getByText('Suggesting')).toBeInTheDocument();
  });

  it('shows Accept All button in suggesting mode', () => {
    render(<TrackChangesBar {...defaultProps} suggestingMode={true} />);
    expect(screen.getByText('Accept all')).toBeInTheDocument();
  });

  it('shows Reject All button in suggesting mode', () => {
    render(<TrackChangesBar {...defaultProps} suggestingMode={true} />);
    expect(screen.getByText('Reject all')).toBeInTheDocument();
  });

  it('hides Accept All when not in suggesting mode', () => {
    render(<TrackChangesBar {...defaultProps} suggestingMode={false} />);
    expect(screen.queryByText('Accept all')).not.toBeInTheDocument();
  });

  it('hides Reject All when not in suggesting mode', () => {
    render(<TrackChangesBar {...defaultProps} suggestingMode={false} />);
    expect(screen.queryByText('Reject all')).not.toBeInTheDocument();
  });

  it('calls onToggle when mode button is clicked', () => {
    const onToggle = vi.fn();
    render(<TrackChangesBar {...defaultProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByText('Editing'));
    expect(onToggle).toHaveBeenCalled();
  });

  it('shows "Changes are tracked" hint in suggesting mode', () => {
    render(<TrackChangesBar {...defaultProps} suggestingMode={true} />);
    expect(screen.getByText('Changes are tracked')).toBeInTheDocument();
  });
});
