-- Register the Neutrino Atlas apps as OAuth clients: the macOS app (neutrino_atlas_mac_desktop) and
-- the iOS app that follows it. Their client ids are declared in neutrino_shared_ios
-- (`NeutrinoAppConfig.macAtlas`, and the iOS entry when that app exists); without these rows their
-- sign-in is rejected as an unknown client. Both are registered now so the iOS app needs no
-- migration of its own.
INSERT OR IGNORE INTO oauth_clients (id, name, redirect_uris)
VALUES ('neutrino-atlas-mac', 'Neutrino Atlas macOS', '["neutrino://oauth/callback"]'),
       ('neutrino-atlas-ios', 'Neutrino Atlas iOS', '["neutrino://oauth/callback"]');
