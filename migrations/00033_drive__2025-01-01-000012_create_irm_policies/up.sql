CREATE TABLE irm_policies (
    id TEXT NOT NULL PRIMARY KEY,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    restrict_download_viewer INTEGER NOT NULL DEFAULT 0,
    restrict_download_commenter INTEGER NOT NULL DEFAULT 0,
    restrict_download_editor INTEGER NOT NULL DEFAULT 0,
    restrict_print_copy_viewer INTEGER NOT NULL DEFAULT 0,
    restrict_print_copy_commenter INTEGER NOT NULL DEFAULT 0,
    restrict_print_copy_editor INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(resource_type, resource_id)
);
