/**
 * A host that pins comments to its content (Docs) shows what a new comment will be pinned to,
 * quotes each comment's text, and lets a comment be picked so the host can show that text.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommentsPanel, type CommentItem, type CommentsPanelProps } from '../components/panels/CommentsPanel';

const comment = (id: string, over: Partial<CommentItem> = {}): CommentItem => ({
  id, userName: 'Ada', body: `Body ${id}`, status: 'open', createdAt: '2026-10-23T10:00:00Z', replies: [], ...over,
});

const props = (over: Partial<CommentsPanelProps> = {}): CommentsPanelProps => ({
  comments: [comment('c1', { anchorText: 'brown fox' }), comment('c2')],
  filter: 'open',
  onFilterChange: vi.fn(),
  onCreateComment: vi.fn(),
  onDeleteComment: vi.fn(),
  onResolveComment: vi.fn(),
  onAddReply: vi.fn(),
  onDeleteReply: vi.fn(),
  ...over,
});

const thread = (id: string) => document.querySelector(`[data-comment-id="${id}"]`) as HTMLElement;

describe('CommentsPanel with anchored comments', () => {
  it('shows what a new comment will be pinned to, and lets it be dropped', () => {
    const onClearAnchor = vi.fn();
    render(<CommentsPanel {...props({ anchorQuote: 'lazy dog', onClearAnchor })} />);
    expect(screen.getByText(/lazy dog/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Don’t pin to this text' }));
    expect(onClearAnchor).toHaveBeenCalled();
  });

  it('quotes the text a comment is pinned to', () => {
    render(<CommentsPanel {...props()} />);
    expect(thread('c1')).toHaveTextContent('brown fox');
    expect(thread('c2').querySelector('blockquote')).toBeNull();
  });

  it('reports a click on a comment, but not on its own controls', () => {
    const onSelectComment = vi.fn();
    render(<CommentsPanel {...props({ onSelectComment })} />);
    fireEvent.click(screen.getByText('Body c2'));
    expect(onSelectComment).toHaveBeenCalledWith('c2');
    onSelectComment.mockClear();
    fireEvent.click(thread('c1').querySelector('button[title="Resolve"]')!);
    expect(onSelectComment).not.toHaveBeenCalled();
  });

  it('marks the selected comment and scrolls it into view', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { rerender } = render(<CommentsPanel {...props()} />);
    expect(thread('c2')).not.toHaveAttribute('aria-current');
    rerender(<CommentsPanel {...props({ activeCommentId: 'c2' })} />);
    expect(thread('c2')).toHaveAttribute('aria-current', 'true');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });
});
