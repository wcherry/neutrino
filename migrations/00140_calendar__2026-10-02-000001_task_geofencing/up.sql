-- Task geofencing (issue #243; calendar repo agent_docs/task-geofencing.md). A saved place is
-- ciphertext only: its name, coordinates and radius are inside `encrypted_payload`, a v1
-- PlaceEnvelope the server can't open.
CREATE TABLE task_places (
    id                TEXT PRIMARY KEY NOT NULL,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_payload TEXT NOT NULL,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_task_places_user ON task_places (user_id);

-- A task's arrival geofence: a saved place, or a one-off point (plaintext on purpose), never
-- both. All nullable, so existing clients keep working.
ALTER TABLE tasks ADD COLUMN geo_place_id TEXT NULL REFERENCES task_places(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN geo_lat DOUBLE PRECISION NULL;
ALTER TABLE tasks ADD COLUMN geo_lng DOUBLE PRECISION NULL;
ALTER TABLE tasks ADD COLUMN geo_radius_m INTEGER NULL;

CREATE INDEX idx_tasks_geo_place ON tasks (geo_place_id);
