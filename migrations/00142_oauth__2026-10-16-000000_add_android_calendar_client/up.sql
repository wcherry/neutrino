-- Register the Neutrino Calendar Android app as an OAuth client. Its client id is declared in
-- neutrino_calendar_android_mobile (`CalendarApp.config`); without this row the app's sign-in is
-- rejected as an unknown client.
INSERT INTO oauth_clients (id, name, redirect_uris)
VALUES ('neutrino-calendar-android', 'Neutrino Calendar Android', '["neutrino://oauth/callback"]');
