'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Reply, Check, Trash2 } from 'lucide-react';
import { diagramsApi, type DiagramComment } from '@neutrino/api-diagrams';
import styles from './CommentsPanel.module.css';

interface CommentsPanelProps {
  diagramId: string;
}

export function CommentsPanel({ diagramId }: CommentsPanelProps) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');

  const { data } = useQuery({
    queryKey: ['diagram-comments', diagramId],
    queryFn: () => diagramsApi.listComments(diagramId),
    refetchInterval: 10_000,
  });

  const createMutation = useMutation({
    mutationFn: (body: { content: string; parentId?: string }) =>
      diagramsApi.createComment(diagramId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diagram-comments', diagramId] });
      setDraft('');
      setReplyDraft('');
      setReplyingTo(null);
    },
  });

  const resolveMutation = useMutation({
    mutationFn: ({ commentId, resolved }: { commentId: string; resolved: boolean }) =>
      diagramsApi.updateComment(diagramId, commentId, { resolved }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['diagram-comments', diagramId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => diagramsApi.deleteComment(diagramId, commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['diagram-comments', diagramId] }),
  });

  const comments = data?.comments ?? [];
  const topLevel = comments.filter((c) => !c.parentId);
  const getReplies = (id: string) => comments.filter((c) => c.parentId === id);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <MessageSquare size={14} />
        Comments
        {comments.length > 0 && (
          <span className={styles.badge}>{comments.length}</span>
        )}
      </div>

      {/* New top-level comment */}
      <div className={styles.compose}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment…"
          className={styles.textarea}
          rows={3}
        />
        <button
          className={styles.submitBtn}
          disabled={!draft.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate({ content: draft.trim() })}
        >
          Comment
        </button>
      </div>

      <div className={styles.scroll}>
        {topLevel.length === 0 && (
          <div className={styles.empty}>No comments yet.</div>
        )}
        {topLevel.map((c) => (
          <CommentThread
            key={c.id}
            comment={c}
            replies={getReplies(c.id)}
            replyingTo={replyingTo}
            replyDraft={replyDraft}
            onReplyStart={() => { setReplyingTo(c.id); setReplyDraft(''); }}
            onReplyChange={setReplyDraft}
            onReplySubmit={() =>
              createMutation.mutate({ content: replyDraft.trim(), parentId: c.id })
            }
            onReplyCancel={() => setReplyingTo(null)}
            onResolve={() => resolveMutation.mutate({ commentId: c.id, resolved: !c.resolved })}
            onDelete={() => deleteMutation.mutate(c.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single comment thread
// ---------------------------------------------------------------------------

function CommentThread({
  comment,
  replies,
  replyingTo,
  replyDraft,
  onReplyStart,
  onReplyChange,
  onReplySubmit,
  onReplyCancel,
  onResolve,
  onDelete,
}: {
  comment: DiagramComment;
  replies: DiagramComment[];
  replyingTo: string | null;
  replyDraft: string;
  onReplyStart: () => void;
  onReplyChange: (v: string) => void;
  onReplySubmit: () => void;
  onReplyCancel: () => void;
  onResolve: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`${styles.thread} ${comment.resolved ? styles.resolved : ''}`}>
      <CommentItem comment={comment} isReply={false} />
      <div className={styles.actions}>
        <button className={styles.actionBtn} onClick={onReplyStart} title="Reply">
          <Reply size={12} /> Reply
        </button>
        <button className={styles.actionBtn} onClick={onResolve} title={comment.resolved ? 'Reopen' : 'Resolve'}>
          <Check size={12} /> {comment.resolved ? 'Reopen' : 'Resolve'}
        </button>
        <button className={styles.actionBtn} onClick={onDelete} title="Delete">
          <Trash2 size={12} />
        </button>
      </div>

      {replies.map((r) => (
        <CommentItem key={r.id} comment={r} isReply />
      ))}

      {replyingTo === comment.id && (
        <div className={styles.replyCompose}>
          <textarea
            autoFocus
            value={replyDraft}
            onChange={(e) => onReplyChange(e.target.value)}
            placeholder="Reply…"
            className={styles.textarea}
            rows={2}
          />
          <div className={styles.replyBtns}>
            <button className={styles.cancelBtn} onClick={onReplyCancel}>Cancel</button>
            <button
              className={styles.submitBtn}
              disabled={!replyDraft.trim()}
              onClick={onReplySubmit}
            >
              Reply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentItem({ comment, isReply }: { comment: DiagramComment; isReply: boolean }) {
  const initials = comment.userId.slice(0, 2).toUpperCase();
  const date = new Date(comment.createdAt).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className={`${styles.comment} ${isReply ? styles.reply : ''}`}>
      <div className={styles.commentAvatar}>{initials}</div>
      <div className={styles.commentBody}>
        <div className={styles.commentMeta}>
          <span className={styles.commentAuthor}>{comment.userId}</span>
          <span className={styles.commentDate}>{date}</span>
        </div>
        <div className={styles.commentContent}>{comment.content}</div>
      </div>
    </div>
  );
}
