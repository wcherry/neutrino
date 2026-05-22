ALTER TABLE refresh_tokens ADD COLUMN device_name TEXT;
ALTER TABLE refresh_tokens ADD COLUMN user_agent TEXT;
ALTER TABLE refresh_tokens ADD COLUMN ip_address TEXT;
ALTER TABLE refresh_tokens ADD COLUMN last_used_at TIMESTAMP;
