use serde::Serialize;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QuickAccessItem {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub updated_at: String,
    pub score: f64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedCollaborator {
    pub user_id: String,
    pub name: String,
    pub email: String,
    pub shared_file_count: i64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedAction {
    pub file_id: String,
    pub action_type: String,
    pub label: String,
    pub target_id: Option<String>,
}
