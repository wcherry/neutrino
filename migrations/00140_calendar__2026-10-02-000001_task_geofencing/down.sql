DROP INDEX IF EXISTS idx_tasks_geo_place;
ALTER TABLE tasks DROP COLUMN geo_radius_m;
ALTER TABLE tasks DROP COLUMN geo_lng;
ALTER TABLE tasks DROP COLUMN geo_lat;
ALTER TABLE tasks DROP COLUMN geo_place_id;
DROP TABLE task_places;
