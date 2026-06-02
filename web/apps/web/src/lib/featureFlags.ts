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
};
