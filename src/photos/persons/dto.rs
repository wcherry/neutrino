use crate::photos::photos::dto::PhotoResponse;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PersonFaceThumbnail {
    pub id: String,
    pub thumbnail: Option<String>,
    pub thumbnail_mime_type: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PersonResponse {
    pub id: String,
    pub name: Option<String>,
    pub cover_face_id: Option<String>,
    pub cover_thumbnail: Option<String>,
    pub cover_thumbnail_mime_type: Option<String>,
    pub face_count: i32,
    /// All face thumbnails belonging to this cluster, in insertion order.
    pub faces: Vec<PersonFaceThumbnail>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListPersonsResponse {
    pub persons: Vec<PersonResponse>,
    pub total: usize,
}

// ── Person management requests ─────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RenamePersonRequest {
    pub name: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MergePersonsRequest {
    /// The person whose faces get moved into the target (will be deleted).
    pub source_id: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReassignFaceRequest {
    /// The person this face should be moved to.
    pub target_person_id: String,
}

// ── Internal (worker) endpoints ────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UsersWithFacesResponse {
    pub user_ids: Vec<String>,
}

/// One face's embedding returned to the clustering worker.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FaceEmbeddingEntry {
    pub face_id: String,
    pub photo_id: String,
    pub embedding: Vec<f32>,
    pub thumbnail: Option<String>,
    pub thumbnail_mime_type: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FaceEmbeddingsResponse {
    pub faces: Vec<FaceEmbeddingEntry>,
}

/// One cluster in the result POSTed by the worker.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClusterEntry {
    pub face_ids: Vec<String>,
    pub cover_face_id: String,
    pub cover_thumbnail: Option<String>,
    pub cover_thumbnail_mime_type: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveClustersRequest {
    pub user_id: String,
    pub clusters: Vec<ClusterEntry>,
}

// ── Phase 7: Timeline ───────────────────────────────────────────────────────

/// A chronological group of photos for a person, bucketed by year-month.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TimelineGroup {
    /// Human-readable label, e.g. "March 2025".
    pub label: String,
    /// ISO year-month key, e.g. "2025-03".
    pub month: String,
    pub photos: Vec<PhotoResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PersonTimelineResponse {
    pub groups: Vec<TimelineGroup>,
}

// ── Phase 7: Relationship Insights ─────────────────────────────────────────

/// Two persons that frequently appear together in photos.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PersonRelationship {
    pub person_a_id: String,
    pub person_a_name: Option<String>,
    pub person_a_thumbnail: Option<String>,
    pub person_a_thumbnail_mime_type: Option<String>,
    pub person_b_id: String,
    pub person_b_name: Option<String>,
    pub person_b_thumbnail: Option<String>,
    pub person_b_thumbnail_mime_type: Option<String>,
    pub photo_count: usize,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PersonRelationshipsResponse {
    pub relationships: Vec<PersonRelationship>,
}
