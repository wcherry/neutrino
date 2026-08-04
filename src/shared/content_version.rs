//! Optimistic concurrency for file content writes.
//!
//! `files.content_version` is bumped by 1 on every content write. A client that
//! reads a document holds the version it saw; sending it back on the next save
//! lets the server reject the write if anything landed in between — the
//! "reject a save if a file is older than the file already on the server"
//! requirement in `agent_docs/search.md`.
//!
//! This matters most for offline and multi-device editing, where two tabs can
//! each hold a full copy of a document and the last writer would otherwise
//! silently erase the other's work.

use serde::Deserialize;
use utoipa::IntoParams;

/// Whether a content write should be guarded, and against what.
///
/// Note the difference from the search snapshot's version check: there,
/// `expected: None` asserts "nothing is stored yet". Here it means "don't
/// check at all", because most writers (document creation, format promotion,
/// server-side rewrites) have no meaningful version to assert and must keep
/// working unguarded.
#[derive(Debug, Clone, Copy, Default)]
pub struct ContentVersionCheck {
    /// The `content_version` the client believes is current. `None` disables
    /// the check.
    pub expected: Option<i32>,
    /// Save anyway, whatever the stored version is. The client's deliberate
    /// "keep my copy" answer to a rejected save.
    pub force: bool,
}

impl ContentVersionCheck {
    /// No guard — for writers with no client-held version to assert.
    pub const UNCHECKED: Self = Self {
        expected: None,
        force: false,
    };

    /// The version the write must match, or `None` when it is unguarded.
    pub fn enforced(&self) -> Option<i32> {
        if self.force {
            return None;
        }
        self.expected
    }
}

/// Query parameters carrying the check on any endpoint that writes content.
#[derive(Debug, Clone, Copy, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct ContentVersionQuery {
    /// The `contentVersion` this client last read. Omit to save unconditionally.
    pub expected_content_version: Option<i32>,
    /// Overwrite even if the stored version has moved on.
    #[serde(default)]
    pub force: bool,
}

impl From<ContentVersionQuery> for ContentVersionCheck {
    fn from(q: ContentVersionQuery) -> Self {
        ContentVersionCheck {
            expected: q.expected_content_version,
            force: q.force,
        }
    }
}

/// The 409 a guarded write fails with. `code` is what clients branch on; the
/// current version is in the message so a stuck client is debuggable from logs
/// alone, and clients re-read metadata to get it structurally.
pub const CONTENT_VERSION_CONFLICT: &str = "CONTENT_VERSION_CONFLICT";

pub fn conflict_error(file_id: &str, expected: i32, current: i32) -> crate::shared::ApiError {
    crate::shared::ApiError::new(
        409,
        CONTENT_VERSION_CONFLICT,
        format!(
            "File {file_id} has changed on the server (expected content version {expected}, \
             found {current}). Reload and re-apply your changes, or save again with force."
        ),
    )
}
