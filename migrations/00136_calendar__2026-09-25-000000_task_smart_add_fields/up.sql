-- Give a task the fields RTM-style Smart Add can fill in from one typed line:
--
--   Buy milk ^tomorrow 5pm !1 #errands *weekly =15min ~today @Safeway // semi-skimmed
--
-- Parsing happens on the clients (web and iOS, against one shared fixture
-- table); the server only stores what they send. Every column is nullable or
-- defaulted, so a client that has never heard of Smart Add reads and writes
-- tasks exactly as before.

-- ── Due and start times ──────────────────────────────────────────────────────
--
-- `due_date` has always been a *date*: the clients write `<day>T00:00:00Z` and
-- read the date part back in UTC so it names the same day in every zone. "^fri
-- 3pm" needs a time as well, and a timed due is an ordinary UTC instant instead.
-- The flag says which reading applies; without it a 5pm-in-London task and a
-- date-only one would be indistinguishable. Same for the start date.
ALTER TABLE tasks ADD COLUMN due_has_time BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN start_date TIMESTAMP;
ALTER TABLE tasks ADD COLUMN start_has_time BOOLEAN NOT NULL DEFAULT 0;

-- ── Priority, estimate, location ─────────────────────────────────────────────
--
-- Priority is RTM's 1 (high) to 3 (low); NULL is "no priority", which is what
-- every existing task has. The service refuses anything else.
ALTER TABLE tasks ADD COLUMN priority INTEGER;
ALTER TABLE tasks ADD COLUMN estimate_minutes INTEGER;
ALTER TABLE tasks ADD COLUMN location TEXT;

-- ── Repeat ───────────────────────────────────────────────────────────────────
--
-- An RRULE body, the same strings reminders and events store, so it steps with
-- `calendar::recurrence`. `repeat_after_completion` is RTM's "*after 2 weeks":
-- the next occurrence counts from the day the task was completed rather than
-- from its due date, which RRULE has no way to say.
--
-- Completing a repeating task marks it done and inserts the next occurrence as
-- a new row, so the completed one stays in the history.
ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT;
ALTER TABLE tasks ADD COLUMN repeat_after_completion BOOLEAN NOT NULL DEFAULT 0;

-- ── Tags ─────────────────────────────────────────────────────────────────────
--
-- Free-form, stored lowercase without the '#'. A tag is only a word on a task,
-- so it is a column of the membership rather than a row of its own: there is no
-- tag to create, rename or delete apart from the tasks carrying it. (Drive's
-- `tags` table is per-user named tags for files and is not shared with this.)
CREATE TABLE task_tags (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL,
    PRIMARY KEY (task_id, tag)
);

CREATE INDEX idx_task_tags_tag ON task_tags (tag);
