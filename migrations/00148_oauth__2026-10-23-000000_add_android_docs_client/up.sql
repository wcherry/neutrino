-- Register the Neutrino Docs Android app as an OAuth client. Its client id is declared in
-- neutrino_shared_android (`NeutrinoApps.docs`); without this row the app's sign-in is rejected as
-- an unknown client.
--
-- OR IGNORE: this migration was 00143 on its branch until main took that number, so a database
-- that ran the branch already has the row, recorded under a version that is now main's.
INSERT OR IGNORE INTO oauth_clients (id, name, redirect_uris)
VALUES ('neutrino-docs-android', 'Neutrino Docs Android', '["neutrino://oauth/callback"]');
