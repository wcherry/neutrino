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
  createdAt: string;
  updatedAt: string;
}

export interface CreateReminderRequest {
  title: string;
  dueTime: string;
  recurrenceRule?: string | null;
  linkedEventId?: string | null;
}

export interface UpdateReminderRequest {
  title?: string;
  dueTime?: string;
  completed?: boolean;
  recurrenceRule?: string | null;
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
  createdAt: string;
  updatedAt: string;
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
}

export interface UpdateTaskRequest {
  title?: string;
  notes?: string | null;
  done?: boolean;
  dueDate?: string | null;
  position?: number;
}

export interface ReorderTasksRequest {
  listId: string;
  /** Task IDs in the desired new order (index 0 = position 0). */
  taskIds: string[];
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

export interface TriggerSyncResponse {
  eventsSynced: number;
}

// ---------------------------------------------------------------------------

export const calendarApi = {
  // ── Events ──────────────────────────────────────────────────────────────

  async listEvents(from?: string, to?: string): Promise<ListEventsResponse> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    return request<ListEventsResponse>(`/api/v1/events${qs ? `?${qs}` : ''}`);
  },

  async createEvent(body: CreateEventRequest): Promise<EventResponse> {
    return request<EventResponse>('/api/v1/events', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async getEvent(eventId: string): Promise<EventResponse> {
    return request<EventResponse>(`/api/v1/events/${eventId}`);
  },

  async updateEvent(eventId: string, body: UpdateEventRequest): Promise<EventResponse> {
    return request<EventResponse>(`/api/v1/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  async deleteEvent(eventId: string): Promise<void> {
    return request<void>(`/api/v1/events/${eventId}`, { method: 'DELETE' });
  },

  // ── Reminders ───────────────────────────────────────────────────────────

  async listReminders(eventId?: string): Promise<ListRemindersResponse> {
    const qs = eventId ? `?eventId=${encodeURIComponent(eventId)}` : '';
    return request<ListRemindersResponse>(`/api/v1/reminders${qs}`);
  },

  async createReminder(body: CreateReminderRequest): Promise<ReminderResponse> {
    return request<ReminderResponse>('/api/v1/reminders', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async updateReminder(reminderId: string, body: UpdateReminderRequest): Promise<ReminderResponse> {
    return request<ReminderResponse>(`/api/v1/reminders/${reminderId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async deleteReminder(reminderId: string): Promise<void> {
    return request<void>(`/api/v1/reminders/${reminderId}`, { method: 'DELETE' });
  },

  // ── Attachments ─────────────────────────────────────────────────────────

  async listAttachments(eventId: string): Promise<ListAttachmentsResponse> {
    return request<ListAttachmentsResponse>(`/api/v1/events/${eventId}/attachments`);
  },

  async createAttachment(eventId: string, body: CreateAttachmentRequest): Promise<AttachmentResponse> {
    return request<AttachmentResponse>(`/api/v1/events/${eventId}/attachments`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async deleteAttachment(eventId: string, attachmentId: string): Promise<void> {
    return request<void>(`/api/v1/events/${eventId}/attachments/${attachmentId}`, { method: 'DELETE' });
  },

  // ── Task Lists ──────────────────────────────────────────────────────────

  async listTaskLists(): Promise<ListTaskListsResponse> {
    return request<ListTaskListsResponse>('/api/v1/tasks/lists');
  },

  async createTaskList(body: CreateTaskListRequest): Promise<TaskListResponse> {
    return request<TaskListResponse>('/api/v1/tasks/lists', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async listTasks(listId: string): Promise<ListTasksResponse> {
    return request<ListTasksResponse>(`/api/v1/tasks?listId=${encodeURIComponent(listId)}`);
  },

  async listAllTasks(): Promise<TaskResponse[]> {
    return request<TaskResponse[]>('/api/v1/tasks');
  },

  async createTask(body: CreateTaskRequest): Promise<TaskResponse> {
    return request<TaskResponse>('/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async addTaskToList(taskId: string, listId: string): Promise<void> {
    return request<void>(`/api/v1/tasks/${taskId}/lists/${listId}`, {
      method: 'POST',
    });
  },

  async updateTask(taskId: string, body: UpdateTaskRequest): Promise<TaskResponse> {
    return request<TaskResponse>(`/api/v1/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async reorderTasks(body: ReorderTasksRequest): Promise<void> {
    return request<void>('/api/v1/tasks/reorder', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  // ── Connections ─────────────────────────────────────────────────────────

  async listConnections(): Promise<ListConnectionsResponse> {
    return request<ListConnectionsResponse>('/api/v1/connections');
  },

  async connectGoogle(): Promise<{ authUrl: string }> {
    return request<{ authUrl: string }>('/api/v1/connections/google', { method: 'POST' });
  },

  /**
   * Step 2 of the Google OAuth flow.
   * The frontend callback page captures the authorization code from the URL
   * and calls this method to exchange it for tokens on the backend.
   * This endpoint is authenticated with the user's existing JWT.
   */
  async completeGoogleOAuth(code: string): Promise<ConnectionResponse> {
    return request<ConnectionResponse>('/api/v1/connections/google/complete', {
      method: 'POST',
      body: JSON.stringify({ code } satisfies CompleteGoogleOAuthRequest),
    });
  },

  async connectOutlook(): Promise<{ authUrl: string }> {
    return request<{ authUrl: string }>('/api/v1/connections/outlook', { method: 'POST' });
  },

  async connectApple(body: CreateAppleConnectionRequest): Promise<ConnectionResponse> {
    return request<ConnectionResponse>('/api/v1/connections/apple', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async disconnectConnection(connectionId: string): Promise<void> {
    return request<void>(`/api/v1/connections/${connectionId}`, { method: 'DELETE' });
  },

  async triggerSync(connectionId: string): Promise<TriggerSyncResponse> {
    return request<TriggerSyncResponse>('/api/v1/sync/trigger', {
      method: 'POST',
      body: JSON.stringify({ connectionId }),
    });
  },
};
