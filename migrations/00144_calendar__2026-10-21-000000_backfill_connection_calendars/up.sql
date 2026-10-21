-- A calendar for each connected provider that has none: one connected after 00139 that hasn't
-- synced yet, since the calendar used to be made on the first sync. It is now made on connect.
-- The name and colour match `provider_look` in src/calendar/calendars/store.rs.
INSERT OR IGNORE INTO calendars (id, user_id, name, color, kind, source)
SELECT lower(hex(randomblob(16))), c.user_id,
       CASE c.provider WHEN 'google' THEN 'Google Calendar'
                       WHEN 'outlook' THEN 'Outlook Calendar'
                       ELSE 'Apple Calendar' END,
       CASE c.provider WHEN 'google' THEN '#16a34a'
                       WHEN 'outlook' THEN '#0ea5e9'
                       ELSE '#f97316' END,
       'connection', c.provider
FROM (SELECT DISTINCT user_id, provider FROM calendar_connections
      WHERE provider IN ('google', 'outlook', 'apple')) c
WHERE NOT EXISTS (
    SELECT 1 FROM calendars k
    WHERE k.user_id = c.user_id AND k.kind = 'connection' AND k.source = c.provider
);
