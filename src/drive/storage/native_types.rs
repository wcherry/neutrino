//! Registry of native Neutrino document types.
//!
//! Before this existed, every editor app (docs, sheets, slides, drawing,
//! diagrams) carried its own `MIME_TYPE` constant, its own marker table, and
//! its own near-identical `create`/`get`/`autosave` service — five copies of
//! the same code differing only in a mime string and a blob of default
//! content. The registry is the single place those two facts live, so drive
//! can serve every app from one set of endpoints.
//!
//! Membership in this table *is* the marker: a file is a native Neutrino
//! spreadsheet because of its mime type, not because a row exists in a side
//! table saying so. That removes the failure mode where the two disagree.
//!
//! ## Formats
//!
//! Docs, Sheets and Slides store **OOXML** — a document is a real `.docx`, a
//! spreadsheet a real `.xlsx`, a deck a real `.pptx` (issue #127) — so every
//! other office suite can open one and import/export are file copies. There
//! was a generation before that, a bespoke JSON body under
//! `application/x-neutrino-doc`/`-sheet`/`-slide`; no file was ever stored in
//! it, and the types, their seeds and the read paths that served them are gone.
//! Do not reintroduce one: the point of OOXML is that a Neutrino document is
//! readable without Neutrino.
//!
//! Drawing and Diagrams have no OOXML counterpart, so their JSON is not a
//! legacy format the way the bespoke office bodies were.
//!
//! Diagrams is nonetheless not limited to it: a diagram can also be saved as a
//! plain `image/svg+xml`, with the document carried inside the file in a
//! `<metadata>` element so the picture anything can render and the diagram this
//! app reopens are the same file. That type is deliberately **not** in the
//! table below. Membership here means "a file of this type is a Neutrino
//! document", and most SVGs are not — an SVG is a general image type, and
//! seeding every newly created one with a blank diagram body, or claiming every
//! uploaded one as a native document, would both be wrong. Which format a
//! diagram file is in is read from its mime type by the client
//! (`packages/api-diagrams`), and the SVG one is created with no seed at all,
//! exactly as the OOXML types are.

/// A document type Neutrino edits natively.
pub struct NativeType {
    /// The mime type stored on the `files` row.
    pub mime_type: &'static str,
    /// Content written at creation time so a newly created file opens in a
    /// valid state rather than as a zero-byte read the editor has to
    /// special-case.
    ///
    /// Empty means the *client* writes the first body. That is how the OOXML
    /// types work, and it is not a gap: an OOXML package is a zip the server
    /// has no business building, and a seed written here would be plaintext in
    /// object storage until the first save sealed it. The editors open a
    /// zero-byte OOXML file as a blank document and immediately save one,
    /// encrypted, which is both the seed and the sealing in one step.
    pub default_content: &'static str,
}

pub const DRAWING: &str = "application/x-neutrino-drawing";
pub const DIAGRAM: &str = "application/x-neutrino-diagram";

pub const XLSX: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
pub const DOCX: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
pub const PPTX: &str = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// Default bodies written when a file of each type is created, so a new
// document opens in a valid state rather than as a zero-byte read every
// editor would have to special-case. These are the same constants the
// per-app create paths used before they were collapsed into drive.

/// Default drawing: one empty canvas.
const EMPTY_DRAWING_CONTENT: &str = r#"{"version":1,"shapes":[]}"#;

/// Default diagram: one blank page.
const EMPTY_DIAGRAM_CONTENT: &str = r#"{"version":1,"pages":[{"id":"page-1","name":"Page 1","shapes":[],"connectors":[]}],"viewport":{"x":0,"y":0,"zoom":1}}"#;

pub const NATIVE_TYPES: &[NativeType] = &[
    // ── OOXML: what Docs, Sheets and Slides create today ───────────────────
    NativeType {
        mime_type: DOCX,
        default_content: "",
    },
    NativeType {
        mime_type: XLSX,
        default_content: "",
    },
    NativeType {
        mime_type: PPTX,
        default_content: "",
    },
    // ── The canvas apps' own JSON, which is the only format they have ─────
    NativeType {
        mime_type: DRAWING,
        default_content: EMPTY_DRAWING_CONTENT,
    },
    NativeType {
        mime_type: DIAGRAM,
        default_content: EMPTY_DIAGRAM_CONTENT,
    },
];

pub fn lookup(mime_type: &str) -> Option<&'static NativeType> {
    NATIVE_TYPES.iter().find(|t| t.mime_type == mime_type)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every default body is written verbatim into a newly created file, so an
    /// unparseable one hands the editor a document it cannot open. The OOXML
    /// types are exempt because they have no seed at all — a zip is not
    /// something the server writes.
    #[test]
    fn every_json_default_content_is_valid_json() {
        for t in NATIVE_TYPES.iter().filter(|t| !t.default_content.is_empty()) {
            serde_json::from_str::<serde_json::Value>(t.default_content).unwrap_or_else(|e| {
                panic!("default content for {} is not valid JSON: {e}", t.mime_type)
            });
        }
    }

    /// The client writes the first body for these, so a seed here would be a
    /// plaintext one the server had no way to make valid anyway.
    #[test]
    fn ooxml_types_are_seeded_by_the_client() {
        for mime in [DOCX, XLSX, PPTX] {
            assert_eq!(lookup(mime).unwrap().default_content, "");
        }
    }

    /// Opening a document is dispatched on its mime type, and a `.docx` is a
    /// document Neutrino owns now rather than an upload it can only preview.
    #[test]
    fn ooxml_types_are_native() {
        assert!(lookup(DOCX).is_some());
        assert!(lookup(XLSX).is_some());
        assert!(lookup(PPTX).is_some());
    }

    #[test]
    fn unknown_mime_is_not_native() {
        assert!(lookup("text/plain").is_none());
        // Legacy binary Office formats are not OOXML and nothing here reads them.
        assert!(lookup("application/vnd.ms-excel").is_none());
        assert!(lookup("application/msword").is_none());
    }

    /// A diagram can be *stored* as an SVG, and it is still not a native type.
    ///
    /// Membership here means "a file of this type is a Neutrino document", and
    /// most SVGs are somebody's logo. Registering it would seed every newly
    /// created SVG with a blank diagram body — which is not even an SVG, so the
    /// file would be born unreadable by anything, this app included. The
    /// SVG-stored diagram is created with no seed and the client writes the
    /// first body, exactly as the OOXML types do.
    #[test]
    fn the_svg_a_diagram_can_be_stored_as_is_not_a_native_type() {
        assert!(lookup("image/svg+xml").is_none());
    }

    #[test]
    fn every_registered_mime_is_unique() {
        let mut seen = std::collections::HashSet::new();
        for t in NATIVE_TYPES {
            assert!(seen.insert(t.mime_type), "duplicate mime {}", t.mime_type);
        }
    }
}
