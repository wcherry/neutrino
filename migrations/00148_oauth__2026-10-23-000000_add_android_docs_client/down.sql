-- Authorization codes reference the client, so they go first.
DELETE FROM oauth_authorization_codes WHERE client_id = 'neutrino-docs-android';
DELETE FROM oauth_clients WHERE id = 'neutrino-docs-android';
