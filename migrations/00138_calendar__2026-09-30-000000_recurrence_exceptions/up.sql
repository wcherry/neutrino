-- Recurrence exceptions (agent_docs/recurrence-exceptions.md). An exception is an ordinary event
-- row standing in for one occurrence of a repeating event: `recurring_event_id` names the series,
-- `original_start_time` is the start the occurrence had in it, and `cancelled` deletes it.
ALTER TABLE events ADD COLUMN recurring_event_id TEXT NULL REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE events ADD COLUMN original_start_time TIMESTAMP NULL;
ALTER TABLE events ADD COLUMN cancelled BOOLEAN NOT NULL DEFAULT 0;

-- One live exception per occurrence; a series' exceptions are read together.
CREATE UNIQUE INDEX idx_events_exception
    ON events (recurring_event_id, original_start_time)
    WHERE recurring_event_id IS NOT NULL AND deleted_at IS NULL;
