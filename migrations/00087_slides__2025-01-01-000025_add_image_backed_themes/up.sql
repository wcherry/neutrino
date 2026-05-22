-- Add system themes that use Unsplash background images.
-- Each theme sets a solid background_color as a fallback and leaves gradient_background NULL.
INSERT OR IGNORE INTO slide_themes
    (id, user_id, name, primary_color, background_color, text_color, accent_color,
     font_family, background_image, gradient_background, default_transition, is_system)
VALUES
    -- Starry night sky
    ('system-theme-starfield', 'system', 'Starfield',
     '#818cf8', '#0a0a1a', '#f0f0ff', '#c4b5fd',
     'Inter',
     'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?auto=format&fit=crop&w=1920&q=80',
     NULL, 'fade', 1),

    -- Dramatic mountain landscape
    ('system-theme-summit', 'system', 'Summit',
     '#60a5fa', '#1a2030', '#f0f9ff', '#93c5fd',
     'Inter',
     'https://images.unsplash.com/photo-1464822759023-fed107ef2299?auto=format&fit=crop&w=1920&q=80',
     NULL, 'slide', 1),

    -- Misty winter forest
    ('system-theme-frost', 'system', 'Frost',
     '#0284c7', '#e8f4f8', '#0c4a6e', '#38bdf8',
     'Inter',
     'https://images.unsplash.com/photo-1516912481851-03f23e2e7d74?auto=format&fit=crop&w=1920&q=80',
     NULL, 'fade', 1),

    -- Tropical ocean / turquoise water
    ('system-theme-lagoon', 'system', 'Lagoon',
     '#0e7490', '#ecfeff', '#164e63', '#22d3ee',
     'Inter',
     'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1920&q=80',
     NULL, 'slide', 1),

    -- Lush green forest canopy
    ('system-theme-canopy', 'system', 'Canopy',
     '#16a34a', '#0a1f0f', '#f0fdf4', '#4ade80',
     'Inter',
     'https://images.unsplash.com/photo-1448375240890-ef9021e41408?auto=format&fit=crop&w=1920&q=80',
     NULL, 'fade', 1),

    -- City lights at night
    ('system-theme-metropolis', 'system', 'Metropolis',
     '#f59e0b', '#0f0f14', '#fefce8', '#fcd34d',
     'Inter',
     'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1920&q=80',
     NULL, 'zoom', 1);
