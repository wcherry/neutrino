// Shared editor constants used across Docs, Slides, and Sheets editors.

export const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: 'Default', value: '' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: "'Times New Roman', serif" },
  { label: 'Courier New', value: "'Courier New', monospace" },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', sans-serif" },
  { label: 'Roboto', value: "'Roboto', sans-serif" },
  { label: 'Open Sans', value: "'Open Sans', sans-serif" },
  { label: 'Lato', value: "'Lato', sans-serif" },
  { label: 'Playfair Display', value: "'Playfair Display', serif" },
  { label: 'Impact', value: 'Impact, sans-serif' },
  { label: 'Comic Sans MS', value: "'Comic Sans MS', cursive" },
];

// Slides uses bare family names (no CSS stack) for its TextStyle.fontFamily field.
export const FONT_FAMILY_NAMES: { label: string; value: string }[] = [
  { label: 'Default (Inter)', value: 'Inter' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Times New Roman', value: 'Times New Roman' },
  { label: 'Courier New', value: 'Courier New' },
  { label: 'Verdana', value: 'Verdana' },
  { label: 'Trebuchet MS', value: 'Trebuchet MS' },
  { label: 'Roboto', value: 'Roboto' },
  { label: 'Open Sans', value: 'Open Sans' },
  { label: 'Lato', value: 'Lato' },
  { label: 'Playfair Display', value: 'Playfair Display' },
  { label: 'Impact', value: 'Impact' },
  { label: 'Comic Sans MS', value: 'Comic Sans MS' },
];

export const TEXT_COLORS = [
  '#202124', '#d93025', '#e37400', '#0f9d58', '#1a73e8', '#a142f4', '#f538a0',
];

export const HIGHLIGHT_COLORS = [
  'transparent', '#fef08a', '#bbf7d0', '#bae6fd', '#e9d5ff', '#fecaca',
];
