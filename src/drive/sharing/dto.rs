#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::drive::sharing::model::ShareLinkRecord;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum LinkVisibility {
    /// Publicly visible (indexable)
    Public,
    /// Accessible to anyone who has the link
    AnyoneWithLink,
}

impl LinkVisibility {
    pub fn as_str(&self) -> &str {
        match self {
            LinkVisibility::Public => "public",
            LinkVisibility::AnyoneWithLink => "anyone_with_link",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "public" => Some(LinkVisibility::Public),
            "anyone_with_link" => Some(LinkVisibility::AnyoneWithLink),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum LinkRole {
    Viewer,
    Commenter,
    Editor,
}

impl LinkRole {
    pub fn as_str(&self) -> &str {
        match self {
            LinkRole::Viewer => "viewer",
            LinkRole::Commenter => "commenter",
            LinkRole::Editor => "editor",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "viewer" => Some(LinkRole::Viewer),
            "commenter" => Some(LinkRole::Commenter),
            "editor" => Some(LinkRole::Editor),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShareLinkResponse {
    pub id: String,
    pub resource_type: String,
    pub resource_id: String,
    pub token: String,
    pub visibility: String,
    pub role: String,
    pub expires_at: Option<String>,
    pub is_active: bool,
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
    /// Whether a password is required. The hash itself is never returned.
    pub has_password: bool,
    /// base64url X25519 public half of the link key, when the link has one.
    pub public_key: Option<String>,
    /// The recipient id a file key is sealed to for this link (`guest:{id}`), for
    /// `POST /files/{id}/key/share`.
    pub key_subject: String,
    /// The link key seed sealed to the owner's public key; only the owner's browser opens it.
    pub sealed_seed: Option<String>,
    pub sealed_seed_key_version: Option<i32>,
}

impl ShareLinkResponse {
    pub fn empty() -> Self {
        let emstring = "".to_string();
        Self {
            id: emstring.clone(),
            resource_type: emstring.clone(),
            resource_id: emstring.clone(),
            token: emstring.clone(),
            visibility: emstring.clone(),
            role: emstring.clone(),
            expires_at: None,
            is_active: false,
            created_by: emstring.clone(),
            created_at: emstring.clone(),
            updated_at: emstring.clone(),
            has_password: false,
            public_key: None,
            key_subject: emstring.clone(),
            sealed_seed: None,
            sealed_seed_key_version: None,
        }
    }
}

impl From<ShareLinkRecord> for ShareLinkResponse {
    fn from(r: ShareLinkRecord) -> Self {
        let key_subject = r.key_subject();
        ShareLinkResponse {
            has_password: r.password_hash.is_some(),
            public_key: r.public_key,
            key_subject,
            sealed_seed: r.sealed_seed,
            sealed_seed_key_version: r.sealed_seed_key_version,
            id: r.id,
            resource_type: r.resource_type,
            resource_id: r.resource_id,
            token: r.token,
            visibility: r.visibility,
            role: r.role,
            expires_at: r.expires_at.map(|dt| dt.to_string()),
            is_active: r.is_active,
            created_by: r.created_by,
            created_at: r.created_at.to_string(),
            updated_at: r.updated_at.to_string(),
        }
    }
}

/// Request body for creating or replacing a share link.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpsertShareLinkRequest {
    #[serde(default = "default_visibility")]
    pub visibility: LinkVisibility,
    #[serde(default = "default_role")]
    pub role: LinkRole,
    /// ISO 8601 datetime string, e.g. "2026-12-31T23:59:59"
    pub expires_at: Option<String>,
    /// Require this password to open the link. Omitted or empty: no password.
    #[serde(default)]
    pub password: Option<String>,
    /// base64url X25519 public key of the link key pair (32 bytes). Folder links that guests
    /// read or write encrypted files through need one.
    #[serde(default)]
    pub public_key: Option<String>,
    /// The link key seed sealed to the caller's own public key, stored for the owner alone.
    #[serde(default)]
    pub sealed_seed: Option<String>,
    #[serde(default)]
    pub sealed_seed_key_version: Option<i32>,
}

fn default_visibility() -> LinkVisibility {
    LinkVisibility::AnyoneWithLink
}

fn default_role() -> LinkRole {
    LinkRole::Viewer
}

/// Request body for updating share link settings.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateShareLinkRequest {
    pub visibility: Option<LinkVisibility>,
    pub role: Option<LinkRole>,
    /// ISO 8601 datetime string. Pass null to remove expiration.
    pub expires_at: Option<Option<String>>,
    pub is_active: Option<bool>,
    /// Set or change the password; null removes it. Any change ends every open guest session.
    #[serde(default, deserialize_with = "double_option")]
    #[schema(value_type = Option<String>)]
    pub password: Option<Option<String>>,
    /// Replace the link public key; null removes it.
    #[serde(default, deserialize_with = "double_option")]
    #[schema(value_type = Option<String>)]
    pub public_key: Option<Option<String>>,
    /// Replace the owner-sealed seed (with `sealedSeedKeyVersion`); null removes it.
    #[serde(default, deserialize_with = "double_option")]
    #[schema(value_type = Option<String>)]
    pub sealed_seed: Option<Option<String>>,
    #[serde(default)]
    pub sealed_seed_key_version: Option<i32>,
}

/// Tells an absent field (`None`) from an explicit null (`Some(None)`).
fn double_option<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

/// Response when resolving a share link token (public endpoint).
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedShareLinkResponse {
    /// True when the link needs a password. Until a session is created with it, everything below
    /// except `resourceType` is withheld (empty strings / null).
    pub password_required: bool,
    pub resource_type: String,
    pub resource_id: String,
    pub role: String,
    pub visibility: String,
    pub expires_at: Option<String>,
    /// Basic resource info
    pub resource_name: String,
    /// MIME type of the resource (populated for file resources).
    pub mime_type: Option<String>,
    /// When true, the workspace requires authenticated org-domain users to access this link.
    /// The client should enforce this by checking the authenticated user's email domain.
    pub domain_only: bool,
    /// The required organization domain when domain_only is true (e.g. "acme.com").
    pub allowed_domain: Option<String>,
}

/// Response from the guest session exchange endpoint.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GuestSessionResponse {
    pub access_token: String,
    pub expires_in: i64,
    pub role: String,
    pub resource_type: String,
    pub resource_id: String,
    pub resource_name: String,
    /// The subject this link's file keys are sealed to (`guest:{link id}`).
    pub key_subject: String,
    /// The link public key, so the guest can check the fragment key matches before using it.
    pub public_key: Option<String>,
}

/// Request body for `POST /share/{token}/session`. Optional; only links with a password need it.
#[derive(Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateGuestSessionRequest {
    pub password: Option<String>,
}

/// One party a new file's key must be sealed to, so everyone who can see the folder can open it.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct KeyRecipient {
    /// `recipientId` for `POST /files/{id}/key/share`.
    pub recipient_id: String,
    /// "owner" (the folder's owner) or "link" (a folder link's key).
    pub kind: String,
    /// base64url X25519 public key.
    pub public_key: String,
    pub key_version: i32,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct KeyRecipientsResponse {
    pub recipients: Vec<KeyRecipient>,
}

/// Encrypted files under a folder link that are not yet sealed to the link key.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnkeyedFilesResponse {
    pub key_subject: String,
    pub public_key: Option<String>,
    pub file_ids: Vec<String>,
    /// True when there may be more than `fileIds` returned; seal these and ask again.
    pub has_more: bool,
}
