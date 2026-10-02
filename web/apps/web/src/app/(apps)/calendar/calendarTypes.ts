import type { CalendarResponse } from '@neutrino/api-calendar';
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
  /**
   * For an occurrence of a repeating event, which occurrences the edit is for. "this" edits one
   * occurrence, which can't repeat, so the repeat fields are hidden.
   */
  scope?: import('./RecurrenceScopeModal').RecurrenceScope;
  /**
   * The user's calendars, for the calendar picker; only writable ones are offered. A new event
   * starts in the default one. Absent, or with one to choose from, there is no picker.
   */
  calendars?: CalendarResponse[];
  onClose: () => void;
  onCreate: (req: CreateEventRequest, reminders: number[], pendingAttachments: CreateAttachmentRequest[]) => void;
  onUpdate?: (req: UpdateEventRequest, eventId: string) => void;
  isPending: boolean;
}

export interface ReminderModalProps {
  initial?: ReminderResponse;
  /** For a repeating reminder, which occurrences the edit is for; "this" hides the repeat choice. */
  scope?: import('./RecurrenceScopeModal').RecurrenceScope;
  onClose: () => void;
  onSave: (data: CreateReminderRequest | UpdateReminderRequest) => void;
  isPending: boolean;
}
