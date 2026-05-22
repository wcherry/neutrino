'use client';

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { commentsApi } from '@/lib/api';
import { CommentsPanel as CommentsPanelUI } from '@neutrino/ui';

interface CommentsPanelProps {
  fileId: string;
  onClose: () => void;
  initialText?: string;
}

export function CommentsPanel({ fileId, onClose, initialText }: CommentsPanelProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['comments', fileId, filter],
    queryFn: () => commentsApi.listComments(fileId, filter === 'open' ? 'open' : undefined),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['comments', fileId] });

  return (
    <CommentsPanelUI
      comments={data?.comments ?? []}
      isLoading={isLoading}
      isError={isError}
      filter={filter}
      onFilterChange={setFilter}
      onClose={onClose}
      initialText={initialText}
      onCreateComment={async (body) => { await commentsApi.createComment(fileId, body); invalidate(); }}
      onDeleteComment={async (commentId) => { await commentsApi.deleteComment(fileId, commentId); invalidate(); }}
      onResolveComment={async (commentId, resolved) => {
        await commentsApi.updateComment(fileId, commentId, { status: resolved ? 'resolved' : 'open' });
        invalidate();
      }}
      onAddReply={async (commentId, body) => { await commentsApi.addReply(fileId, commentId, body); invalidate(); }}
      onDeleteReply={async (commentId, replyId) => { await commentsApi.deleteReply(fileId, commentId, replyId); invalidate(); }}
    />
  );
}
