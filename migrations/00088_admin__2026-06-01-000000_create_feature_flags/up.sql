CREATE TABLE feature_flags (
    key        TEXT PRIMARY KEY NOT NULL,
    enabled    INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    updated_at TEXT NOT NULL
);

INSERT INTO feature_flags (key, enabled, description, updated_at) VALUES
    ('settingsPage',          0, 'Settings page',                                       datetime('now')),
    ('slidesVideoEmbeds',     0, 'Video embeds in slides editor',                       datetime('now')),
    ('sheetLiveEmbed',        0, 'Live embed support for sheets',                       datetime('now')),
    ('driveAreaDropTarget',   0, 'Drag-drop to specific areas in drive',                datetime('now')),
    ('colorPickerAlpha',      0, 'Alpha channel in color picker',                       datetime('now')),
    ('search',                0, 'Global search',                                       datetime('now')),
    ('sheetsCharts',          0, 'Charts in sheets (phase 1)',                          datetime('now')),
    ('sheetsChartsPhase2',    0, 'Charts in sheets (phase 2 — additional chart types)', datetime('now')),
    ('sheetsChartsPhase5',    0, 'Charts in sheets (phase 5 — combination charts)',     datetime('now')),
    ('docsLayoutStructure',   0, 'Document layout and structure features',              datetime('now')),
    ('docsAdvancedFormatting',0, 'Advanced formatting in docs',                         datetime('now')),
    ('docsEditingTools',      0, 'AI-powered editing tools in docs',                    datetime('now'));
