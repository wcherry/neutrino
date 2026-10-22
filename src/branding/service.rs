// ── branding::service ─────────────────────────────────────────────────────────

use std::sync::Arc;

use chrono::Utc;

use super::color::{Rgb, LIGHT_GROUND, TEXT_CONTRAST};
use super::dto::{BrandingResponse, PutBrandingRequest};
use super::model::AssetRecord;
use super::repository::{BrandingFields, BrandingRepository};
use crate::shared::ApiError;

/// The three images an instance can set.
pub const ASSET_KINDS: &[&str] = &["logo-light", "logo-dark", "favicon"];

/// Large enough for a crisp logo at 2× and a multi-size `.ico`; small enough to inline nowhere and
/// serve to every signed-out visitor without thought.
pub const MAX_ASSET_BYTES: usize = 256 * 1024;

const MAX_NAME_CHARS: usize = 60;
const MAX_MESSAGE_CHARS: usize = 280;

pub struct BrandingService {
    repo: Arc<BrandingRepository>,
}

fn now() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.6fZ").to_string()
}

/// A version string for URLs and ETags: short, URL-safe, different on every write.
fn new_version() -> String {
    Utc::now().format("%Y%m%d%H%M%S%6f").to_string()
}

pub fn asset_url(kind: &str, version: &str) -> String {
    format!("/api/v1/branding/assets/{kind}?v={version}")
}

/// What an uploaded image really is, from its first bytes — never from the client's
/// `Content-Type`, which says whatever it was told to. SVG is not on the list on purpose: opened
/// directly on this origin it is a document that can run script.
pub fn sniff_image(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(&[0, 0, 1, 0]) {
        Some("image/x-icon")
    } else {
        None
    }
}

/// Plain text on one line or a few: no control characters other than a newline in the message.
fn clean_text(field: &str, raw: Option<String>, max: usize, allow_newlines: bool) -> Result<Option<String>, ApiError> {
    let Some(text) = raw.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) else {
        return Ok(None);
    };
    if text.chars().count() > max {
        return Err(ApiError::bad_request(format!("{field} must be at most {max} characters")));
    }
    if text.chars().any(|c| c.is_control() && !(allow_newlines && c == '\n')) {
        return Err(ApiError::bad_request(format!("{field} must be plain text")));
    }
    Ok(Some(text))
}

/// The accent must be `#rrggbb` and readable as text on the light ground; the dark-mode variant is
/// derived (`color::AccentPalette`), so this one check covers both modes.
pub fn validate_accent(raw: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(raw) = raw.map(|a| a.trim().to_string()).filter(|a| !a.is_empty()) else {
        return Ok(None);
    };
    let rgb = Rgb::parse(&raw)
        .ok_or_else(|| ApiError::new(400, "INVALID_ACCENT", "The accent must be a colour like #3346e8"))?;
    let ratio = rgb.contrast(LIGHT_GROUND);
    if ratio < TEXT_CONTRAST {
        return Err(ApiError::new(
            400,
            "ACCENT_TOO_LIGHT",
            format!(
                "{} has a contrast of {ratio:.1}:1 on white; text in it needs at least {TEXT_CONTRAST}:1. Pick a darker shade.",
                rgb.hex()
            ),
        ));
    }
    Ok(Some(rgb.hex()))
}

impl BrandingService {
    pub fn new(repo: Arc<BrandingRepository>) -> Self {
        BrandingService { repo }
    }

    pub fn get(&self) -> Result<BrandingResponse, ApiError> {
        let Some(record) = self.repo.get()? else {
            return Ok(BrandingResponse::default());
        };
        let assets = self.repo.assets()?;
        let url = |kind: &str| assets.iter().any(|a| a.kind == kind).then(|| asset_url(kind, &record.version));
        Ok(BrandingResponse {
            logo_light_url: url("logo-light"),
            logo_dark_url: url("logo-dark"),
            favicon_url: url("favicon"),
            name: record.name,
            accent: record.accent,
            sign_in_message: record.sign_in_message,
            version: Some(record.version),
        })
    }

    pub fn put(&self, admin_id: &str, req: PutBrandingRequest) -> Result<BrandingResponse, ApiError> {
        let name = clean_text("The name", req.name, MAX_NAME_CHARS, false)?;
        let accent = validate_accent(req.accent)?;
        let message = clean_text("The sign-in message", req.sign_in_message, MAX_MESSAGE_CHARS, true)?;
        let fields = BrandingFields {
            name: name.as_deref(),
            accent: accent.as_deref(),
            sign_in_message: message.as_deref(),
        };
        self.repo.put(&fields, &new_version(), admin_id, &now())?;
        self.get()
    }

    pub fn put_asset(&self, admin_id: &str, kind: &str, bytes: &[u8]) -> Result<BrandingResponse, ApiError> {
        check_kind(kind)?;
        if bytes.is_empty() || bytes.len() > MAX_ASSET_BYTES {
            return Err(ApiError::bad_request(format!(
                "The image must be at most {} KiB",
                MAX_ASSET_BYTES / 1024
            )));
        }
        let mime = sniff_image(bytes).ok_or_else(|| {
            ApiError::new(400, "UNSUPPORTED_IMAGE", "Upload a PNG, WebP or ICO image")
        })?;
        self.repo.put_asset(kind, Some((mime, bytes)), &new_version(), admin_id, &now())?;
        self.get()
    }

    pub fn delete_asset(&self, admin_id: &str, kind: &str) -> Result<BrandingResponse, ApiError> {
        check_kind(kind)?;
        self.repo.put_asset(kind, None, &new_version(), admin_id, &now())?;
        self.get()
    }

    /// The image and the version it belongs to, for the public asset route.
    pub fn asset(&self, kind: &str) -> Result<Option<(AssetRecord, String)>, ApiError> {
        check_kind(kind)?;
        let Some(asset) = self.repo.asset(kind)? else { return Ok(None) };
        let version = self.repo.get()?.map(|r| r.version).unwrap_or_default();
        Ok(Some((asset, version)))
    }
}

fn check_kind(kind: &str) -> Result<(), ApiError> {
    if ASSET_KINDS.contains(&kind) {
        Ok(())
    } else {
        Err(ApiError::not_found(format!("No branding image called {kind}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_are_identified_by_their_bytes() {
        assert_eq!(sniff_image(b"\x89PNG\r\n\x1a\n...."), Some("image/png"));
        assert_eq!(sniff_image(b"RIFF\x10\x00\x00\x00WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff_image(&[0, 0, 1, 0, 1, 0]), Some("image/x-icon"));
        // SVG — and anything else that is a document rather than an image — is refused.
        assert_eq!(sniff_image(b"<svg xmlns=\"http://www.w3.org/2000/svg\"><script/></svg>"), None);
        assert_eq!(sniff_image(b"<!doctype html>"), None);
    }

    #[test]
    fn an_accent_must_be_legible_on_white() {
        assert_eq!(validate_accent(Some("#3346E8".into())).unwrap(), Some("#3346e8".into()));
        assert_eq!(validate_accent(Some("  ".into())).unwrap(), None);
        let too_light = validate_accent(Some("#ffd400".into())).unwrap_err();
        assert_eq!(too_light.code, "ACCENT_TOO_LIGHT");
        for bad in ["red", "#3346e8;}", "#3346e8\"", "url(x)"] {
            assert!(validate_accent(Some(bad.into())).is_err(), "{bad}");
        }
    }

    #[test]
    fn text_fields_are_plain_and_bounded() {
        assert_eq!(clean_text("n", Some("  Acme Cloud ".into()), 60, false).unwrap(), Some("Acme Cloud".into()));
        assert!(clean_text("n", Some("a\u{0007}b".into()), 60, false).is_err());
        assert!(clean_text("n", Some("line\nbreak".into()), 60, false).is_err());
        assert!(clean_text("m", Some("line\nbreak".into()), 280, true).is_ok());
        assert!(clean_text("n", Some("x".repeat(61)), 60, false).is_err());
    }
}
