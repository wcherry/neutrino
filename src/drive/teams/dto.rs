use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::model::{Team, TeamMember, TeamPage, TeamPageVersion};

// ── Team ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamResponse {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub avatar_color: Option<String>,
    pub avatar_emoji: Option<String>,
    pub visibility: String,
    pub created_by: String,
    /// The page the team opens on — its Home page unless it has been repointed.
    pub default_page_id: Option<String>,
    pub storage_used_bytes: i64,
    /// `null` means the team has no limit of its own, which is the default.
    pub storage_limit_bytes: Option<i64>,
    pub archived: bool,
    pub member_count: i64,
    /// The caller's own role in this team. Always present — a caller with no role never sees the
    /// team at all.
    pub user_role: String,
    pub created_at: String,
    pub updated_at: String,
}

impl TeamResponse {
    pub fn build(team: Team, member_count: i64, user_role: String) -> Self {
        TeamResponse {
            id: team.id,
            name: team.name,
            slug: team.slug,
            description: team.description,
            avatar_color: team.avatar_color,
            avatar_emoji: team.avatar_emoji,
            visibility: team.visibility,
            created_by: team.created_by,
            default_page_id: team.default_page_id,
            storage_used_bytes: team.storage_used_bytes,
            storage_limit_bytes: team.storage_limit_bytes,
            archived: team.archived_at.is_some(),
            member_count,
            user_role,
            created_at: team.created_at.to_string(),
            updated_at: team.updated_at.to_string(),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamListResponse {
    pub teams: Vec<TeamResponse>,
    pub total: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateTeamRequest {
    pub name: String,
    pub description: Option<String>,
    pub avatar_color: Option<String>,
    pub avatar_emoji: Option<String>,
    /// `private` | `invite_only` | `organization`. Defaults to `private`.
    pub visibility: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTeamRequest {
    pub name: Option<String>,
    /// Doubly wrapped so `{"description": null}` clears it and an absent key leaves it alone.
    pub description: Option<Option<String>>,
    pub avatar_color: Option<Option<String>>,
    pub avatar_emoji: Option<Option<String>>,
    pub visibility: Option<String>,
    pub default_page_id: Option<String>,
    pub archived: Option<bool>,
}

// ── Members ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberResponse {
    pub user_id: String,
    pub email: String,
    pub name: String,
    pub role: String,
    pub added_by: String,
    pub created_at: String,
}

impl From<TeamMember> for TeamMemberResponse {
    fn from(m: TeamMember) -> Self {
        TeamMemberResponse {
            user_id: m.user_id,
            email: m.user_email,
            name: m.user_name,
            role: m.role,
            added_by: m.added_by,
            created_at: m.created_at.to_string(),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberListResponse {
    pub members: Vec<TeamMemberResponse>,
    pub total: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddMemberRequest {
    pub email: String,
    pub role: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMemberRequest {
    pub role: String,
}

// ── Pages ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamPageResponse {
    pub id: String,
    pub team_id: String,
    pub parent_page_id: Option<String>,
    pub title: String,
    pub slug: String,
    /// Omitted from list responses, where sending every page's whole body would make opening the
    /// sidebar as expensive as opening the wiki.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_md: Option<String>,
    pub icon: Option<String>,
    pub cover_image: Option<String>,
    pub sort_order: i32,
    pub is_home: bool,
    pub published: bool,
    pub created_by: String,
    pub last_edited_by: String,
    pub created_at: String,
    pub updated_at: String,
}

impl TeamPageResponse {
    pub fn with_content(page: TeamPage) -> Self {
        let content = page.content_md.clone();
        let mut dto = Self::summary(page);
        dto.content_md = Some(content);
        dto
    }

    pub fn summary(page: TeamPage) -> Self {
        TeamPageResponse {
            is_home: page.is_home(),
            published: page.published != 0,
            id: page.id,
            team_id: page.team_id,
            parent_page_id: page.parent_page_id,
            title: page.title,
            slug: page.slug,
            content_md: None,
            icon: page.icon,
            cover_image: page.cover_image,
            sort_order: page.sort_order,
            created_by: page.created_by,
            last_edited_by: page.last_edited_by,
            created_at: page.created_at.to_string(),
            updated_at: page.updated_at.to_string(),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamPageListResponse {
    /// Flat, in sibling order. The tree is assembled by the client from `parentPageId`, so one
    /// response serves both the sidebar tree and a flat search result list.
    pub pages: Vec<TeamPageResponse>,
    pub total: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatePageRequest {
    pub title: String,
    pub parent_page_id: Option<String>,
    pub content_md: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePageRequest {
    pub title: Option<String>,
    pub content_md: Option<String>,
    pub icon: Option<Option<String>>,
    pub cover_image: Option<Option<String>>,
    /// Doubly wrapped: `null` moves the page to the top level, an absent key leaves it where it is.
    pub parent_page_id: Option<Option<String>>,
    pub sort_order: Option<i32>,
    pub published: Option<bool>,
    /// A name for the version this save records. Ignored when the save does not change the body.
    pub version_label: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamPageVersionResponse {
    pub id: String,
    pub page_id: String,
    pub version_number: i32,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_md: Option<String>,
    pub label: Option<String>,
    pub created_by: String,
    pub created_by_name: String,
    pub created_at: String,
}

impl TeamPageVersionResponse {
    pub fn with_content(v: TeamPageVersion) -> Self {
        let content = v.content_md.clone();
        let mut dto = Self::summary(v);
        dto.content_md = Some(content);
        dto
    }

    pub fn summary(v: TeamPageVersion) -> Self {
        TeamPageVersionResponse {
            id: v.id,
            page_id: v.page_id,
            version_number: v.version_number,
            title: v.title,
            content_md: None,
            label: v.label,
            created_by: v.created_by,
            created_by_name: v.created_by_name,
            created_at: v.created_at.to_string(),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamPageVersionListResponse {
    pub versions: Vec<TeamPageVersionResponse>,
    pub total: i64,
}

// ── File library ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamFileResponse {
    pub id: String,
    pub name: String,
    pub size_bytes: i64,
    pub mime_type: String,
    pub folder_id: Option<String>,
    /// Who uploaded it. Not who may read it — that is the team's membership.
    pub uploaded_by: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamFolderResponse {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamLibraryResponse {
    pub folders: Vec<TeamFolderResponse>,
    pub files: Vec<TeamFileResponse>,
    pub storage_used_bytes: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateTeamFolderRequest {
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClaimFileRequest {
    /// A file the caller has already uploaded through the ordinary Drive upload endpoint, which is
    /// then moved into this team's library.
    pub file_id: String,
    pub folder_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RenameTeamFileRequest {
    pub name: String,
}

// ── Activity ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamActivityEntry {
    pub id: String,
    /// Who did it, as recorded at the time — so an entry still reads correctly after the person
    /// leaves the team.
    pub actor: String,
    /// A dotted verb: `team.page_created`, `team.file_added`, `team.member_role_changed`.
    pub action: String,
    /// Whatever the action recorded about itself, as arbitrary JSON.
    pub detail: Option<serde_json::Value>,
    pub created_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamActivityResponse {
    pub entries: Vec<TeamActivityEntry>,
    pub total: i64,
}

// ── Query params ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PageListQuery {
    /// Filters the team's pages on title and body. Absent returns the whole tree.
    pub q: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LibraryQuery {
    /// The folder to list. Absent lists the team's root.
    pub folder_id: Option<String>,
}
