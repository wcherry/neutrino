-- Add more built-in system themes with gradients and richer palettes.
INSERT OR IGNORE INTO slide_themes
    (id, user_id, name, primary_color, background_color, text_color, accent_color,
     font_family, background_image, gradient_background, default_transition, is_system)
VALUES
    -- Solid colour themes
    ('system-theme-paper', 'system', 'Paper',
     '#78716c', '#fafaf9', '#292524', '#a8a29e',
     'Inter', NULL, NULL, 'fade', 1),

    ('system-theme-nordic', 'system', 'Nordic',
     '#5b7ea6', '#ecf0f5', '#1e2d3d', '#93b4d4',
     'Inter', NULL, NULL, 'slide', 1),

    ('system-theme-crimson', 'system', 'Crimson',
     '#dc2626', '#fff5f5', '#450a0a', '#f87171',
     'Inter', NULL, NULL, 'fade', 1),

    ('system-theme-slate', 'system', 'Slate',
     '#475569', '#f8fafc', '#0f172a', '#94a3b8',
     'Inter', NULL, NULL, 'none', 1),

    -- Gradient themes
    ('system-theme-coral', 'system', 'Coral',
     '#f97316', '#1a0a00', '#fff7ed', '#fdba74',
     'Inter', NULL, 'linear-gradient(135deg, #1a0a00 0%, #7c2d12 45%, #c2410c 100%)', 'zoom', 1),

    ('system-theme-steel', 'system', 'Steel',
     '#38bdf8', '#0a1628', '#e0f2fe', '#7dd3fc',
     'Inter', NULL, 'linear-gradient(160deg, #0a1628 0%, #0f2744 50%, #1e3a5f 100%)', 'slide', 1),

    ('system-theme-neon', 'system', 'Neon',
     '#a855f7', '#050010', '#f5f0ff', '#d8b4fe',
     'Inter', NULL, 'linear-gradient(135deg, #050010 0%, #1a0533 45%, #0d001f 100%)', 'fade', 1),

    ('system-theme-ember', 'system', 'Ember',
     '#f59e0b', '#160800', '#fffbeb', '#fcd34d',
     'Inter', NULL, 'linear-gradient(135deg, #160800 0%, #451a03 50%, #78350f 100%)', 'zoom', 1),

    ('system-theme-glacier', 'system', 'Glacier',
     '#0ea5e9', '#f0f9ff', '#0c4a6e', '#7dd3fc',
     'Inter', NULL, 'linear-gradient(160deg, #e0f7ff 0%, #bae6fd 50%, #7dd3fc 100%)', 'slide', 1),

    ('system-theme-cosmic', 'system', 'Cosmic',
     '#c084fc', '#04000f', '#fdf4ff', '#e879f9',
     'Inter', NULL, 'linear-gradient(135deg, #04000f 0%, #180033 35%, #0d0525 65%, #1a0040 100%)', 'fade', 1);
