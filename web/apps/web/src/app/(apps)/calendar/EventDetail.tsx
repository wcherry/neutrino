'use client';

import React, { useState } from 'react';

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

function linkifyText(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const url = match[0];
    parts.push(
      <a key={match.index} href={url} target="_blank" rel="noopener noreferrer"
        style={{ color: 'var(--color-primary, #2563eb)', textDecoration: 'underline' }}>
        {url}
      </a>
    );
    last = match.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Paperclip, FileText } from 'lucide-react';
import { Button, Modal, ModalHeader, ModalBody, ModalFooter } from '@neutrino/ui';
import {
  calendarApi,
  storageApi,
  type EventResponse,
  type AttachmentResponse,
  type CreateAttachmentRequest,
  type FileItem,
} from '@/lib/api';
import { PreviewModal } from '../drive/PreviewModal';
import { fmtTime } from './calendarHelpers';
import { DriveFilePicker } from './DriveFilePicker';
import styles from './page.module.css';

// ── AddAttachmentModal ────────────────────────────────────────────────────────

export interface AddAttachmentModalProps {
  eventId: string;
  onClose: () => void;
  onCreate: (req: CreateAttachmentRequest) => void;
  isPending: boolean;
}

interface SelectedDriveFile {
  id: string;
  name: string;
}

export function AddAttachmentModal({ onClose, onCreate, isPending }: AddAttachmentModalProps) {
  const [mode, setMode] = useState<'note' | 'file'>('note');
  const [note, setNote] = useState('');
  const [selectedFile, setSelectedFile] = useState<SelectedDriveFile | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'note') {
      if (!note.trim()) return;
      onCreate({ note: note.trim() });
    } else {
      if (!selectedFile) return;
      onCreate({ fileId: selectedFile.id, name: selectedFile.name });
    }
  }

  function handlePickerSelect(file: SelectedDriveFile) {
    setSelectedFile(file);
    setShowPicker(false);
  }

  return (
    <>
      <Modal open onClose={onClose} size="sm">
        <ModalHeader title="Add Attachment" onClose={onClose} />
        <ModalBody>
          <form
            id="attachment-form"
            onSubmit={handleSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div className={styles.attachmentTabs}>
              <button
                type="button"
                className={`${styles.attachmentTab} ${mode === 'note' ? styles.attachmentTabActive : ''}`}
                onClick={() => setMode('note')}
              >
                Note
              </button>
              <button
                type="button"
                className={`${styles.attachmentTab} ${mode === 'file' ? styles.attachmentTabActive : ''}`}
                onClick={() => setMode('file')}
              >
                File
              </button>
            </div>

            {mode === 'note' ? (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Note</label>
                <textarea
                  className={`${styles.formInput} ${styles.formTextarea}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Write a note…"
                  rows={4}
                  autoFocus
                  required
                />
              </div>
            ) : (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Drive file</label>
                {selectedFile ? (
                  <div className={styles.drivePickerSelectedFile}>
                    <FileText size={14} color="var(--color-text-secondary, #6b7280)" />
                    <span className={styles.drivePickerSelectedFileName}>{selectedFile.name}</span>
                    <button
                      type="button"
                      className={styles.drivePickerClearBtn}
                      onClick={() => setSelectedFile(null)}
                      aria-label="Clear selected file"
                      title="Clear"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowPicker(true)}
                  >
                    Browse Drive…
                  </Button>
                )}
                {/* Hidden required sentinel so form validation works */}
                <input
                  type="text"
                  value={selectedFile?.id ?? ''}
                  onChange={() => {}}
                  required={mode === 'file'}
                  aria-hidden="true"
                  tabIndex={-1}
                  style={{
                    position: 'absolute',
                    width: 0,
                    height: 0,
                    opacity: 0,
                    pointerEvents: 'none',
                  }}
                />
              </div>
            )}
          </form>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="attachment-form" type="submit" disabled={isPending}>
            {isPending ? 'Saving…' : 'Add'}
          </Button>
        </ModalFooter>
      </Modal>

      <DriveFilePicker
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={(file) => {
          setSelectedFile(file);
          setShowPicker(false);
        }}
      />
    </>
  );
}

// ── AttachmentItem ────────────────────────────────────────────────────────────

export function AttachmentItem({
  attachment: a,
  onDelete,
}: {
  attachment: AttachmentResponse;
  onDelete: () => void;
}) {
  return (
    <div className={styles.detailAttachment}>
      <Paperclip size={12} style={{ flexShrink: 0, color: 'var(--color-text-secondary)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {a.note ? (
          <div className={styles.detailAttachmentNote}>{a.note}</div>
        ) : (
          <div style={{ fontSize: 12, fontWeight: 500 }}>{a.name ?? a.fileId}</div>
        )}
      </div>
      <button
        className={`${styles.reminderActionBtn} ${styles.reminderActionDelete}`}
        onClick={onDelete}
        title="Remove"
      >
        <X size={11} />
      </button>
    </div>
  );
}

// ── EventViewModal ────────────────────────────────────────────────────────────

export interface EventViewModalProps {
  event: EventResponse;
  onClose: () => void;
  onEdit: () => void;
  onDelete: (id: string) => void;
}

export function EventViewModal({ event, onClose, onEdit, onDelete }: EventViewModalProps) {
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);

  const { data: remindersData } = useQuery({
    queryKey: ['reminders', 'event', event.id],
    queryFn: () => calendarApi.listReminders(event.id),
  });

  const { data: attachmentsData } = useQuery({
    queryKey: ['attachments', event.id],
    queryFn: () => calendarApi.listAttachments(event.id),
  });

  const eventReminders = remindersData?.reminders ?? [];
  const attachments = attachmentsData?.attachments ?? [];

  async function handleAttachmentClick(a: AttachmentResponse) {
    if (!a.fileId) return;
    try {
      const file = await storageApi.getFileMetadata(a.fileId);
      setPreviewFile(file);
    } catch {
      // If metadata fetch fails, fall back silently
    }
  }

  return (
    <>
      <Modal open onClose={onClose} size="sm">
        <ModalHeader title={event.title} onClose={onClose} />
        <ModalBody>
          {/* Time */}
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
            {event.allDay
              ? (() => {
                  const [y, mo, d] = event.startTime.slice(0, 10).split('-').map(Number);
                  return new Date(y, mo - 1, d).toLocaleDateString();
                })()
              : `${fmtTime(event.startTime)} – ${fmtTime(event.endTime)}${event.timezone ? ` (${event.timezone})` : ''}`}
          </div>

          {/* Location */}
          {event.location && (
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
              {event.location}
            </div>
          )}

          {/* Description */}
          {event.description && (
            <div style={{ fontSize: 13, color: 'var(--color-text)', whiteSpace: 'pre-wrap', marginBottom: 8 }}>
              {linkifyText(event.description)}
            </div>
          )}

          {/* Attendees */}
          {event.attendees.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className={styles.detailSectionLabel}>Guests ({event.attendees.length})</div>
              <div className={styles.detailAttendeeList}>
                {event.attendees.map((email) => (
                  <div key={email} className={styles.detailAttendeePill}>{email}</div>
                ))}
              </div>
            </div>
          )}

          {/* Reminders */}
          {eventReminders.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className={styles.detailSectionLabel}>Reminders</div>
              {eventReminders.map((r) => (
                <div key={r.id} className={styles.detailReminderRow}>
                  <span style={{ fontSize: 12 }}>{r.title}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                    {new Date(r.dueTime).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Attachments */}
          {attachments.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className={styles.detailSectionLabel}>Attachments</div>
              {attachments.map((a) => (
                <div
                  key={a.id}
                  className={styles.detailAttachment}
                  onClick={a.fileId ? () => handleAttachmentClick(a) : undefined}
                  style={a.fileId ? { cursor: 'pointer' } : undefined}
                  title={a.fileId ? 'Click to preview' : undefined}
                >
                  <Paperclip size={12} style={{ flexShrink: 0, color: 'var(--color-text-secondary)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {a.note ? (
                      <div className={styles.detailAttachmentNote}>{a.note}</div>
                    ) : (
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{a.name ?? a.fileId}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="danger" onClick={() => { onDelete(event.id); onClose(); }}>
            Delete
          </Button>
          <Button variant="secondary" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </ModalFooter>
      </Modal>

      {previewFile && (
        <PreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
    </>
  );
}

// ── EventDetail ───────────────────────────────────────────────────────────────

interface EventDetailProps {
  event: EventResponse;
  onClose: () => void;
  onDelete: (id: string) => void;
  onEdit: (event: EventResponse) => void;
}

export function EventDetail({
  event,
  onClose,
  onDelete,
  onEdit,
}: EventDetailProps) {
  const qc = useQueryClient();

  const { data: remindersData } = useQuery({
    queryKey: ['reminders', 'event', event.id],
    queryFn: () => calendarApi.listReminders(event.id),
  });

  const { data: attachmentsData } = useQuery({
    queryKey: ['attachments', event.id],
    queryFn: () => calendarApi.listAttachments(event.id),
  });

  const [showAddAttachment, setShowAddAttachment] = useState(false);

  const deleteEventReminder = useMutation({
    mutationFn: (id: string) => calendarApi.deleteReminder(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders', 'event', event.id] }),
  });

  const createAttachment = useMutation({
    mutationFn: (req: CreateAttachmentRequest) => calendarApi.createAttachment(event.id, req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attachments', event.id] });
      setShowAddAttachment(false);
    },
  });

  const deleteAttachment = useMutation({
    mutationFn: (attachmentId: string) => calendarApi.deleteAttachment(event.id, attachmentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attachments', event.id] }),
  });

  const eventReminders = remindersData?.reminders ?? [];
  const attachments = attachmentsData?.attachments ?? [];

  return (
    <>
      <div style={{ padding: 16, borderBottom: '1px solid var(--color-border, #e5e7eb)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{event.title}</span>
          <button className={styles.modalClose} onClick={onClose}><X size={14} /></button>
        </div>

        {/* Time */}
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
          {event.allDay
            ? (() => {
                const [y, mo, d] = event.startTime.slice(0, 10).split('-').map(Number);
                return new Date(y, mo - 1, d).toLocaleDateString();
              })()
            : `${fmtTime(event.startTime)} – ${fmtTime(event.endTime)}${event.timezone ? ` (${event.timezone})` : ''}`}
        </div>

        {/* Location */}
        {event.location && (
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
            📍 {event.location}
          </div>
        )}

        {/* Description */}
        {event.description && (
          <div style={{ fontSize: 13, marginTop: 8, color: 'var(--color-text)', whiteSpace: 'pre-wrap' }}>
            {linkifyText(event.description)}
          </div>
        )}

        {/* Attendees */}
        {event.attendees.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className={styles.detailSectionLabel}>Guests ({event.attendees.length})</div>
            <div className={styles.detailAttendeeList}>
              {event.attendees.map((email) => (
                <div key={email} className={styles.detailAttendeePill}>{email}</div>
              ))}
            </div>
          </div>
        )}

        {/* Event-linked reminders */}
        {eventReminders.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className={styles.detailSectionLabel}>Reminders</div>
            {eventReminders.map((r) => (
              <div key={r.id} className={styles.detailReminderRow}>
                <span style={{ fontSize: 12 }}>{r.title}</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  {new Date(r.dueTime).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
                <button
                  className={`${styles.reminderActionBtn} ${styles.reminderActionDelete}`}
                  onClick={() => deleteEventReminder.mutate(r.id)}
                  title="Delete"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Attachments */}
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className={styles.detailSectionLabel}>Attachments</div>
            <button
              className={styles.reminderNewBtn}
              onClick={() => setShowAddAttachment(true)}
              title="Add attachment"
            >
              <Plus size={12} />
            </button>
          </div>
          {attachments.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4 }}>None</div>
          )}
          {attachments.map((a) => (
            <AttachmentItem
              key={a.id}
              attachment={a}
              onDelete={() => deleteAttachment.mutate(a.id)}
            />
          ))}
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <Button onClick={() => onEdit(event)}>Edit</Button>
          <Button onClick={() => onDelete(event.id)}>Delete Event</Button>
        </div>
      </div>

      {showAddAttachment && (
        <AddAttachmentModal
          eventId={event.id}
          onClose={() => setShowAddAttachment(false)}
          onCreate={(req) => createAttachment.mutate(req)}
          isPending={createAttachment.isPending}
        />
      )}
    </>
  );
}
