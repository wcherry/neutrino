-- Authorization codes reference the client, so they go first.
DELETE FROM oauth_authorization_codes
WHERE client_id IN ('neutrino-notes-android', 'neutrino-sheets-android', 'neutrino-photos-android');
DELETE FROM oauth_clients
WHERE id IN ('neutrino-notes-android', 'neutrino-sheets-android', 'neutrino-photos-android');
