use crate::search::model::SearchSnapshotRecord;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

/// Everything about a stored snapshot except the ciphertext itself.
///
/// A client polls this to decide whether a download is worth it: same
/// `version` as last time means its local index is already the snapshot, and
/// its own `deviceId` means it wrote it.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMetaResponse {
    /// Optimistic-concurrency token. Send it back as `expectedVersion` on the
    /// next upload.
    pub version: i32,
    pub size_bytes: i64,
    /// The snapshot's data key sealed to the user's own public key.
    pub wrapped_key: String,
    pub device_id: Option<String>,
    pub updated_at: String,
}

impl From<SearchSnapshotRecord> for SnapshotMetaResponse {
    fn from(r: SearchSnapshotRecord) -> Self {
        SnapshotMetaResponse {
            version: r.version,
            size_bytes: r.size_bytes,
            wrapped_key: r.wrapped_key,
            device_id: r.device_id,
            updated_at: r.updated_at,
        }
    }
}

/// Upload parameters. The ciphertext travels as the raw request body rather
/// than a JSON field: a whole-index snapshot runs to megabytes, and base64 in
/// JSON would inflate it by a third and push it past the default JSON limit.
#[derive(Debug, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct UploadSnapshotParams {
    /// The version this client last saw. Omit it to claim there is no snapshot
    /// yet — which fails if one exists, rather than overwriting it.
    pub expected_version: Option<i32>,
    /// Skip the version check and overwrite whatever is stored. The deliberate
    /// "my index is the good one" escape hatch.
    #[serde(default)]
    pub force: bool,
    pub wrapped_key: String,
    pub device_id: Option<String>,
}

/// Error code for a rejected upload. Clients branch on this to decide between
/// re-pulling the snapshot and retrying with `force`.
pub const SNAPSHOT_VERSION_CONFLICT: &str = "SNAPSHOT_VERSION_CONFLICT";
