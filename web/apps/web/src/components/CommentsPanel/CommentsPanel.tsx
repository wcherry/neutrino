'use client';

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { commentsApi } from '@/lib/api';
import type { Comment } from '@neutrino/api-drive';
import { CommentsPanel as CommentsPanelUI } from '@neutrino/ui';

interface CommentsPanelProps {
  fileId: string;
  initialText?: string;
  /** The text a new comment will be pinned to (see `@neutrino/ui`'s CommentsPanel). */
  anchorQuote?: string | null;
  onClearAnchor?: () => void;
  /** The text each comment is pinned to, by comment id, quoted on its thread. */
  anchorTexts?: ReadonlyMap<string, string>;
  activeCommentId?: string | null;
  onSelectComment?: (commentId: string) => void;
  /** After a comment is created — the host pins it to `anchorQuote`'s text. */
  onCreated?: (comment: Comment) => void;
  /** After a comment is deleted — the host takes its pin out of the content. */
  onDeleted?: (commentId: string) => void;
}

export function CommentsPanel({
  fileId,
  initialText,
  anchorQuote,
  onClearAnchor,
  anchorTexts,
  activeCommentId,
  onSelectComment,
  onCreated,
  onDeleted,
}: CommentsPanelProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['comments', fileId, filter],
    queryFn: () => commentsApi.listComments(fileId, filter === 'open' ? 'open' : undefined),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['comments', fileId] });
  const comments = (data?.comments ?? []).map((c) => ({ ...c, anchorText: anchorTexts?.get(c.id) }));

  return (
    <CommentsPanelUI
      comments={comments}
      isLoading={isLoading}
      isError={isError}
      filter={filter}
      onFilterChange={setFilter}
      initialText={initialText}
      anchorQuote={anchorQuote}
      onClearAnchor={onClearAnchor}
      activeCommentId={activeCommentId}
      onSelectComment={onSelectComment}
      onCreateComment={async (body) => {
        const created = await commentsApi.createComment(fileId, body);
        onCreated?.(created);
        invalidate();
      }}
      onDeleteComment={async (commentId) => {
        await commentsApi.deleteComment(fileId, commentId);
        onDeleted?.(commentId);
        invalidate();
      }}
      onResolveComment={async (commentId, resolved) => {
        await commentsApi.updateComment(fileId, commentId, { status: resolved ? 'resolved' : 'open' });
        invalidate();
      }}
      onAddReply={async (commentId, body) => { await commentsApi.addReply(fileId, commentId, body); invalidate(); }}
      onDeleteReply={async (commentId, replyId) => { await commentsApi.deleteReply(fileId, commentId, replyId); invalidate(); }}
    />
  );
}
