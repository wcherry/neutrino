/**
 * Feature flags — all flags read NEXT_PUBLIC_FEATURE_* environment variables.
 * All flags default to false (feature off) unless explicitly enabled.
 *
 * To enable a flag in development, set the env var in .env.local:
 *   NEXT_PUBLIC_FEATURE_SETTINGS=true
 */
const featureFlags = {
  /**
   * Settings page.
   * Env var: NEXT_PUBLIC_FEATURE_SETTINGS
   * Default: off
   */
  settingsPage: process.env.NEXT_PUBLIC_FEATURE_SETTINGS === 'true',

  /**
   * Video embeds in the slides editor.
   * Adds a "Video" toolbar button that allows inserting YouTube, Vimeo, Loom,
   * and direct MP4 video elements into slides.
   * Env var: NEXT_PUBLIC_FEATURE_SLIDES_VIDEO_EMBEDS
   * Default: off
   */
  slidesVideoEmbeds: process.env.NEXT_PUBLIC_FEATURE_SLIDES_VIDEO_EMBEDS === 'true',

  /**
   * Live sheet embeds in the slides editor.
   * Enables pasting a copied Sheets selection as a live embed block, and adds
   * a "Sheet" toolbar button to insert an embed by spreadsheet ID and range.
   * Env var: NEXT_PUBLIC_FEATURE_SHEET_LIVE_EMBED
   * Default: off
   */
  sheetLiveEmbed: process.env.NEXT_PUBLIC_FEATURE_SHEET_LIVE_EMBED === 'true',

  /**
   * Drive area-wide drag-and-drop upload.
   * Makes the entire Drive view a drop target so users can drag files from their
   * OS file manager and drop them anywhere in the drive area to upload.
   * Env var: NEXT_PUBLIC_FEATURE_DRIVE_AREA_DROP_TARGET
   * Default: off
   */
  driveAreaDropTarget: process.env.NEXT_PUBLIC_FEATURE_DRIVE_AREA_DROP_TARGET === 'true',

  /**
   * Alpha channel in the color picker.
   * Adds an opacity slider to ColorPickerPopover when showAlpha=true is passed.
   * Currently used for the slides background color picker.
   * Env var: NEXT_PUBLIC_FEATURE_COLOR_PICKER_ALPHA
   * Default: off
   */
  colorPickerAlpha: process.env.NEXT_PUBLIC_FEATURE_COLOR_PICKER_ALPHA === 'true',

  /**
   * Client-side encrypted search (phases 1-4).
   * Keyword search over documents, notes, sheets, slides, events, reminders.
   * Uses a local IndexedDB inverted index with HMAC-SHA256 token hashing.
   * Env var: NEXT_PUBLIC_FEATURE_SEARCH
   * Default: off
   */
  search: process.env.NEXT_PUBLIC_FEATURE_SEARCH === 'true',

  /**
   * Phase 1 charting for Neutrino Sheets.
   * Adds chart creation, editing, and rendering (column, bar, line, area, pie,
   * donut, scatter, combo) within the spreadsheet grid. Charts are inserted from
   * a selected range, update live when cell values change, and are draggable and
   * resizable. A side panel allows formatting the title, axes, legend, data
   * labels, gridlines, and background colors.
   * Env var: NEXT_PUBLIC_FEATURE_SHEETS_CHARTS
   * Default: off
   */
  sheetsCharts: process.env.NEXT_PUBLIC_FEATURE_SHEETS_CHARTS === 'true',

  /**
   * Phase 2 charting for Neutrino Sheets.
   * Adds new chart types (stacked column/bar, 100% stacked, bubble, histogram,
   * candlestick, waterfall, treemap, sunburst), axis controls (min/max, log
   * scale, reverse, number formatting), per-series styling (color, line
   * thickness, markers, visibility, secondary Y-axis), data label configuration
   * (type, position, font size), and built-in chart themes (Default, Dark,
   * Pastel, Corporate, Colorblind Safe).
   * Requires NEXT_PUBLIC_FEATURE_SHEETS_CHARTS to also be enabled.
   * Env var: NEXT_PUBLIC_FEATURE_SHEETS_CHARTS_PHASE2
   * Default: off
   */
  sheetsChartsPhase2: process.env.NEXT_PUBLIC_FEATURE_SHEETS_CHARTS_PHASE2 === 'true',
} as const;

export default featureFlags;
export type FeatureFlags = typeof featureFlags;
