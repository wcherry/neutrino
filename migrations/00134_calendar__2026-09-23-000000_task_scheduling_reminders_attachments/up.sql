-- Give a task the three things the task editor offers: a reminder, a place on
-- the calendar, and attachments.
--
-- All three already exist for an *event* and only for an event. `reminders`
-- carries `linked_event_id`, `event_attachments.event_id` is NOT NULL, and a
-- task has never been on the calendar at all. That is why the web task sidebar
-- could only ever show a title and a checkbox: there was nowhere to put
-- anything else.
--
-- Nothing here is a change to the event side. A reminder gains a second,
-- separately nullable link rather than a polymorphic (owner_type, owner_id)
-- pair, and task attachments get their own table rather than
-- `event_attachments` losing its NOT NULL. Both choices are the same trade: a
-- foreign key that names what it points at can be enforced by the database and
-- read by a person, and the two owners are not interchangeable anywhere in the
-- product -- an event reminder fires against the event's start time and a task
-- reminder against a time the user picked.

-- ── A reminder can belong to a task ──────────────────────────────────────────
--
-- Nullable, and a reminder with neither link is still what it always was: a
-- standalone reminder, which is what the sidebar's Reminders section lists. The
-- web client filters that section by `linkedEventId == null`, so it now filters
-- on `linkedTaskId` too -- a task's reminders belong in the task, not loose in
-- the list beside it.
ALTER TABLE reminders ADD COLUMN linked_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE;

-- The one query this column exists to serve: every reminder on one task, read
-- each time the task editor opens.
CREATE INDEX idx_reminders_task ON reminders (linked_task_id);

-- ── A task can be on the calendar ────────────────────────────────────────────
--
-- Scheduling a task creates an ordinary row in `events` and records its id
-- here, so the task appears in Month, Week and Agenda with no view needing to
-- learn about tasks. The link is the task's, not the event's: `events` is also
-- written by the CalDAV/Google/Outlook sync (`calendar::connections`), and a
-- column there would be one more thing an imported event has to not break.
--
-- NULL means "not on the calendar", which is the state every existing task is
-- in. Unscheduling deletes the event and sets this back to NULL, so there is
-- exactly one row that can be stale -- this one -- and the service treats an
-- event id that no longer resolves as unscheduled rather than as an error.
ALTER TABLE tasks ADD COLUMN event_id TEXT;

CREATE INDEX idx_tasks_event ON tasks (event_id);

-- ── A task can carry attachments ─────────────────────────────────────────────
--
-- Column for column what `event_attachments` became in 00013: a nullable
-- `file_id` for a Drive file (a doc, a sheet, a photo -- anything in Drive) and
-- a `note` for inline text, with the service refusing a row that is neither.
-- `name` is the display name captured at the time the file was picked, so a
-- renamed Drive file still reads sensibly here and the listing needs no join.
--
-- ON DELETE CASCADE because an attachment is part of the task rather than a
-- thing of its own; the Drive file it points at is untouched, since attaching a
-- file is a reference and never a copy.
CREATE TABLE task_attachments (
    id      TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    file_id TEXT,
    name    TEXT,
    note    TEXT
);

CREATE INDEX idx_task_attachments_task ON task_attachments (task_id);
