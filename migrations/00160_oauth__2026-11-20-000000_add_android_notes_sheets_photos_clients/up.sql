-- Register the Neutrino Notes, Sheets and Photos Android apps as OAuth clients. Their client ids are
-- declared in neutrino_shared_android (`NeutrinoApps.notes`, `.sheets`, `.photos`); without these
-- rows their sign-in is rejected as an unknown client. Notes is the first of the three to ship; the
-- other two are registered now so their ports need no migration of their own.
INSERT OR IGNORE INTO oauth_clients (id, name, redirect_uris)
VALUES ('neutrino-notes-android', 'Neutrino Notes Android', '["neutrino://oauth/callback"]'),
       ('neutrino-sheets-android', 'Neutrino Sheets Android', '["neutrino://oauth/callback"]'),
       ('neutrino-photos-android', 'Neutrino Photos Android', '["neutrino://oauth/callback"]');
