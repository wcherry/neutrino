-- Retention policy for file version history, enforced by the background worker.
--
-- A single row: the policy is workspace-wide, set from the admin console. `id`
-- is fixed at 'default' so the row can be upserted without a lookup and a
-- second policy cannot be created by accident.
--
-- The two numbers are read together and neither wins outright: the sweep
-- deletes versions older than `retention_days`, but only after the newest
-- `min_versions` have been set aside, so a file nobody has touched in a year
-- still has history to go back to.
CREATE TABLE version_retention_settings (
    id TEXT NOT NULL PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    retention_days INTEGER NOT NULL DEFAULT 30,
    min_versions INTEGER NOT NULL DEFAULT 10,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO version_retention_settings (id, enabled, retention_days, min_versions)
VALUES ('default', 1, 30, 10);
