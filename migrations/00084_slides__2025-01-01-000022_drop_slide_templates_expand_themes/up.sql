-- Drop slide_templates: layouts are now client-side only and not stored in the DB.
DROP TABLE IF EXISTS slide_templates;

-- Expand slide_themes with font, background, gradient, and transition settings.
ALTER TABLE slide_themes ADD COLUMN font_family        TEXT NOT NULL DEFAULT 'Inter';
ALTER TABLE slide_themes ADD COLUMN background_image   TEXT;          -- nullable URL
ALTER TABLE slide_themes ADD COLUMN gradient_background TEXT;         -- nullable CSS gradient
ALTER TABLE slide_themes ADD COLUMN default_transition TEXT NOT NULL DEFAULT 'fade';
