/**
 * Component tests for ParagraphStylesModal.
 *
 * Covers:
 *   - Modal renders all named style buttons
 *   - Clicking a style button calls the appropriate editor command
 *   - Clicking overlay calls onClose
 *   - Close button calls onClose
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ParagraphStylesModal } from '../../app/(apps)/docs/editor/ParagraphStylesModal';
import type { Editor } from '@tiptap/react';

// ---------------------------------------------------------------------------
// Mock editor
// ---------------------------------------------------------------------------

function makeMockEditor(): Editor {
  const chain = {
    focus: vi.fn().mockReturnThis(),
    setParagraph: vi.fn().mockReturnThis(),
    setHeading: vi.fn().mockReturnThis(),
    setMark: vi.fn().mockReturnThis(),
    setBlockquote: vi.fn().mockReturnThis(),
    setCodeBlock: vi.fn().mockReturnThis(),
    run: vi.fn().mockReturnValue(true),
  };
  return {
    chain: vi.fn().mockReturnValue(chain),
    _chain: chain,
  } as unknown as Editor;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ParagraphStylesModal', () => {
  it('renders a button for each named style', () => {
    const editor = makeMockEditor();
    const onClose = vi.fn();
    render(<ParagraphStylesModal editor={editor} onClose={onClose} />);

    const expectedStyles = [
      'Normal', 'Title', 'Subtitle',
      'Heading 1', 'Heading 2', 'Heading 3',
      'Heading 4', 'Heading 5', 'Heading 6',
      'Quote', 'Code Block', 'Caption',
    ];

    for (const name of expectedStyles) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it('calls onClose after clicking a style button', () => {
    const editor = makeMockEditor();
    const onClose = vi.fn();
    render(<ParagraphStylesModal editor={editor} onClose={onClose} />);

    fireEvent.click(screen.getByText('Normal'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls the Close button to close', () => {
    const editor = makeMockEditor();
    const onClose = vi.fn();
    render(<ParagraphStylesModal editor={editor} onClose={onClose} />);

    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when the overlay is clicked', () => {
    const editor = makeMockEditor();
    const onClose = vi.fn();
    const { container } = render(<ParagraphStylesModal editor={editor} onClose={onClose} />);

    // The overlay is the outermost div
    const overlay = container.firstElementChild as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls chain().focus().setHeading() for Heading 2', () => {
    const editor = makeMockEditor();
    const onClose = vi.fn();
    render(<ParagraphStylesModal editor={editor} onClose={onClose} />);

    fireEvent.click(screen.getByText('Heading 2'));
    expect((editor as unknown as { _chain: { setHeading: ReturnType<typeof vi.fn> } })._chain.setHeading).toHaveBeenCalledWith({ level: 2 });
  });
});
