-- Register the Neutrino Drive Android app as an OAuth client. Its client id is declared in
-- neutrino_drive_android_mobile (`AppConfig.OAUTH_CLIENT_ID`); without this row the app's sign-in
-- is rejected as an unknown client.
INSERT INTO oauth_clients (id, name, redirect_uris)
VALUES ('neutrino-android', 'Neutrino Drive Android', '["neutrino://oauth/callback"]');
