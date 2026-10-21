-- Synced user preferences (agent_docs/ui-customization-roadmap.md §3.2,
-- agent_docs/preference-registry.md).
--
-- Two tiers. `user_preferences` holds the plain tier: one row per key the
-- user has set, value as JSON text, validated against the server's catalog
-- (src/preferences/catalog.rs) on every write, so the server can read it —
-- theme, density, calendar week start. A key the user never set has no row and
-- resolves to the registry default on the client.
--
-- `user_preference_vault` holds the encrypted tier: one sealed blob per user
-- (the AI API key, personal libraries), sealed in the browser to the user's
-- own public key exactly like a file DEK. The server stores bytes it cannot
-- read. `updated_at` doubles as the version a write must name, so two devices
-- cannot silently overwrite each other's copy (409 instead).
--
-- Purely additive: no client running an older build reads these tables.
CREATE TABLE user_preferences (
    user_id    TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE user_preference_vault (
    user_id    TEXT PRIMARY KEY NOT NULL,
    blob       TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
