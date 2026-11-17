use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateAppPasswordRequest {
    /// What the password is for, as the user will recognise it in the list ("iPhone").
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AppPasswordResponse {
    pub id: String,
    pub name: String,
    pub created_at: String,
    /// When a device last signed in with it, to the minute. `None` until first use.
    pub last_used_at: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListAppPasswordsResponse {
    pub app_passwords: Vec<AppPasswordResponse>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatedAppPasswordResponse {
    pub app_password: AppPasswordResponse,
    /// The password in the clear. Returned by this response only; it can't be read again.
    pub password: String,
}
