export type FeatureFlags = {
  settingsPage: boolean;
  slidesVideoEmbeds: boolean;
  sheetLiveEmbed: boolean;
  driveAreaDropTarget: boolean;
  colorPickerAlpha: boolean;
  search: boolean;
  sheetsCharts: boolean;
  sheetsChartsPhase2: boolean;
  sheetsChartsPhase5: boolean;
  docsLayoutStructure: boolean;
  docsAdvancedFormatting: boolean;
  docsEditingTools: boolean;
  // Feature gap #4 — Real-time presence & cursor awareness (NEXT_PUBLIC_FEATURE_DOCS_PRESENCE)
  docsPresence: boolean;
  // Feature gap #5 — Track changes / suggesting mode (NEXT_PUBLIC_FEATURE_DOCS_TRACK_CHANGES)
  docsTrackChanges: boolean;
  // Feature gap #6 — Version compare / diff viewer (NEXT_PUBLIC_FEATURE_DOCS_COMPARE)
  docsCompare: boolean;
  // Feature gap #7 — Mobile / responsive editing (NEXT_PUBLIC_FEATURE_DOCS_MOBILE_EDITOR)
  docsMobileEditor: boolean;
};

export const defaultFeatureFlags: FeatureFlags = {
  settingsPage: false,
  slidesVideoEmbeds: false,
  sheetLiveEmbed: false,
  driveAreaDropTarget: false,
  colorPickerAlpha: false,
  search: false,
  sheetsCharts: false,
  sheetsChartsPhase2: false,
  sheetsChartsPhase5: false,
  docsLayoutStructure: false,
  docsAdvancedFormatting: false,
  docsEditingTools: false,
  docsPresence: false,
  docsTrackChanges: false,
  docsCompare: false,
  docsMobileEditor: false,
};
