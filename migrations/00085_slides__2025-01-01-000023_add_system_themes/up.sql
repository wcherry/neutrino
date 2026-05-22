-- Add is_system flag to distinguish built-in themes from user themes.
ALTER TABLE slide_themes ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;

-- Seed built-in themes (user_id = 'system', is_system = 1).
-- Solid colour themes
INSERT OR IGNORE INTO slide_themes
    (id, user_id, name, primary_color, background_color, text_color, accent_color,
     font_family, background_image, gradient_background, default_transition, is_system)
VALUES
    ('system-theme-default', 'system', 'Default',
     '#4f46e5', '#ffffff', '#1f2937', '#818cf8',
     'Inter', NULL, NULL, 'fade', 1),

    ('system-theme-dark', 'system', 'Dark',
     '#6366f1', '#111827', '#f9fafb', '#a5b4fc',
     'Inter', NULL, NULL, 'fade', 1),

    ('system-theme-ocean', 'system', 'Ocean',
     '#0284c7', '#f0f9ff', '#0c4a6e', '#38bdf8',
     'Inter', NULL, NULL, 'slide', 1),

    ('system-theme-forest', 'system', 'Forest',
     '#15803d', '#f0fdf4', '#14532d', '#4ade80',
     'Inter', NULL, NULL, 'fade', 1),

    ('system-theme-sunset', 'system', 'Sunset',
     '#ea580c', '#fff7ed', '#7c2d12', '#fb923c',
     'Inter', NULL, NULL, 'zoom', 1),

    ('system-theme-minimal', 'system', 'Minimal',
     '#374151', '#f9fafb', '#111827', '#9ca3af',
     'Inter', NULL, NULL, 'none', 1),

-- Gradient / dark themes
    ('system-theme-midnight', 'system', 'Midnight',
     '#818cf8', '#0f0c29', '#e8e8f0', '#c4b5fd',
     'Inter', NULL, 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)', 'fade', 1),

    ('system-theme-dusk', 'system', 'Dusk',
     '#3b82f6', '#1a1a2e', '#e0e7ff', '#93c5fd',
     'Inter', NULL, 'linear-gradient(160deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)', 'slide', 1),

    ('system-theme-aurora', 'system', 'Aurora',
     '#10b981', '#0d0221', '#ecfdf5', '#6ee7b7',
     'Inter', NULL, 'linear-gradient(135deg, #0d0221 0%, #0d3b2e 50%, #064e3b 100%)', 'slide', 1),

    ('system-theme-volcano', 'system', 'Volcano',
     '#ef4444', '#1a0000', '#fef2f2', '#fca5a5',
     'Inter', NULL, 'linear-gradient(135deg, #1a0000 0%, #4a1010 50%, #7c2020 100%)', 'zoom', 1),

    ('system-theme-rose', 'system', 'Rose',
     '#ec4899', '#2d1b2e', '#fce7f3', '#f9a8d4',
     'Inter', NULL, 'linear-gradient(135deg, #2d1b2e 0%, #4a1942 50%, #3d0f26 100%)', 'fade', 1),

    ('system-theme-sage', 'system', 'Sage',
     '#4ade80', '#1a2f20', '#f0fdf4', '#86efac',
     'Inter', NULL, 'linear-gradient(135deg, #1a2f20 0%, #2d4a35 50%, #1f3d28 100%)', 'fade', 1);
