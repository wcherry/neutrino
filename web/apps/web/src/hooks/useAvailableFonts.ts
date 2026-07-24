import { FONT_FAMILIES, FONT_FAMILY_NAMES } from '@/constants/editor';
import { useCustomFonts } from '@/providers/CustomFontsProvider';

export type FontOption = { label: string; value: string };

// Custom fonts can share a name with a built-in (e.g. an admin uploads their
// own "Roboto"); keep the first occurrence so dropdowns never render two
// options with the same value/key.
function dedupeByValue(options: FontOption[]): FontOption[] {
  const seen = new Set<string>();
  return options.filter((opt) => {
    if (seen.has(opt.value)) return false;
    seen.add(opt.value);
    return true;
  });
}

export interface AvailableFonts {
  /** Built-ins + custom fonts, CSS-stack form (Docs/Sheets). */
  fontFamilies: FontOption[];
  /** Built-ins + custom fonts, bare-name form (Slides/Diagrams). */
  fontFamilyNames: FontOption[];
  /** Custom-only subset, CSS-stack form. */
  customFontFamilies: FontOption[];
  /** Custom-only subset, bare-name form. */
  customFontFamilyNames: FontOption[];
  loaded: boolean;
}

export function useAvailableFonts(): AvailableFonts {
  const { fonts, loaded } = useCustomFonts();

  const customFontFamilies: FontOption[] = fonts.map((font) => ({
    label: font.displayName,
    value: `'${font.displayName}', sans-serif`,
  }));

  const customFontFamilyNames: FontOption[] = fonts.map((font) => ({
    label: font.displayName,
    value: font.displayName,
  }));

  return {
    fontFamilies: dedupeByValue([...FONT_FAMILIES, ...customFontFamilies]),
    fontFamilyNames: dedupeByValue([...FONT_FAMILY_NAMES, ...customFontFamilyNames]),
    customFontFamilies,
    customFontFamilyNames,
    loaded,
  };
}
