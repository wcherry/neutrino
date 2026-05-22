CREATE TABLE share_links (
  id TEXT PRIMARY KEY NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  visibility TEXT NOT NULL DEFAULT 'anyone_with_link',
  role TEXT NOT NULL DEFAULT 'viewer',
  expires_at TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(resource_type, resource_id)
);

CREATE INDEX idx_share_links_token ON share_links(token);
