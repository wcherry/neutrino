-- Calendars (agent_docs/calendars.md): every event belongs to one, a named and coloured group a
-- user can show or hide, and which may be read-only. `kind` is `local` (the user's own; one per
-- user is the default), `connection` (a synced provider's events; `source` names the provider, as
-- events.source does) or `holidays` (computed by the clients from `country`, `region` and
-- `include_observances`; it holds no events).
CREATE TABLE calendars (
    id                  TEXT PRIMARY KEY NOT NULL,
    user_id             TEXT NOT NULL,
    name                TEXT NOT NULL,
    color               TEXT NOT NULL,
    visible             BOOLEAN NOT NULL DEFAULT 1,
    read_only           BOOLEAN NOT NULL DEFAULT 0,
    kind                TEXT NOT NULL DEFAULT 'local',
    is_default          BOOLEAN NOT NULL DEFAULT 0,
    source              TEXT NULL,
    country             TEXT NULL,
    region              TEXT NULL,
    include_observances BOOLEAN NOT NULL DEFAULT 0,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_calendars_user ON calendars (user_id);
CREATE UNIQUE INDEX idx_calendars_default ON calendars (user_id) WHERE is_default = 1;
CREATE UNIQUE INDEX idx_calendars_source ON calendars (user_id, source) WHERE kind = 'connection';
CREATE UNIQUE INDEX idx_calendars_country ON calendars (user_id, country) WHERE kind = 'holidays';

-- A default calendar for every user, and for every owner of an event (events.user_id has no
-- foreign key, so the two needn't agree). Users added later get theirs when they first need it.
INSERT INTO calendars (id, user_id, name, color, kind, is_default)
SELECT lower(hex(randomblob(16))), user_id, 'Calendar', '#3b82f6', 'local', 1
FROM (SELECT id AS user_id FROM users UNION SELECT user_id FROM events);

-- A calendar for each provider a user has synced events from or is connected to.
INSERT INTO calendars (id, user_id, name, color, kind, source)
SELECT lower(hex(randomblob(16))), user_id,
       CASE source WHEN 'google' THEN 'Google Calendar'
                   WHEN 'outlook' THEN 'Outlook Calendar'
                   ELSE 'Apple Calendar' END,
       CASE source WHEN 'google' THEN '#16a34a'
                   WHEN 'outlook' THEN '#0ea5e9'
                   ELSE '#f97316' END,
       'connection', source
FROM (SELECT user_id, source FROM events WHERE source IN ('google', 'outlook', 'apple')
      UNION SELECT user_id, provider FROM calendar_connections
            WHERE provider IN ('google', 'outlook', 'apple'));

-- NULL only on a row deleted with its calendar and not yet purged.
ALTER TABLE events ADD COLUMN calendar_id TEXT NULL REFERENCES calendars(id) ON DELETE SET NULL;

-- Every existing event into its calendar. `updated_at` is left alone: nothing a client shows
-- changed, and bumping it would send every event down every client's changes feed again.
UPDATE events SET calendar_id = (
    SELECT c.id FROM calendars c
    WHERE c.user_id = events.user_id AND c.kind = 'connection' AND c.source = events.source
) WHERE source IN ('google', 'outlook', 'apple');
UPDATE events SET calendar_id = (
    SELECT c.id FROM calendars c WHERE c.user_id = events.user_id AND c.is_default = 1
) WHERE calendar_id IS NULL;

CREATE INDEX idx_events_calendar ON events (calendar_id);
