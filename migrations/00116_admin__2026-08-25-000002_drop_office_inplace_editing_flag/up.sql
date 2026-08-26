-- Drop the `officeInPlaceEditing` flag.
--
-- It gated opening a .docx/.xlsx/.pptx in the matching editor instead of the
-- preview modal. That is no longer a feature that can be off: Docs, Sheets and
-- Slides *create* OOXML now (issue #127), so a flag switched off would leave
-- every new document unopenable by the app that made it.
--
-- The preference the flag also gated -- "keep as Office file" vs "convert on
-- open" -- goes with it. Converting an OOXML document into the bespoke JSON
-- that predates it is backwards now, so the whole promote path is gone and the
-- Settings > Drive tab with it.

DELETE FROM feature_flags WHERE key = 'officeInPlaceEditing';
