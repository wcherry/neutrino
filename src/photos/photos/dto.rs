use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegisterPhotoRequest {
    pub file_id: String,
    pub capture_date: Option<String>,
    /// Metadata the client read out of the file before encrypting it.
    ///
    /// Photo content is end-to-end encrypted, so the server only ever sees ciphertext and cannot
    /// extract anything itself. Anything the library needs to know about the bytes — a Live Photo's
    /// `com.apple.quicktime.content.identifier`, for one — has to arrive here, from the browser
    /// that still held the plaintext.
    #[schema(value_type = Option<Object>)]
    pub metadata: Option<Value>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePhotoRequest {
    pub is_starred: Option<bool>,
    pub is_archived: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PhotoResponse {
    pub id: String,
    pub file_id: String,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    /// URL to download/preview the photo via drive API
    pub content_url: String,
    /// Base64-encoded thumbnail string (null if not yet generated)
    pub thumbnail: Option<String>,
    pub thumbnail_mime_type: Option<String>,
    pub is_starred: bool,
    pub is_archived: bool,
    pub capture_date: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// When the photo was moved to the trash, or null if it is live. Clients read this to show how
    /// long a deleted item has left before its retention window closes.
    pub deleted_at: Option<String>,
    /// Extracted image metadata (dimensions, EXIF), null until the worker has processed it.
    pub metadata: Option<Value>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListPhotosResponse {
    pub photos: Vec<PhotoResponse>,
    pub total: usize,
}

// ---- Photo Map ----

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MapPhotoItem {
    pub id: String,
    pub thumbnail_url: String,
    pub latitude: f64,
    pub longitude: f64,
    pub capture_date: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PhotoMapResponse {
    pub items: Vec<MapPhotoItem>,
}

// ---- Photo Edits ----

#[derive(Debug, Deserialize, Serialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CropParams {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Deserialize, Serialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PhotoEditParams {
    pub brightness: Option<f32>,
    pub contrast: Option<f32>,
    pub saturation: Option<f32>,
    pub warmth: Option<f32>,
    pub highlights: Option<f32>,
    pub shadows: Option<f32>,
    pub crop: Option<CropParams>,
    pub rotate: Option<i32>,
    pub filter: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PhotoEditResponse {
    pub photo_id: String,
    pub edits: PhotoEditParams,
    pub created_at: String,
    pub updated_at: String,
}

// ---- Memories / On This Day ----

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryPhotoItem {
    pub id: String,
    pub thumbnail_url: String,
    pub capture_date: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryYear {
    pub year: i32,
    pub photos: Vec<MemoryPhotoItem>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoriesResponse {
    pub memories: Vec<MemoryYear>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct YearInReviewResponse {
    pub year: i32,
    pub photos: Vec<MemoryPhotoItem>,
}

// ---- Locked Folder ----

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetupLockedFolderRequest {
    pub pin: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnlockFolderRequest {
    pub pin: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnlockTokenResponse {
    pub unlock_token: String,
    pub expires_at: String,
}

// ---- Location Privacy ----

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShareSettingsRequest {
    pub strip_gps: bool,
}

// ---- Backed Up ----

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BackedUpPhotoItem {
    pub id: String,
    pub name: String,
    pub size_bytes: i64,
    pub capture_date: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BackedUpPhotosResponse {
    pub photos: Vec<BackedUpPhotoItem>,
}
