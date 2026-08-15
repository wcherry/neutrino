CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed a client ids
INSERT INTO oauth_clients (id, name, redirect_uris)
VALUES 
  ('neutrino-desktop','Neutrino Desktop App','["neutrino://oauth/callback"]'),
  ('neutrino-ios','Neutrino Drive iOS','["neutrino://oauth/callback"]'),
  ('neutrino-notes-ios','Neutrino Notes iOS','["neutrino://oauth/callback"]'),
  ('neutrino-docs-ios','Neutrino Docs iOS','["neutrino://oauth/callback"]'),
  ('neutrino-sheets-ios','Neutrino Sheets iOS','["neutrino://oauth/callback"]');
