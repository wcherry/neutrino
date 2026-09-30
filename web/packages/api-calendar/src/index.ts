import { request } from '@neutrino/api-core';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface EventResponse {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string | null;
  recurrenceRule: string | null;
  attendees: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
  timezone: string | null;
  /**
   * Set on an exception: the repeating event whose occurrence this row stands in for. Only
   * returned when the list asks for exceptions. See `agent_docs/recurrence-exceptions.md`.
   */
  recurringEventId?: string | null;
  /** Set on an exception: the occurrence's start in its series, before any edit. */
  originalStartTime?: string | null;
  /** An exception that deletes its occurrence. */
  cancelled?: boolean;
}

export interface CreateEventRequest {
  title: string;
  description?: string | null;
  startTime: string;
  endTime: string;
  allDay?: boolean;
  location?: string | null;
  recurrenceRule?: string | null;
  attendees?: string[];
  timezone?: string | null;
}

export interface UpdateEventRequest {
  title?: string;
  description?: string | null;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  location?: string | null;
  recurrenceRule?: string | null;
  attendees?: string[];
  timezone?: string | null;
}

/** "This and following": the new series' changes from the occurrence it starts at. */
export interface SplitEventRequest extends UpdateEventRequest {
  /** The occurrence's start in the series, before any edit. */
  originalStartTime: string;
}

export interface ListEventsResponse {
  events: EventResponse[];
}

// ---------------------------------------------------------------------------
// Reminder types
// ---------------------------------------------------------------------------

export interface ReminderResponse {
  id: string;
  title: string;
  dueTime: string;
  completed: boolean;
  recurrenceRule: string | null;
  linkedEventId: string | null;
  linkedTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReminderRequest {
  title: string;
  dueTime: string;
  recurrenceRule?: string | null;
  linkedEventId?: string | null;
  /** The task this reminder belongs to. A reminder links to an event or a task, not both. */
  linkedTaskId?: string | null;
}

export interface UpdateReminderRequest {
  title?: string;
  dueTime?: string;
  /** Completing a recurring reminder moves it to its next occurrence instead of marking it done. */
  completed?: boolean;
  recurrenceRule?: string | null;
  /** IANA zone the server steps a recurrence in, so a 09:00 reminder stays at 09:00 across DST. */
  timezone?: string;
}

/** Only the current occurrence of a repeating reminder: see `calendarApi.editReminderOccurrence`. */
export interface ReminderOccurrenceRequest {
  title?: string;
  dueTime?: string;
  /** The IANA zone the series is stepped on in. */
  timezone?: string;
}

export interface ReminderOccurrenceResponse {
  /** The one-off reminder the occurrence became. */
  reminder: ReminderResponse;
  /** The repeating reminder at its next occurrence, or null once its rule ran out and it went. */
  series: ReminderResponse | null;
}

export interface ListRemindersResponse {
  reminders: ReminderResponse[];
}

// ---------------------------------------------------------------------------
// Attachment types
// ---------------------------------------------------------------------------

export interface AttachmentResponse {
  id: string;
  eventId: string;
  fileId: string | null;
  name: string | null;
  note: string | null;
}

export interface CreateAttachmentRequest {
  fileId?: string | null;
  name?: string | null;
  note?: string | null;
}

export interface ListAttachmentsResponse {
  attachments: AttachmentResponse[];
}

// ---------------------------------------------------------------------------
// Task List types
// ---------------------------------------------------------------------------

export interface TaskListResponse {
  id: string;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListTaskListsResponse {
  taskLists: TaskListResponse[];
}

export interface CreateTaskListRequest {
  name: string;
  color?: string;
}

// ---------------------------------------------------------------------------
// Task types
// ---------------------------------------------------------------------------

export interface TaskResponse {
  id: string;
  title: string;
  notes: string | null;
  done: boolean;
  dueDate: string | null;
  position: number;
  listId?: string | null;
  /** The calendar event this task is scheduled as, or null when it is not on the calendar. */
  eventId: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * `dueDate` is a real instant ("^fri 3pm"). When false it is a date, written as
   * `<day>T00:00:00Z` and read back in UTC. Absent from servers older than Smart Add.
   */
  dueHasTime?: boolean;
  startDate?: string | null;
  startHasTime?: boolean;
  /** 1 (high) to 3 (low), or null for no priority. */
  priority?: number | null;
  estimateMinutes?: number | null;
  location?: string | null;
  /** An RRULE body, the same strings reminders store. */
  recurrenceRule?: string | null;
  /** The next occurrence counts from the completion date ("*after 1 week"). */
  repeatAfterCompletion?: boolean;
  /** Lowercase, without the '#'. */
  tags?: string[];
  /**
   * Only on the response to completing a repeating task: the task created for its next
   * occurrence. The completed task stays done.
   */
  nextTask?: TaskResponse;
}

export interface ListTasksResponse {
  tasks: TaskResponse[];
}

export interface CreateTaskListRequest {
  name: string;
  color?: string;
}

export interface CreateTaskRequest {
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  position?: number;
  dueHasTime?: boolean;
  startDate?: string | null;
  startHasTime?: boolean;
  priority?: number | null;
  estimateMinutes?: number | null;
  location?: string | null;
  recurrenceRule?: string | null;
  repeatAfterCompletion?: boolean;
  tags?: string[];
}

export interface UpdateTaskRequest {
  title?: string;
  notes?: string | null;
  done?: boolean;
  dueDate?: string | null;
  position?: number;
  dueHasTime?: boolean;
  startDate?: string | null;
  startHasTime?: boolean;
  priority?: number | null;
  estimateMinutes?: number | null;
  location?: string | null;
  recurrenceRule?: string | null;
  repeatAfterCompletion?: boolean;
  tags?: string[];
  /** IANA zone to step a repeating task in when it is completed; UTC if absent. */
  timezone?: string;
}

export interface ReorderTasksRequest {
  /**
   * The list whose tasks are being reordered. Omit it to reorder the caller's tasks as one
   * flat sequence, which is what the calendar sidebar does now that it no longer groups by
   * list.
   */
  listId?: string;
  /** Task IDs in the desired new order (index 0 = position 0). */
  taskIds: string[];
}

export interface ScheduleTaskRequest {
  startTime: string;
  endTime: string;
  allDay?: boolean;
  timezone?: string | null;
}

export interface TaskAttachmentResponse {
  id: string;
  taskId: string;
  fileId: string | null;
  name: string | null;
  note: string | null;
}

export interface ListTaskAttachmentsResponse {
  attachments: TaskAttachmentResponse[];
}

// ---------------------------------------------------------------------------
// Connection types (Phase 3 – external calendar integrations)
// ---------------------------------------------------------------------------

export type ConnectionProvider = 'google' | 'outlook' | 'apple';

export interface ConnectionResponse {
  id: string;
  provider: ConnectionProvider;
  email: string | null;
  caldavUrl: string | null;
  expiresAt: string | null;
  syncCursor: string | null;
  createdAt: string;
}

export interface ListConnectionsResponse {
  connections: ConnectionResponse[];
}

export interface CreateAppleConnectionRequest {
  caldavUrl: string;
  username: string;
  password: string;
}

export interface CompleteGoogleOAuthRequest {
  code: string;
}

export interface CompleteOutlookOAuthRequest {
  code: string;
}

export interface TriggerSyncResponse {
  eventsSynced: number;
}

// ---------------------------------------------------------------------------

export const calendarApi = {
  // ── Events ──────────────────────────────────────────────────────────────

  /**
   * Every event in the range. With `exceptions`, every exception of every repeating one among
   * them too, for a caller that expands them (`expandRecurringEvents`); without, none, so a
   * caller that lists events as they are never sees a cancelled occurrence as an event.
   */
  async listEvents(from?: string, to?: string, options: { exceptions?: boolean } = {}): Promise<ListEventsResponse> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (options.exceptions) params.set('exceptions', 'true');
    const qs = params.toString();
    return request<ListEventsResponse>(`/api/v1/calendar/events${qs ? `?${qs}` : ''}`);
  },

  async createEvent(body: CreateEventRequest): Promise<EventResponse> {
    return request<EventResponse>('/api/v1/calendar/events', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async getEvent(eventId: string): Promise<EventResponse> {
    return request<EventResponse>(`/api/v1/calendar/events/${eventId}`);
  },

  async updateEvent(eventId: string, body: UpdateEventRequest): Promise<EventResponse> {
    return request<EventResponse>(`/api/v1/calendar/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  async deleteEvent(eventId: string): Promise<void> {
    return request<void>(`/api/v1/calendar/events/${eventId}`, { method: 'DELETE' });
  },

  // ── One occurrence of a repeating event ─────────────────────────────────
  // `originalStart` is the occurrence's start in its series, before any edit.

  /** "This event": saves the changes to one occurrence only. */
  async editOccurrence(seriesId: string, originalStart: string, body: UpdateEventRequest): Promise<EventResponse> {
    return request<EventResponse>(
      `/api/v1/calendar/events/${seriesId}/occurrences/${encodeURIComponent(originalStart)}`,
      { method: 'PUT', body: JSON.stringify(body) },
    );
  },

  /** "Delete this event". */
  async cancelOccurrence(seriesId: string, originalStart: string): Promise<void> {
    return request<void>(
      `/api/v1/calendar/events/${seriesId}/occurrences/${encodeURIComponent(originalStart)}`,
      { method: 'DELETE' },
    );
  },

  /** "This and following": ends the series before the occurrence and starts a new one there. */
  async splitEvent(seriesId: string, body: SplitEventRequest): Promise<EventResponse> {
    return request<EventResponse>(`/api/v1/calendar/events/${seriesId}/split`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /** "Delete this and following events". */
  async deleteEventFrom(seriesId: string, originalStart: string): Promise<void> {
    return request<void>(
      `/api/v1/calendar/events/${seriesId}?fromOccurrence=${encodeURIComponent(originalStart)}`,
      { method: 'DELETE' },
    );
  },

  // ── Reminders ───────────────────────────────────────────────────────────

  async listReminders(eventId?: string): Promise<ListRemindersResponse> {
    const qs = eventId ? `?eventId=${encodeURIComponent(eventId)}` : '';
    return request<ListRemindersResponse>(`/api/v1/calendar/reminders${qs}`);
  },

  async listTaskReminders(taskId: string): Promise<ListRemindersResponse> {
    return request<ListRemindersResponse>(
      `/api/v1/calendar/reminders?taskId=${encodeURIComponent(taskId)}`
    );
  },

  async createReminder(body: CreateReminderRequest): Promise<ReminderResponse> {
    return request<ReminderResponse>('/api/v1/calendar/reminders', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async updateReminder(reminderId: string, body: UpdateReminderRequest): Promise<ReminderResponse> {
    return request<ReminderResponse>(`/api/v1/calendar/reminders/${reminderId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  /**
   * "Delete this reminder" for a repeating one: moves it on to its next occurrence, or deletes
   * it once its rule has run out.
   */
  async skipReminder(reminderId: string, timezone: string): Promise<{ series: ReminderResponse | null }> {
    return request<{ series: ReminderResponse | null }>(`/api/v1/calendar/reminders/${reminderId}/skip`, {
      method: 'POST',
      body: JSON.stringify({ timezone }),
    });
  },

  /**
   * "Edit this reminder" for a repeating one: the current occurrence becomes a one-off reminder
   * with the changes, and the series moves on to its next occurrence.
   */
  async editReminderOccurrence(reminderId: string, body: ReminderOccurrenceRequest): Promise<ReminderOccurrenceResponse> {
    return request<ReminderOccurrenceResponse>(`/api/v1/calendar/reminders/${reminderId}/occurrence`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async deleteReminder(reminderId: string): Promise<void> {
    return request<void>(`/api/v1/calendar/reminders/${reminderId}`, { method: 'DELETE' });
  },

  // ── Attachments ─────────────────────────────────────────────────────────

  async listAttachments(eventId: string): Promise<ListAttachmentsResponse> {
    return request<ListAttachmentsResponse>(`/api/v1/calendar/events/${eventId}/attachments`);
  },

  async createAttachment(eventId: string, body: CreateAttachmentRequest): Promise<AttachmentResponse> {
    return request<AttachmentResponse>(`/api/v1/calendar/events/${eventId}/attachments`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async deleteAttachment(eventId: string, attachmentId: string): Promise<void> {
    return request<void>(`/api/v1/calendar/events/${eventId}/attachments/${attachmentId}`, { method: 'DELETE' });
  },

  // ── Task Lists ──────────────────────────────────────────────────────────

  async listTaskLists(): Promise<ListTaskListsResponse> {
    return request<ListTaskListsResponse>('/api/v1/calendar/tasks/lists');
  },

  async createTaskList(body: CreateTaskListRequest): Promise<TaskListResponse> {
    return request<TaskListResponse>('/api/v1/calendar/tasks/lists', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async listTasks(listId: string): Promise<ListTasksResponse> {
    return request<ListTasksResponse>(`/api/v1/calendar/tasks?listId=${encodeURIComponent(listId)}`);
  },

  async listAllTasks(): Promise<TaskResponse[]> {
    return request<TaskResponse[]>('/api/v1/calendar/tasks');
  },

  async createTask(body: CreateTaskRequest): Promise<TaskResponse> {
    return request<TaskResponse>('/api/v1/calendar/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async addTaskToList(taskId: string, listId: string): Promise<void> {
    return request<void>(`/api/v1/calendar/tasks/${taskId}/lists/${listId}`, {
      method: 'POST',
    });
  },

  async updateTask(taskId: string, body: UpdateTaskRequest): Promise<TaskResponse> {
    return request<TaskResponse>(`/api/v1/calendar/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async reorderTasks(body: ReorderTasksRequest): Promise<void> {
    return request<void>('/api/v1/calendar/tasks/reorder', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  // ── Task scheduling ─────────────────────────────────────────────────────

  /** Put a task on the calendar, or move the event it is already scheduled as. */
  async scheduleTask(taskId: string, body: ScheduleTaskRequest): Promise<EventResponse> {
    return request<EventResponse>(`/api/v1/calendar/tasks/${taskId}/event`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /** Take a task off the calendar, deleting the event it was scheduled as. */
  async unscheduleTask(taskId: string): Promise<TaskResponse> {
    return request<TaskResponse>(`/api/v1/calendar/tasks/${taskId}/event`, {
      method: 'DELETE',
    });
  },

  // ── Task attachments ────────────────────────────────────────────────────

  async listTaskAttachments(taskId: string): Promise<ListTaskAttachmentsResponse> {
    return request<ListTaskAttachmentsResponse>(`/api/v1/calendar/tasks/${taskId}/attachments`);
  },

  async createTaskAttachment(
    taskId: string,
    body: CreateAttachmentRequest
  ): Promise<TaskAttachmentResponse> {
    return request<TaskAttachmentResponse>(`/api/v1/calendar/tasks/${taskId}/attachments`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async deleteTaskAttachment(taskId: string, attachmentId: string): Promise<void> {
    return request<void>(`/api/v1/calendar/tasks/${taskId}/attachments/${attachmentId}`, {
      method: 'DELETE',
    });
  },

  // ── Connections ─────────────────────────────────────────────────────────

  async listConnections(): Promise<ListConnectionsResponse> {
    return request<ListConnectionsResponse>('/api/v1/calendar/connections');
  },

  async connectGoogle(): Promise<{ authUrl: string }> {
    return request<{ authUrl: string }>('/api/v1/calendar/connections/google', { method: 'POST' });
  },

  /**
   * Step 2 of the Google OAuth flow.
   * The frontend callback page captures the authorization code from the URL
   * and calls this method to exchange it for tokens on the backend.
   * This endpoint is authenticated with the user's existing JWT.
   */
  async completeGoogleOAuth(code: string): Promise<ConnectionResponse> {
    return request<ConnectionResponse>('/api/v1/calendar/connections/google/complete', {
      method: 'POST',
      body: JSON.stringify({ code } satisfies CompleteGoogleOAuthRequest),
    });
  },

  async connectOutlook(): Promise<{ authUrl: string }> {
    return request<{ authUrl: string }>('/api/v1/calendar/connections/outlook', { method: 'POST' });
  },

  /**
   * Step 2 of the Outlook OAuth flow — the counterpart of
   * {@link calendarApi.completeGoogleOAuth}, called by the callback page with the
   * code Microsoft put in the URL and the user's existing JWT.
   */
  async completeOutlookOAuth(code: string): Promise<ConnectionResponse> {
    return request<ConnectionResponse>('/api/v1/calendar/connections/outlook/complete', {
      method: 'POST',
      body: JSON.stringify({ code } satisfies CompleteOutlookOAuthRequest),
    });
  },

  async connectApple(body: CreateAppleConnectionRequest): Promise<ConnectionResponse> {
    return request<ConnectionResponse>('/api/v1/calendar/connections/apple', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async disconnectConnection(connectionId: string): Promise<void> {
    return request<void>(`/api/v1/calendar/connections/${connectionId}`, { method: 'DELETE' });
  },

  async triggerSync(connectionId: string): Promise<TriggerSyncResponse> {
    return request<TriggerSyncResponse>('/api/v1/calendar/sync/trigger', {
      method: 'POST',
      body: JSON.stringify({ connectionId }),
    });
  },
};
