//! Registry of native Neutrino document types.
//!
//! Before this existed, every editor app (docs, sheets, slides, drawing,
//! diagrams) carried its own `MIME_TYPE` constant, its own marker table, and
//! its own near-identical `create`/`get`/`autosave`/`promote` service — five
//! copies of the same code differing only in a mime string and a blob of
//! default content. The registry is the single place those two facts live, so
//! drive can serve every app from one set of endpoints.
//!
//! Membership in this table *is* the marker: a file is a native Neutrino
//! spreadsheet because its mime type is `application/x-neutrino-sheet`, not
//! because a row exists in a side table saying so. That removes the failure
//! mode where the two disagree.

/// A document type Neutrino edits natively.
pub struct NativeType {
    /// The mime type stored on the `files` row.
    pub mime_type: &'static str,
    /// Content written at creation time so a newly created file opens in a
    /// valid state rather than as a zero-byte read the editor has to special-case.
    pub default_content: &'static str,
    /// Office mime types that `convert` accepts as a source for this type.
    /// Empty means the type cannot be converted into.
    pub promotable_from: &'static [&'static str],
}

pub const SHEET: &str = "application/x-neutrino-sheet";
pub const DOC: &str = "application/x-neutrino-doc";
pub const SLIDE: &str = "application/x-neutrino-slide";
pub const DRAWING: &str = "application/x-neutrino-drawing";
pub const DIAGRAM: &str = "application/x-neutrino-diagram";

const XLSX: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX: &str = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/// Default empty FortuneSheet workbook: one sheet named "Sheet1".
const EMPTY_SHEET_CONTENT: &str = r#"[{"index":"0","name":"Sheet1","celldata":[],"row":100,"column":26,"order":0,"status":1,"config":{}}]"#;

pub const NATIVE_TYPES: &[NativeType] = &[
    NativeType {
        mime_type: SHEET,
        default_content: EMPTY_SHEET_CONTENT,
        promotable_from: &[XLSX],
    },
    NativeType {
        mime_type: DOC,
        default_content: "",
        promotable_from: &[DOCX],
    },
    NativeType {
        mime_type: SLIDE,
        default_content: "",
        promotable_from: &[PPTX],
    },
    NativeType {
        mime_type: DRAWING,
        default_content: "",
        promotable_from: &[],
    },
    NativeType {
        mime_type: DIAGRAM,
        default_content: "",
        promotable_from: &[],
    },
];

pub fn lookup(mime_type: &str) -> Option<&'static NativeType> {
    NATIVE_TYPES.iter().find(|t| t.mime_type == mime_type)
}

/// Whether `source_mime` may be converted into `target_mime`. Used by
/// `POST /drive/files/{id}/convert` to reject nonsense conversions (a .txt
/// into a spreadsheet, a .xlsx into a slide deck) before anything is written.
pub fn can_convert(source_mime: &str, target_mime: &str) -> bool {
    lookup(target_mime).is_some_and(|t| t.promotable_from.contains(&source_mime))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sheet_default_content_is_a_one_sheet_workbook() {
        let parsed: serde_json::Value =
            serde_json::from_str(lookup(SHEET).unwrap().default_content).unwrap();
        assert!(parsed.is_array());
        assert_eq!(parsed.as_array().unwrap().len(), 1);
        assert!(parsed[0]["name"].is_string());
        assert!(parsed[0]["celldata"].is_array());
    }

    #[test]
    fn unknown_mime_is_not_native() {
        assert!(lookup("text/plain").is_none());
        assert!(lookup("application/vnd.ms-excel").is_none());
    }

    #[test]
    fn xlsx_converts_only_into_a_sheet() {
        assert!(can_convert(XLSX, SHEET));
        assert!(!can_convert(XLSX, SLIDE));
        assert!(!can_convert(XLSX, DOC));
    }

    #[test]
    fn a_non_office_source_cannot_be_converted() {
        assert!(!can_convert("text/plain", SHEET));
    }

    #[test]
    fn a_type_with_no_sources_cannot_be_converted_into() {
        assert!(!can_convert(XLSX, DRAWING));
        assert!(!can_convert(DOCX, DIAGRAM));
    }

    #[test]
    fn every_registered_mime_is_unique() {
        let mut seen = std::collections::HashSet::new();
        for t in NATIVE_TYPES {
            assert!(seen.insert(t.mime_type), "duplicate mime {}", t.mime_type);
        }
    }
}
