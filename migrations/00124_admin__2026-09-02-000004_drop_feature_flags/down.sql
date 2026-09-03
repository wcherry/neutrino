-- Restore the table and every row as migrations 00088-00098 left it: the
-- twelve keys 00088 seeded, plus the three added later, all disabled except
-- `driveAreaDropTarget`, which 00097 enabled.
--
-- This rebuilds the storage only. The code that read these keys is gone, so a
-- rollback restores the rows without restoring any gate they once controlled.

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
    ('driveAreaDropTarget',   1, 'Drag-drop to specific areas in drive',                datetime('now')),
    ('colorPickerAlpha',      0, 'Alpha channel in color picker',                       datetime('now')),
    ('search',                0, 'Global search',                                       datetime('now')),
    ('sheetsCharts',          0, 'Charts in sheets (phase 1)',                          datetime('now')),
    ('sheetsChartsPhase2',    0, 'Charts in sheets (phase 2 — additional chart types)', datetime('now')),
    ('sheetsChartsPhase5',    0, 'Charts in sheets (phase 5 — combination charts)',     datetime('now')),
    ('docsLayoutStructure',   0, 'Document layout and structure features',              datetime('now')),
    ('docsAdvancedFormatting',0, 'Advanced formatting in docs',                         datetime('now')),
    ('docsEditingTools',      0, 'AI-powered editing tools in docs',                    datetime('now')),
    ('sheetsConditionalFormatting', 0, 'Conditional formatting in sheets',              datetime('now')),
    ('docsDistractionFree',   0, 'Distraction-free focus mode for docs editor',         datetime('now')),
    ('diagramsApp',           0, 'Diagramming application (Phases 1-3)',                datetime('now'));
