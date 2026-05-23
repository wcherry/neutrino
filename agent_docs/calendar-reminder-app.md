🎯 Goals (What you’re building)

A unified module that:
	•	Imports and parses .ics files
	•	Syncs with Google, Apple (iCloud), and Outlook calendars
	•	Supports native event + reminder creation
	•	Stores attachments via neutrino-drive
	•	Works as a first-class internal service in your microservices architecture

⸻

🧱 High-Level Architecture

New Services
	1.	calendar-service (Rust)
	•	Core event storage + recurrence logic
	•	ICS import/export
	•	Sync orchestration
	2.	reminder-service (Rust)
	•	Lightweight task/reminder system
	•	Scheduling + notification triggers
	3.	calendar-sync-worker (Rust async worker)
	•	Background sync with external providers
	•	Webhook + polling hybrid model

⸻

Existing Service Integration
	•	neutrino-drive
	•	Store attachments (files linked to events/reminders)
	•	Store raw .ics imports for audit/reprocessing
	•	auth service
	•	OAuth tokens for Google/Microsoft
	•	Account linking

⸻

📦 Phase 1: Core Data Model & Storage

Schema Design (Postgres recommended)

Events

events (
  id UUID PK,
  user_id UUID,
  title TEXT,
  description TEXT,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  all_day BOOLEAN,
  location TEXT,
  recurrence_rule TEXT, -- RRULE (RFC5545)
  external_id TEXT,     -- provider mapping
  source TEXT,          -- google/apple/outlook/local
  created_at,
  updated_at
)

Reminders

reminders (
  id UUID PK,
  user_id UUID,
  title TEXT,
  due_time TIMESTAMP,
  completed BOOLEAN,
  recurrence_rule TEXT,
  linked_event_id UUID NULL,
  created_at,
  updated_at
)

Attachments (via neutrino-drive)

event_attachments (
  id UUID,
  event_id UUID,
  file_id UUID, -- from neutrino-drive
)

Calendar Connections

calendar_connections (
  id UUID,
  user_id UUID,
  provider TEXT, -- google/outlook/apple
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMP,
  sync_cursor TEXT
)


⸻

📥 Phase 2: ICS Import + Export

Features
	•	Upload .ics
	•	Parse into events/reminders
	•	Handle:
	•	Recurrence rules (RRULE)
	•	Timezones
	•	Attendees (optional v1 skip)

Rust Libraries
	•	ical
	•	chrono
	•	rrule (or custom parser if needed)

Flow

Upload .ics → store raw file (neutrino-drive)
            → parse → normalize → insert events

Edge Cases
	•	Duplicate detection (UID in ICS)
	•	Timezone normalization (store UTC)
	•	Recurring exceptions (EXDATE)

⸻

🔗 Phase 3: External Calendar Integration

3.1 Google Calendar
	•	API: Google Calendar API
	•	Auth: OAuth2 via your auth service

Features:
	•	Read/write events
	•	Push notifications (webhooks)

⸻

3.2 Outlook (Microsoft Graph)
	•	API: Microsoft Graph
	•	Similar to Google flow

⸻

3.3 Apple Calendar (iCloud)

⚠️ No full public API like Google/Microsoft

Options:
	•	CalDAV integration (recommended)
	•	Libraries:
	•	dav / caldav crates or HTTP-based implementation

⸻

Sync Strategy

Hybrid Model
	•	Webhooks (Google/Microsoft)
	•	Polling fallback (Apple + reliability)

⸻

Sync Flow

Initial Sync:
  pull all events → map external_id

Incremental Sync:
  use sync tokens / delta queries

Conflict Resolution:
  last_write_wins OR version vector (v2)


⸻

⏰ Phase 4: Reminder Engine

Capabilities
	•	One-time reminders
	•	Recurring reminders
	•	Event-based reminders (e.g. “10 min before”)

Implementation

Use:
	•	Background worker + queue (Redis or Postgres-based)

Options:
	•	tokio + cron-like scheduler
	•	Or use something like apalis / fang

⸻

Trigger Flow

Reminder due → enqueue notification → send via:
  - email
  - push (future)
  - in-app


⸻

📎 Phase 5: Attachments via Neutrino Drive

Flow

Upload file → neutrino-drive → file_id
Attach to event/reminder → store reference

Features
	•	Preview attachments
	•	Versioning inherited from drive
	•	Permission alignment with event ownership

⸻

🧠 Phase 6: API Design

Calendar API

GET   /events
POST  /events
PUT   /events/{id}
DELETE/events/{id}

POST  /events/import-ics
GET   /events/export-ics

Reminder API

GET   /reminders
POST  /reminders
PATCH /reminders/{id}

Sync API

POST /connections/google
POST /connections/outlook
POST /connections/apple

POST /sync/trigger


⸻

🖥️ Phase 7: Frontend (UI Layer)

Core Views
	•	Calendar (month/week/day)
	•	Agenda view
	•	Reminder list

Key UX Features
	•	Drag-to-create event
	•	Inline editing
	•	Natural language input:
“Dinner tomorrow at 7”

⸻

⚙️ Phase 8: Recurrence + Time Handling

This is the hardest part—do it carefully.

Requirements
	•	RFC 5545 RRULE support
	•	Timezone-safe calculations
	•	Exception dates (EXDATE)

Strategy
	•	Store:
	•	Base event
	•	RRULE string
	•	Expand occurrences at query time (with caching)

⸻

🔄 Phase 9: Sync + Conflict Resolution

Version 1 (simple)
	•	External wins if newer
	•	Local wins if manually edited

Version 2 (advanced)
	•	Event versioning
	•	Merge strategy per field

⸻

🔐 Phase 10: Security + Permissions
	•	Encrypt tokens at rest
	•	Scope-based API access
	•	Event sharing (future phase)

⸻

🚀 Phase 11: Performance & Scaling

Key Optimizations
	•	Index:
	•	start_time
	•	user_id + start_time
	•	Cache:
	•	Expanded recurring events
	•	Batch sync operations

⸻

🧪 Phase 12: Testing Strategy

Must-have tests
	•	ICS parsing edge cases
	•	Recurrence correctness
	•	Timezone conversions
	•	Sync conflict scenarios

⸻

📅 Suggested Timeline (Aggressive but realistic)

Week 1–2
	•	Schema + core event/reminder APIs

Week 3
	•	ICS import/export

Week 4–5
	•	Google + Outlook integration

Week 6
	•	Apple (CalDAV)

Week 7
	•	Reminder engine

Week 8
	•	Attachments + UI integration

⸻

🧩 Reuse from Neutrino Drive

Leverage:
	•	File storage abstraction
	•	Metadata + versioning
	•	Access control

Avoid rebuilding:
	•	Upload handling
	•	File lifecycle

⸻

⚠️ Biggest Risks
	1.	Recurrence correctness (RRULE is tricky)
	2.	Apple Calendar integration (CalDAV complexity)
	3.	Sync conflicts across providers
	4.	Timezone bugs (these WILL happen)

⸻

💡 Smart Enhancements (Post-MVP)
	•	AI scheduling assistant
	•	Meeting availability sharing
	•	Smart reminders (“leave now” alerts)
	•	Calendar analytics (time usage)
