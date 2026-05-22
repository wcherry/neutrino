-- Revert Phase 7 smart album columns (SQLite: recreate table without the columns)
CREATE TABLE albums_backup AS SELECT id, user_id, title, description, created_at, updated_at FROM albums;
DROP TABLE albums;
ALTER TABLE albums_backup RENAME TO albums;
