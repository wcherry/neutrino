// ── branding::color ───────────────────────────────────────────────────────────
//
// Just enough colour arithmetic to give an administrator's accent a contrast guarantee: the
// WCAG 2 relative-luminance contrast ratio, and mixing toward white or black until a target is met.
// The accent is the colour of primary text and filled buttons in every look, so it has to stay
// legible on the light page and, lifted, on the dark one — whatever was picked.

/// The light ground every look shares, and the darkest ground any look uses in dark mode.
pub const LIGHT_GROUND: Rgb = Rgb(0xff, 0xff, 0xff);
pub const DARK_GROUND: Rgb = Rgb(0x0f, 0x11, 0x15);

/// Body text needs 4.5:1 (WCAG 2.1 AA, 1.4.3).
pub const TEXT_CONTRAST: f64 = 4.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb(pub u8, pub u8, pub u8);

impl Rgb {
    /// `#rrggbb`, and nothing else — the value ends up inside a `<style>`.
    pub fn parse(hex: &str) -> Option<Rgb> {
        let digits = hex.strip_prefix('#')?;
        if digits.len() != 6 || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let byte = |i: usize| u8::from_str_radix(&digits[i..i + 2], 16).ok();
        Some(Rgb(byte(0)?, byte(2)?, byte(4)?))
    }

    pub fn hex(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.0, self.1, self.2)
    }

    fn luminance(self) -> f64 {
        let channel = |c: u8| {
            let c = c as f64 / 255.0;
            if c <= 0.03928 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
        };
        0.2126 * channel(self.0) + 0.7152 * channel(self.1) + 0.0722 * channel(self.2)
    }

    pub fn contrast(self, other: Rgb) -> f64 {
        let (a, b) = (self.luminance(), other.luminance());
        let (hi, lo) = if a > b { (a, b) } else { (b, a) };
        (hi + 0.05) / (lo + 0.05)
    }

    /// `t` of the way from `self` to `toward` (0 = self, 1 = toward), per channel in sRGB.
    pub fn mix(self, toward: Rgb, t: f64) -> Rgb {
        let lerp = |a: u8, b: u8| (a as f64 + (b as f64 - a as f64) * t).round().clamp(0.0, 255.0) as u8;
        Rgb(lerp(self.0, toward.0), lerp(self.1, toward.1), lerp(self.2, toward.2))
    }

    /// The least mix toward `toward` that reaches `ratio` against `ground`, in 5 % steps — `self`
    /// unchanged if it already does.
    pub fn until_contrast(self, toward: Rgb, ground: Rgb, ratio: f64) -> Rgb {
        (0..=20)
            .map(|step| self.mix(toward, step as f64 / 20.0))
            .find(|c| c.contrast(ground) >= ratio)
            .unwrap_or(toward)
    }
}

/// The accent's values for light and dark mode — what `inject` writes as CSS custom properties.
#[derive(Debug, Clone, PartialEq)]
pub struct AccentPalette {
    pub light: Rgb,
    pub light_hover: Rgb,
    pub light_subtle: Rgb,
    pub light_text: Rgb,
    pub dark: Rgb,
    pub dark_hover: Rgb,
    pub dark_subtle: Rgb,
    pub dark_text: Rgb,
}

const WHITE: Rgb = Rgb(0xff, 0xff, 0xff);
const BLACK: Rgb = Rgb(0, 0, 0);

impl AccentPalette {
    /// For an accent already known to reach 4.5:1 on white (`service::validate_accent`).
    pub fn from_accent(accent: Rgb) -> AccentPalette {
        let dark = accent.until_contrast(WHITE, DARK_GROUND, TEXT_CONTRAST);
        AccentPalette {
            light: accent,
            light_hover: accent.mix(BLACK, 0.18),
            light_subtle: accent.mix(WHITE, 0.92),
            light_text: accent.mix(BLACK, 0.25),
            dark,
            dark_hover: dark.mix(WHITE, 0.2),
            dark_subtle: accent.mix(DARK_GROUND, 0.78),
            dark_text: dark.mix(WHITE, 0.3),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_six_digit_hex() {
        assert_eq!(Rgb::parse("#3346E8"), Some(Rgb(0x33, 0x46, 0xe8)));
        for bad in ["3346e8", "#346", "#3346e8;", "#zzzzzz", "red", "#3346e8\"}"] {
            assert_eq!(Rgb::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn contrast_matches_the_published_figures() {
        // The brand blue is documented at 6.6:1 on white (look-and-feel roadmap §2).
        let ratio = Rgb::parse("#3346e8").unwrap().contrast(WHITE);
        assert!((ratio - 6.6).abs() < 0.1, "{ratio}");
        assert!((BLACK.contrast(WHITE) - 21.0).abs() < 0.01);
    }

    #[test]
    fn the_dark_variant_is_always_legible_on_the_dark_ground() {
        for hex in ["#3346e8", "#13945a", "#1a1a80", "#7a0000", "#000000"] {
            let palette = AccentPalette::from_accent(Rgb::parse(hex).unwrap());
            assert!(palette.dark.contrast(DARK_GROUND) >= TEXT_CONTRAST, "{hex} → {}", palette.dark.hex());
        }
    }
}
