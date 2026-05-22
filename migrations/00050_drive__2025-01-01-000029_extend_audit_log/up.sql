ALTER TABLE file_activity_log ADD COLUMN resource_type TEXT NOT NULL DEFAULT 'file';
ALTER TABLE file_activity_log ADD COLUMN ip_address TEXT;
ALTER TABLE file_activity_log ADD COLUMN user_agent TEXT;
