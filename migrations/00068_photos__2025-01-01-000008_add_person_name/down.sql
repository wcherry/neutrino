-- SQLite does not support DROP COLUMN directly in older versions; recreate table without name
CREATE TABLE persons_backup AS SELECT id, user_id, cover_face_id, cover_thumbnail, cover_thumbnail_mime_type, face_count, created_at, updated_at FROM persons;
DROP TABLE persons;
ALTER TABLE persons_backup RENAME TO persons;
CREATE INDEX idx_persons_user_id ON persons (user_id);
