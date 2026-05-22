ALTER TABLE workspace_settings ADD COLUMN require_2fa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspace_settings ADD COLUMN default_restrict_download_viewer INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspace_settings ADD COLUMN default_restrict_print_copy_viewer INTEGER NOT NULL DEFAULT 0;
