/**
 * In a rail the comments panel stays mounted, so each "comment on this" reaches it as a new
 * `initialText`, not a fresh mount. The quote must still land in the box — without clobbering a
 * draft — and unframed it draws no title or close button of its own.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommentsPanel, type CommentsPanelProps } from '../components/panels/CommentsPanel';

const props = (over: Partial<CommentsPanelProps> = {}): CommentsPanelProps => ({
  comments: [],
  filter: 'open',
  onFilterChange: vi.fn(),
  framed: false,
  onCreateComment: vi.fn(),
  onDeleteComment: vi.fn(),
  onResolveComment: vi.fn(),
  onAddReply: vi.fn(),
  onDeleteReply: vi.fn(),
  ...over,
});

const box = () => screen.getByPlaceholderText('Add a comment… (use @name to mention)') as HTMLTextAreaElement;

describe('CommentsPanel, unframed in a rail', () => {
  it('takes each new quote into the box while mounted', () => {
    const { rerender } = render(<CommentsPanel {...props({ initialText: '"First"\n\n' })} />);
    expect(box().value).toBe('"First"\n\n');
    fireEvent.change(box(), { target: { value: '' } });
    rerender(<CommentsPanel {...props({ initialText: '"Second"\n\n' })} />);
    expect(box().value).toBe('"Second"\n\n');
  });

  it('keeps a draft rather than replacing it with a new quote', () => {
    const { rerender } = render(<CommentsPanel {...props()} />);
    fireEvent.change(box(), { target: { value: 'my draft' } });
    rerender(<CommentsPanel {...props({ initialText: '"Quote"\n\n' })} />);
    expect(box().value).toBe('my draft');
  });

  it('has no title or close button of its own, but keeps the count and filter', () => {
    render(<CommentsPanel {...props()} />);
    expect(screen.queryByTitle('Close')).toBeNull();
    expect(screen.getByText('0 open')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Show comments' })).toBeTruthy();
  });
});
