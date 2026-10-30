-- Authorization codes reference the client, so they go first.
DELETE FROM oauth_authorization_codes WHERE client_id IN ('neutrino-atlas-mac', 'neutrino-atlas-ios');
DELETE FROM oauth_clients WHERE id IN ('neutrino-atlas-mac', 'neutrino-atlas-ios');
