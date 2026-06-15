CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed a default desktop client for development
INSERT INTO oauth_clients (id, name, redirect_uris)
VALUES (
  'neutrino-desktop',
  'Neutrino Desktop App',
  '["neutrino://oauth/callback","http://localhost:8080/callback"]'
);
