use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FaceBoundingBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub confidence: f32,
    pub image_width: u32,
    pub image_height: u32,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FaceResponse {
    pub id: String,
    pub photo_id: String,
    pub bounding_box: FaceBoundingBox,
    /// Base64-encoded JPEG thumbnail of the cropped face region (null until worker processes it)
    pub thumbnail: Option<String>,
    pub thumbnail_mime_type: Option<String>,
    pub person_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListFacesResponse {
    pub faces: Vec<FaceResponse>,
    pub total: usize,
}

/// Worker-to-service: submit a detected face for a photo.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveFaceRequest {
    pub bounding_box: FaceBoundingBox,
    /// Base64-encoded thumbnail of the cropped face (null if crop failed)
    pub thumbnail: Option<String>,
    pub thumbnail_mime_type: Option<String>,
    /// L2-normalized ArcFace embedding vector (512 floats). Null if recognition model not loaded.
    pub embedding: Option<Vec<f32>>,
}
