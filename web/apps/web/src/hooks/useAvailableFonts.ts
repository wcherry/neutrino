import { FONT_FAMILIES, FONT_FAMILY_NAMES } from '@/constants/editor';
import { useCustomFonts } from '@/providers/CustomFontsProvider';

export type FontOption = { label: string; value: string };

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
    fontFamilies: [...FONT_FAMILIES, ...customFontFamilies],
    fontFamilyNames: [...FONT_FAMILY_NAMES, ...customFontFamilyNames],
    customFontFamilies,
    customFontFamilyNames,
    loaded,
  };
}
