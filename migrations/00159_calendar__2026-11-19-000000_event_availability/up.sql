-- How an event shows a person's time: busy (the default, and what every existing event was),
-- free, tentative or away (out of office). iCalendar carries it as TRANSP plus Microsoft's
-- X-MICROSOFT-CDO-BUSYSTATUS; see src/calendar/events/availability.rs.
--
-- Additive: clients that don't know the column never send it, and their events stay busy.
ALTER TABLE events ADD COLUMN availability TEXT NOT NULL DEFAULT 'busy'
    CHECK (availability IN ('busy', 'free', 'tentative', 'away'));
