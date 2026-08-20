use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateAlbumRequest {
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAlbumRequest {
    pub title: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddPhotoToAlbumRequest {
    pub photo_id: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlbumResponse {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub is_auto: bool,
    pub person_id: Option<String>,
    pub photo_count: usize,
    /// The photo to show as the album's cover — the most recently added live one, or null for an
    /// empty album. Just the ID: a client that already holds the library has the thumbnail, and
    /// sending one per album would put a base64 image in every row of the list.
    pub cover_photo_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListAlbumsResponse {
    pub albums: Vec<AlbumResponse>,
}
