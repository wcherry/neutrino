CREATE TABLE user_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT,
    bio TEXT,
    avatar TEXT,
    profile_image TEXT,
    website TEXT,
    social_links TEXT,
    language TEXT,
    timezone TEXT,
    country TEXT,
    email_marketing INTEGER NOT NULL DEFAULT 0,
    email_general INTEGER NOT NULL DEFAULT 1,
    email_updates INTEGER NOT NULL DEFAULT 1,
    email_critical INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
