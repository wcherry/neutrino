use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ── Requests ──────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectAppleRequest {
    pub caldav_url: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TriggerSyncRequest {
    /// Optional connection ID to sync only one provider; omit to sync all.
    pub connection_id: Option<String>,
}

// ── Responses ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionResponse {
    pub id: String,
    pub provider: String,
    pub email: Option<String>,
    pub caldav_url: Option<String>,
    pub expires_at: Option<String>,
    pub sync_cursor: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListConnectionsResponse {
    pub connections: Vec<ConnectionResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OAuthInitResponse {
    /// Redirect the user's browser to this URL to begin the OAuth2 flow.
    pub auth_url: String,
}

/// Body for the two-step Google OAuth completion endpoint.
/// The frontend captures the authorization code from the OAuth redirect URL
/// and POSTs it here with the user's JWT for authenticated token exchange.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompleteGoogleRequest {
    pub code: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TriggerSyncResponse {
    pub events_synced: usize,
}
