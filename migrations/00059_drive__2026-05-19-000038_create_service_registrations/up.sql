CREATE TABLE service_registrations (
    name TEXT NOT NULL PRIMARY KEY,
    endpoint TEXT NOT NULL,
    version TEXT NOT NULL,
    health_check_url TEXT NOT NULL,
    registered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    enabled INTEGER NOT NULL DEFAULT 1,
    auto_update INTEGER NOT NULL DEFAULT 1
);
