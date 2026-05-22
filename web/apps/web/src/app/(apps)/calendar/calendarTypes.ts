import type { CreateEventRequest, UpdateEventRequest, EventResponse, ReminderResponse, CreateReminderRequest, UpdateReminderRequest, CreateAttachmentRequest } from '@/lib/api';

export type View = 'month' | 'week' | 'agenda';

export interface ParsedIcsEvent {
  title?: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  attendees?: string[];
}

export interface ReminderEntry {
  id: string; // local key
  minutes: number;
  customLabel?: string;
}

export interface NewEventModalProps {
  defaultDate: Date;
  prefill?: ParsedIcsEvent;
  existingEvent?: EventResponse;
  onClose: () => void;
  onCreate: (req: CreateEventRequest, reminders: number[], pendingAttachments: CreateAttachmentRequest[]) => void;
  onUpdate?: (req: UpdateEventRequest, eventId: string) => void;
  isPending: boolean;
}

export interface ReminderModalProps {
  initial?: ReminderResponse;
  onClose: () => void;
  onSave: (data: CreateReminderRequest | UpdateReminderRequest) => void;
  isPending: boolean;
}
