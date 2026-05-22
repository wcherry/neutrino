CREATE TABLE workspace_settings (
    id TEXT NOT NULL PRIMARY KEY,
    allowed_domain TEXT,
    restrict_shares_to_domain INTEGER NOT NULL DEFAULT 0,
    block_external_link_sharing INTEGER NOT NULL DEFAULT 0,
    domain_only_links INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
