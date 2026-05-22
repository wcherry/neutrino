-- Phase 7: Smart Albums support
-- is_auto: true = auto-generated from a person cluster, false = user-created
-- person_id: the person this smart album was generated for (nullable)
ALTER TABLE albums ADD COLUMN is_auto BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE albums ADD COLUMN person_id TEXT;
