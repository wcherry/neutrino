// ── preferences::catalog ─────────────────────────────────────────────────────
//
// The server's copy of the plain-tier entries in the preference registry
// (`web/packages/preferences/src/registry.json`). Only `sync: "plain"` keys are
// here: `device` keys never leave the browser and `vault` keys travel inside a
// sealed blob the server cannot read. Every value a client writes is checked
// against its entry before it is stored, so the table only ever holds keys the
// product declares, in shapes the client can read back.
//
// Two copies of one list is the feature-flag catalogue's arrangement
// (`drive/feature_flags/catalog.rs` beside `FLAG_KEYS`), and so is the guard:
// `the_catalog_matches_the_registry` reads the client's JSON and fails when an
// entry is added, removed or retyped on one side only.

use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    Enum(&'static [&'static str]),
    Boolean,
    Integer { min: i64, max: i64 },
    Str { max_length: usize, pattern: Option<&'static str> },
    /// A JSON object, opaque here beyond its size — the client repairs its fields on read
    /// (`clampBrush` does for the drawing brush).
    Object { max_bytes: usize },
}

#[derive(Debug, Clone, Copy)]
pub struct Spec {
    pub key: &'static str,
    pub kind: Kind,
}

const THEME_PATTERN: &str =
    "^(system|light|dark|glass|midnight|beach|forest|sunbeams|light-glass|custom-[A-Za-z0-9_-]{1,64})$";

pub const PLAIN: &[Spec] = &[
    Spec { key: "appearance.theme", kind: Kind::Str { max_length: 80, pattern: Some(THEME_PATTERN) } },
    Spec { key: "appearance.look", kind: Kind::Enum(&["classic", "lightflow", "precision", "blended"]) },
    Spec { key: "appearance.density", kind: Kind::Enum(&["compact", "comfortable", "spacious"]) },
    Spec { key: "calendar.weekStart", kind: Kind::Integer { min: 0, max: 6 } },
    Spec { key: "calendar.dayStartHour", kind: Kind::Integer { min: 0, max: 23 } },
    Spec { key: "calendar.dayEndHour", kind: Kind::Integer { min: 1, max: 24 } },
    Spec { key: "docs.spellCheck", kind: Kind::Boolean },
    Spec { key: "docs.splitParagraphs", kind: Kind::Boolean },
    Spec { key: "photos.autoFaceDetect", kind: Kind::Boolean },
    Spec { key: "drawing.brush", kind: Kind::Object { max_bytes: 4096 } },
    Spec { key: "keyboard.preset", kind: Kind::Enum(&["neutrino", "google", "microsoft"]) },
    Spec { key: "keyboard.bindings", kind: Kind::Object { max_bytes: 8192 } },
    Spec { key: "ai.provider", kind: Kind::Enum(&["gemini", "claude", "openai"]) },
];

pub fn spec(key: &str) -> Option<&'static Spec> {
    PLAIN.iter().find(|s| s.key == key)
}

fn theme_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(THEME_PATTERN).expect("theme pattern compiles"))
}

/// Whether `value` is acceptable for `spec`. The message names what is wrong, for the 400.
pub fn validate(spec: &Spec, value: &Value) -> Result<(), String> {
    match spec.kind {
        Kind::Enum(options) => match value.as_str() {
            Some(s) if options.contains(&s) => Ok(()),
            _ => Err(format!("must be one of {}", options.join(", "))),
        },
        Kind::Boolean => value.as_bool().map(|_| ()).ok_or_else(|| "must be true or false".into()),
        Kind::Integer { min, max } => match value.as_i64() {
            Some(n) if (min..=max).contains(&n) => Ok(()),
            _ => Err(format!("must be a whole number from {min} to {max}")),
        },
        Kind::Str { max_length, pattern } => {
            let s = value.as_str().ok_or("must be a string")?;
            if s.chars().count() > max_length {
                return Err(format!("must be at most {max_length} characters"));
            }
            if let Some(p) = pattern {
                // One pattern in the catalog today; compiled once rather than per request.
                let ok = if p == THEME_PATTERN { theme_regex().is_match(s) } else { Regex::new(p).map(|r| r.is_match(s)).unwrap_or(false) };
                if !ok {
                    return Err("is not an accepted value".into());
                }
            }
            Ok(())
        }
        Kind::Object { max_bytes } => {
            if !value.is_object() {
                return Err("must be an object".into());
            }
            if value.to_string().len() > max_bytes {
                return Err(format!("must be at most {max_bytes} bytes"));
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn check(key: &str, value: Value) -> Result<(), String> {
        validate(spec(key).expect("declared"), &value)
    }

    #[test]
    fn values_are_checked_against_their_type() {
        assert!(check("appearance.look", json!("precision")).is_ok());
        assert!(check("appearance.look", json!("neon")).is_err());
        assert!(check("calendar.weekStart", json!(6)).is_ok());
        assert!(check("calendar.weekStart", json!(7)).is_err());
        assert!(check("calendar.weekStart", json!("1")).is_err());
        assert!(check("docs.spellCheck", json!(false)).is_ok());
        assert!(check("docs.spellCheck", json!(0)).is_err());
        assert!(check("drawing.brush", json!({ "size": 4 })).is_ok());
        assert!(check("drawing.brush", json!([1, 2])).is_err());
    }

    #[test]
    fn a_theme_is_a_preset_or_a_custom_id_and_nothing_else() {
        for ok in ["system", "dark", "light-glass", "custom-3f2a9c1e-0000-4000-8000-000000000000"] {
            assert!(check("appearance.theme", json!(ok)).is_ok(), "{ok}");
        }
        // The theme name ends up in an attribute selector; nothing that could leave it gets in.
        for bad in ["custom-", "custom-a\"]", "dark;", "</style>", ""] {
            assert!(check("appearance.theme", json!(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn an_oversized_object_is_refused() {
        let big = "x".repeat(5000);
        assert!(check("drawing.brush", json!({ "blob": big })).is_err());
    }

    /// The registry is the client's list; this is the server's. They are two copies of one fact,
    /// held together here: add, remove or retype a plain key on one side only and this fails.
    #[test]
    fn the_catalog_matches_the_registry() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("web/packages/preferences/src/registry.json");
        let registry: Value = serde_json::from_str(&std::fs::read_to_string(&path).expect("registry.json"))
            .expect("registry parses");
        let entries = registry["preferences"].as_array().expect("preferences list");

        let plain: Vec<&Value> = entries.iter().filter(|e| e["sync"] == "plain").collect();
        let registry_keys: Vec<&str> = plain.iter().map(|e| e["key"].as_str().unwrap()).collect();
        let catalog_keys: Vec<&str> = PLAIN.iter().map(|s| s.key).collect();
        assert_eq!(registry_keys, catalog_keys, "plain keys differ between registry.json and the catalog");

        for (entry, spec) in plain.iter().zip(PLAIN) {
            let ty = &entry["type"];
            let matches = match spec.kind {
                Kind::Enum(options) => ty["kind"] == "enum" && ty["options"] == json!(options),
                Kind::Boolean => ty["kind"] == "boolean",
                Kind::Integer { min, max } => ty["kind"] == "integer" && ty["min"] == min && ty["max"] == max,
                Kind::Str { max_length, pattern } => {
                    ty["kind"] == "string" && ty["maxLength"] == max_length && ty["pattern"].as_str() == pattern
                }
                Kind::Object { max_bytes } => ty["kind"] == "object" && ty["maxBytes"] == max_bytes,
            };
            assert!(matches, "{} is typed differently in registry.json", spec.key);
            // The registry's default must be a value the server would accept.
            if !entry["default"].is_null() {
                assert!(validate(spec, &entry["default"]).is_ok(), "{} default is invalid", spec.key);
            }
        }
    }
}
