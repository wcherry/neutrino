-- Authorization codes reference the client, so they go first.
DELETE FROM oauth_authorization_codes WHERE client_id = 'neutrino-calendar-ios';
DELETE FROM oauth_clients WHERE id = 'neutrino-calendar-ios';
