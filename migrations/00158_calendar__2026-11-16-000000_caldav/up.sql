-- CalDAV: Neutrino as a calendar and reminders account on the iPhone (and any CalDAV client).
-- Design: agent_docs/caldav.md. Plan: agent_docs/plans/2026-11-16-caldav-server.md.
--
-- Additive: three new tables and triggers that write into one of them. Nothing existing reads
-- them, and no column of `events`, `tasks` or `task_lists` changes.

-- App passwords: what a CalDAV client signs in with (HTTP Basic, the account email and one of
-- these). The account password is never accepted on /dav. Shown once; only the hash is kept.
CREATE TABLE app_passwords (
    id            TEXT PRIMARY KEY NOT NULL,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    scope         TEXT NOT NULL,
    created_at    TIMESTAMP NOT NULL,
    last_used_at  TIMESTAMP,
    revoked_at    TIMESTAMP
);

CREATE INDEX idx_app_passwords_user ON app_passwords (user_id);

-- What a CalDAV client knows an event series or a task by, kept beside the row rather than on
-- it: the client's UID, the resource name it PUT, the collection it is served in (for a task,
-- its home list, `list-inbox` for none), and the iCalendar it sent that Neutrino doesn't model
-- (alarms, subtask links, X-APPLE-*), merged back in on GET so nothing a phone wrote is lost.
-- A row exists only once a client has touched the object; before that every value is derived.
-- A row outlives its object until the change log forgets the object too: a client that named a
-- reminder itself learns of its deletion through that name.
CREATE TABLE dav_objects (
    kind       TEXT NOT NULL,
    object_id  TEXT NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    uid        TEXT NOT NULL,
    name       TEXT NOT NULL,
    collection TEXT NOT NULL,
    extra      TEXT,
    PRIMARY KEY (kind, object_id)
);

CREATE UNIQUE INDEX idx_dav_objects_uid ON dav_objects (user_id, kind, uid);
CREATE INDEX idx_dav_objects_name ON dav_objects (user_id, name);

-- The change log behind sync tokens. One row per write to an event series or a task, from
-- any path (the API, CalDAV, calendar sync), written by the triggers below so no write path
-- can forget. A row names the object, not the collection: a sync of a collection reports each
-- logged object as changed if it is now live there, and as removed otherwise, which also covers
-- an object moved out of it. Purged with deleted events, after 90 days.
CREATE TABLE dav_changes (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    object_id  TEXT NOT NULL,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dav_changes_user_seq ON dav_changes (user_id, seq);
CREATE INDEX idx_dav_changes_changed_at ON dav_changes (changed_at);

-- An exception's change is its series' change: a series is one CalDAV object.
CREATE TRIGGER dav_log_event_insert AFTER INSERT ON events
BEGIN
    INSERT INTO dav_changes (user_id, kind, object_id)
    VALUES (NEW.user_id, 'event', COALESCE(NEW.recurring_event_id, NEW.id));
END;

CREATE TRIGGER dav_log_event_update AFTER UPDATE ON events
BEGIN
    INSERT INTO dav_changes (user_id, kind, object_id)
    VALUES (NEW.user_id, 'event', COALESCE(NEW.recurring_event_id, NEW.id));
END;

CREATE TRIGGER dav_log_event_delete AFTER DELETE ON events
BEGIN
    INSERT INTO dav_changes (user_id, kind, object_id)
    VALUES (OLD.user_id, 'event', COALESCE(OLD.recurring_event_id, OLD.id));
END;

CREATE TRIGGER dav_log_task_insert AFTER INSERT ON tasks
BEGIN
    INSERT INTO dav_changes (user_id, kind, object_id) VALUES (NEW.user_id, 'task', NEW.id);
END;

CREATE TRIGGER dav_log_task_update AFTER UPDATE ON tasks
BEGIN
    INSERT INTO dav_changes (user_id, kind, object_id) VALUES (NEW.user_id, 'task', NEW.id);
END;

CREATE TRIGGER dav_log_task_delete AFTER DELETE ON tasks
BEGIN
    INSERT INTO dav_changes (user_id, kind, object_id) VALUES (OLD.user_id, 'task', OLD.id);
END;

-- Joining or leaving a list can change which collection a task is served in. When the task
-- itself is being deleted its row is already gone and nothing is logged here; its own trigger
-- has logged it.
CREATE TRIGGER dav_log_membership_insert AFTER INSERT ON task_list_memberships
BEGIN
    INSERT INTO dav_changes (user_id, kind, object_id)
    SELECT user_id, 'task', id FROM tasks WHERE id = NEW.task_id;
END;

CREATE TRIGGER dav_log_membership_delete AFTER DELETE ON task_list_memberships
BEGIN
    INSERT INTO dav_changes (user_id, kind, object_id)
    SELECT user_id, 'task', id FROM tasks WHERE id = OLD.task_id;
END;

-- A task moved between lists by a client changes its served collection without touching the
-- task row.
CREATE TRIGGER dav_log_object_move AFTER UPDATE OF collection ON dav_objects
BEGIN
    INSERT INTO dav_changes (user_id, kind, object_id) VALUES (NEW.user_id, NEW.kind, NEW.object_id);
END;
