-- Register the Neutrino Calendar iOS app as an OAuth client. Its client id is declared in
-- neutrino_shared_ios (`NeutrinoAppConfig.calendar`); without this row the app's sign-in is
-- rejected as an unknown client.
INSERT INTO oauth_clients (id, name, redirect_uris)
VALUES ('neutrino-calendar-ios', 'Neutrino Calendar iOS', '["neutrino://oauth/callback"]');
