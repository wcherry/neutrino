use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddLibraryRequest {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMeta {
    pub id: String,
    pub name: String,
    pub url: String,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LibraryContent {
    pub id: String,
    pub name: String,
    pub url: String,
    pub xml_content: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListLibrariesResponse {
    pub libraries: Vec<LibraryMeta>,
}
