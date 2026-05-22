'use client';

import React, { useState } from 'react';
import { MessageSquare, X, Check, Trash2, Reply, ChevronDown, ChevronRight } from 'lucide-react';
import { Spinner } from '../../index';
import styles from './CommentsPanel.module.css';

export interface CommentReplyItem {
  id: string;
  userName: string;
  body: string;
  createdAt: string;
}

export interface CommentItem {
  id: string;
  userName: string;
  body: string;
  status: 'open' | 'resolved';
  createdAt: string;
  replies: CommentReplyItem[];
}

export interface CommentsPanelProps {
  comments: CommentItem[];
  isLoading?: boolean;
  isError?: boolean;
  filter: 'open' | 'all';
  onFilterChange: (filter: 'open' | 'all') => void;
  onClose: () => void;
  initialText?: string;
  onCreateComment: (body: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onResolveComment: (commentId: string, resolved: boolean) => Promise<void>;
  onAddReply: (commentId: string, body: string) => Promise<void>;
  onDeleteReply: (commentId: string, replyId: string) => Promise<void>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ReplyForm({ onSubmit, onCancel }: { onSubmit: (body: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);

  async function submit() {
    const body = text.trim();
    if (!body || pending) return;
    setPending(true);
    try {
      await onSubmit(body);
      setText('');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.replyForm}>
      <textarea
        className={styles.textarea}
        placeholder="Reply…"
        value={text}
        onChange={e => setText(e.target.value)}
        rows={2}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === 'Escape') onCancel();
        }}
        autoFocus
      />
      <div className={styles.formActions}>
        <button className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
        <button
          className={styles.submitBtn}
          onClick={submit}
          disabled={!text.trim() || pending}
        >
          {pending ? 'Replying…' : 'Reply'}
        </button>
      </div>
    </div>
  );
}

function ReplyRow({ reply, onDelete }: { reply: CommentReplyItem; onDelete: () => Promise<void> }) {
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    setPending(true);
    try { await onDelete(); } finally { setPending(false); }
  }

  return (
    <div className={styles.reply}>
      <div className={styles.replyHeader}>
        <span className={styles.avatar}>{reply.userName.charAt(0).toUpperCase()}</span>
        <span className={styles.authorName}>{reply.userName}</span>
        <span className={styles.timestamp}>{formatDate(reply.createdAt)}</span>
        <button className={styles.iconBtn} title="Delete reply" onClick={handleDelete} disabled={pending}>
          <Trash2 size={11} />
        </button>
      </div>
      <p className={styles.replyBody}>{reply.body}</p>
    </div>
  );
}

function CommentThread({
  comment,
  onResolve,
  onDelete,
  onAddReply,
  onDeleteReply,
}: {
  comment: CommentItem;
  onResolve: (resolved: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
  onAddReply: (body: string) => Promise<void>;
  onDeleteReply: (replyId: string) => Promise<void>;
}) {
  const [showReplies, setShowReplies] = useState(true);
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isResolved = comment.status === 'resolved';

  async function handleResolve() {
    setResolving(true);
    try { await onResolve(!isResolved); } finally { setResolving(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try { await onDelete(); } finally { setDeleting(false); }
  }

  return (
    <div className={`${styles.thread} ${isResolved ? styles.threadResolved : ''}`}>
      <div className={styles.threadHeader}>
        <span className={styles.avatar}>{comment.userName.charAt(0).toUpperCase()}</span>
        <div className={styles.threadMeta}>
          <span className={styles.authorName}>{comment.userName}</span>
          <span className={styles.timestamp}>{formatDate(comment.createdAt)}</span>
        </div>
        <div className={styles.threadActions}>
          <button className={styles.iconBtn} title={isResolved ? 'Reopen' : 'Resolve'} onClick={handleResolve} disabled={resolving}>
            <Check size={13} />
          </button>
          <button className={styles.iconBtn} title="Delete" onClick={handleDelete} disabled={deleting}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <p className={styles.commentBody}>{comment.body}</p>

      {isResolved && <span className={styles.resolvedBadge}>Resolved</span>}

      {comment.replies.length > 0 && (
        <button className={styles.repliesToggle} onClick={() => setShowReplies(v => !v)}>
          {showReplies ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
        </button>
      )}

      {showReplies && comment.replies.map(r => (
        <ReplyRow key={r.id} reply={r} onDelete={() => onDeleteReply(r.id)} />
      ))}

      {!showReplyForm && !isResolved && (
        <button className={styles.replyBtn} onClick={() => setShowReplyForm(true)}>
          <Reply size={11} /> Reply
        </button>
      )}

      {showReplyForm && (
        <ReplyForm
          onSubmit={async (body) => { await onAddReply(body); setShowReplyForm(false); }}
          onCancel={() => setShowReplyForm(false)}
        />
      )}
    </div>
  );
}

export function CommentsPanel({
  comments,
  isLoading,
  isError,
  filter,
  onFilterChange,
  onClose,
  initialText,
  onCreateComment,
  onDeleteComment,
  onResolveComment,
  onAddReply,
  onDeleteReply,
}: CommentsPanelProps) {
  const [newText, setNewText] = useState(initialText ?? '');
  const [creating, setCreating] = useState(false);
  const newTextareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (initialText) newTextareaRef.current?.focus();
  }, [initialText]);

  async function submitNew() {
    const body = newText.trim();
    if (!body || creating) return;
    setCreating(true);
    try {
      await onCreateComment(body);
      setNewText('');
    } finally {
      setCreating(false);
    }
  }

  const openCount = comments.filter(c => c.status === 'open').length;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <MessageSquare size={16} />
          Comments
          {openCount > 0 && <span className={styles.countBadge}>{openCount}</span>}
        </div>
        <div className={styles.headerRight}>
          <select
            className={styles.filterSelect}
            value={filter}
            onChange={e => onFilterChange(e.target.value as 'open' | 'all')}
          >
            <option value="open">Open</option>
            <option value="all">All</option>
          </select>
          <button className={styles.closeBtn} onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className={styles.newCommentForm}>
        <textarea
          ref={newTextareaRef}
          className={styles.textarea}
          placeholder="Add a comment… (use @name to mention)"
          value={newText}
          onChange={e => setNewText(e.target.value)}
          rows={3}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitNew(); }}
        />
        <button
          className={styles.submitBtn}
          onClick={submitNew}
          disabled={!newText.trim() || creating}
        >
          {creating ? 'Posting…' : 'Comment'}
        </button>
      </div>

      <div className={styles.list}>
        {isLoading && <Spinner size="sm" />}
        {isError && (
          <div className={styles.empty} style={{ color: 'var(--color-danger, #dc2626)' }}>
            Failed to load comments.
          </div>
        )}
        {!isLoading && !isError && comments.length === 0 && (
          <div className={styles.empty}>
            {filter === 'open' ? 'No open comments.' : 'No comments yet.'}
          </div>
        )}
        {comments.map(c => (
          <CommentThread
            key={c.id}
            comment={c}
            onResolve={(resolved) => onResolveComment(c.id, resolved)}
            onDelete={() => onDeleteComment(c.id)}
            onAddReply={(body) => onAddReply(c.id, body)}
            onDeleteReply={(replyId) => onDeleteReply(c.id, replyId)}
          />
        ))}
      </div>
    </div>
  );
}
