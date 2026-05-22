use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::drive::permissions::model::PermissionRecord;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    Owner,
    Editor,
    Commenter,
    Viewer,
}

impl Role {
    pub fn as_str(&self) -> &str {
        match self {
            Role::Owner => "owner",
            Role::Editor => "editor",
            Role::Commenter => "commenter",
            Role::Viewer => "viewer",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponse {
    pub id: String,
    pub resource_type: String,
    pub resource_id: String,
    pub user_id: String,
    pub user_email: String,
    pub user_name: String,
    pub role: String,
    pub granted_by: String,
    pub created_at: String,
}

impl From<PermissionRecord> for PermissionResponse {
    fn from(r: PermissionRecord) -> Self {
        PermissionResponse {
            id: r.id,
            resource_type: r.resource_type,
            resource_id: r.resource_id,
            user_id: r.user_id,
            user_email: r.user_email,
            user_name: r.user_name,
            role: r.role,
            granted_by: r.granted_by,
            created_at: r.created_at.to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListPermissionsResponse {
    pub permissions: Vec<PermissionResponse>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GrantPermissionRequest {
    pub user_id: String,
    pub user_email: String,
    pub user_name: String,
    pub role: Role,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePermissionRequest {
    pub role: Role,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TransferOwnershipRequest {
    pub new_owner_id: String,
}
