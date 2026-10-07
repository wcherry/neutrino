use serde::{Deserialize, Serialize};
use std::fmt;
use utoipa::ToSchema;

/// Create or replace a saved place.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveTaskPlaceRequest {
    /// A v1 PlaceEnvelope, sealed on the client. At most 4 KB.
    pub encrypted_payload: String,
}

/// Never prints the payload, so a stray `{:?}` can't put it in a log.
impl fmt::Debug for SaveTaskPlaceRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SaveTaskPlaceRequest")
            .field(
                "encrypted_payload",
                &format_args!("<{} bytes>", self.encrypted_payload.len()),
            )
            .finish()
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPlaceResponse {
    pub id: String,
    pub encrypted_payload: String,
    pub created_at: String,
    pub updated_at: String,
}

impl fmt::Debug for TaskPlaceResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TaskPlaceResponse")
            .field("id", &self.id)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTaskPlacesResponse {
    pub places: Vec<TaskPlaceResponse>,
}
