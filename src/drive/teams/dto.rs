use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::model::{Team, TeamJoinRequest, TeamMember, TeamPage, TeamPageVersion};

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
    /// `private` (not discoverable) | `organization` (discoverable, join yourself) | `invite_only`
    /// (discoverable, request access). Defaults to `private`.
    pub visibility: Option<String>,
}

// ── Discovery ────────────────────────────────────────────────────────────────

/// A discoverable team, as seen by someone who is **not** in it.
///
/// Deliberately much smaller than [`TeamResponse`], which stays the members-only view: no storage
/// figures, no default page, no creator, and above all no `userRole` — a caller holding one of
/// these has no role, and the invariant that a `TeamResponse` implies membership is what several
/// call sites rely on. This carries only what someone needs to decide whether to join.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverableTeamResponse {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub avatar_color: Option<String>,
    pub avatar_emoji: Option<String>,
    /// `organization` or `invite_only`. Never `private` — those are not discoverable.
    pub visibility: String,
    pub member_count: i64,
    /// `join` if the caller can add themselves, `request` if they must ask, `requested` if they
    /// already have. What the button should say, decided by the server so the client cannot get
    /// the policy wrong.
    pub join_action: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverableTeamListResponse {
    pub teams: Vec<DiscoverableTeamResponse>,
    pub total: i64,
}

// ── Join requests ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RequestAccessRequest {
    /// Optional note to whoever answers it. An admin looking at a name they do not recognise has
    /// nothing else to go on.
    pub message: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequestResponse {
    pub id: String,
    pub team_id: String,
    pub user_id: String,
    pub email: String,
    pub name: String,
    pub message: Option<String>,
    /// `pending` | `approved` | `declined`.
    pub status: String,
    pub decided_by: Option<String>,
    pub decided_at: Option<String>,
    pub created_at: String,
}

impl From<TeamJoinRequest> for JoinRequestResponse {
    fn from(r: TeamJoinRequest) -> Self {
        JoinRequestResponse {
            id: r.id,
            team_id: r.team_id,
            user_id: r.user_id,
            email: r.user_email,
            name: r.user_name,
            message: r.message,
            status: r.status,
            decided_by: r.decided_by,
            decided_at: r.decided_at.map(|d| d.to_string()),
            created_at: r.created_at.to_string(),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequestListResponse {
    pub requests: Vec<JoinRequestResponse>,
    pub total: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequestListQuery {
    /// `pending` (the default), `approved` or `declined`.
    pub status: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApproveJoinRequestRequest {
    /// The role to admit them in. Defaults to `viewer`, the same least-privilege default a
    /// self-serve join uses.
    pub role: Option<String>,
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

// ── Transfers: moving and sharing a personal file ─────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MoveFileIntoTeamRequest {
    /// A live file in the caller's own My Drive. Not one already in a team, and not one merely
    /// shared with the caller — moving a file gives it away, which is the owner's decision alone.
    pub file_id: String,
    /// Where in the team's library it lands. Absent puts it at the team root.
    pub folder_id: Option<String>,
}

/// The moved file, plus what the move cost the people the file used to be shared with.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MoveFileIntoTeamResponse {
    pub file: TeamFileResponse,
    /// How many individual grants on the file stopped applying because of the move.
    ///
    /// Reported rather than merely allowed to happen. A team file is governed by the team and by
    /// nothing else, so every personal share of the file — and the mover's own ownership of it —
    /// is inert from the moment it lands. That is the intended rule, but it is invisible from the
    /// outside, and a number here lets the client warn before the move rather than leave the mover
    /// to discover it when a colleague asks why a file disappeared.
    pub shares_no_longer_applied: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShareFileWithTeamRequest {
    /// A live file in the caller's own My Drive. It stays there: this lends it, it does not move
    /// it.
    pub file_id: String,
    /// `viewer` or `editor`. Absent means `viewer`, which is the answer that cannot surprise
    /// anybody. `owner` is not accepted at all.
    pub role: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamSharedFileResponse {
    pub file_id: String,
    pub name: String,
    pub size_bytes: i64,
    pub mime_type: String,
    /// `viewer` | `editor` — what every member of this team may do with the file.
    pub role: String,
    /// The owner who lent it. Still the file's owner: a share is not a transfer.
    pub shared_by: String,
    pub shared_by_name: String,
    pub shared_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamSharedFileListResponse {
    pub files: Vec<TeamSharedFileResponse>,
    pub total: i64,
}

/// One team a personal file has been lent to.
///
/// The mirror image of [`TeamSharedFileResponse`], which answers "what has this team been lent?".
/// This answers "who has this file been lent to?" — the question a file's own Share dialog asks,
/// where teams are listed beside the people who have access. So it carries the team's identity,
/// including the avatar the picker showed when the team was chosen, rather than the file's.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileTeamShareResponse {
    pub team_id: String,
    pub name: String,
    pub slug: String,
    pub avatar_color: Option<String>,
    pub avatar_emoji: Option<String>,
    /// `viewer` | `editor` — what every member of this team may do with the file.
    pub role: String,
    /// Who lent it. Not always the caller: a team admin sees the same row from the team's Files
    /// page, and a file can only be lent by its owner, so this is the owner unless it has changed
    /// hands since.
    pub shared_by: String,
    pub shared_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileTeamShareListResponse {
    pub teams: Vec<FileTeamShareResponse>,
    pub total: i64,
}

// ── Administration ───────────────────────────────────────────────────────────

/// One team as the admin console sees it: the outside of a team, and no more.
///
/// Name, size and membership count — enough to answer "which team is about to run out of room?"
/// and nothing about what is inside. A team's pages, files and activity stay behind membership
/// even for a deployment administrator; those are reached through the surfaces that log the
/// access.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminTeamResponse {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub visibility: String,
    /// Who created the team, as a user id. Not the same question as who owns it now — the creator
    /// can have been demoted, removed, or had their account deleted — which is why `owners` is a
    /// separate field read from the membership rather than this one dressed up.
    pub created_by: String,
    pub archived: bool,
    /// The team's current Owners, oldest membership first.
    ///
    /// A list rather than one, because the role is not a slot: a team can have several Owners, and
    /// the member routes guard only against removing the last. It can also be **empty** — the last
    /// Owner's account can be deleted out from under a team — and that is the state the transfer
    /// route exists to repair, so the console renders it as a warning rather than as a blank.
    pub owners: Vec<AdminTeamOwner>,
    pub member_count: i64,
    /// Summed from the live file rows on this read, not the cached column.
    pub storage_used_bytes: i64,
    /// `null` is unlimited, which is a choice rather than an absence.
    pub storage_limit_bytes: Option<i64>,
    /// `null` when unlimited; never negative, so a team over its limit reads as zero room left.
    pub storage_remaining_bytes: Option<i64>,
    /// True when the team already holds more than its limit — which an administrator lowering a
    /// limit can bring about deliberately, and which does not delete anything.
    pub over_quota: bool,
    pub created_at: String,
}

/// One Owner of a team, as the console lists them.
///
/// Email and name come from the denormalised copy on `team_members`, which is what makes a row
/// still readable after the account behind it is gone — the same reason the member list stores
/// them.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminTeamOwner {
    pub user_id: String,
    pub email: String,
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminTeamListResponse {
    pub teams: Vec<AdminTeamResponse>,
    /// Every live team matching the filter, not just this page's worth.
    pub total: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminTeamListQuery {
    /// Filters on team name and slug. Absent lists them all.
    pub q: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Authoritative, not a patch: this replaces the team's limit.
///
/// `storageLimitBytes: null` is **unlimited**, and it has to be sent explicitly — which is why the
/// field is required rather than `Option<Option<i64>>`. An omitted field meaning "leave it alone"
/// and an explicit null meaning "unlimited" are one keystroke apart in a JSON body, and the cost of
/// confusing them is a team that quietly stops having a quota.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetTeamQuotaRequest {
    pub storage_limit_bytes: Option<i64>,
}

/// Hand a team to somebody.
///
/// By email rather than by user id, because the administrator doing this is reading a leavers list
/// or a support ticket, not a database. The id is looked up server-side and the lookup failing is a
/// 404 that names the problem — which is a better outcome than a valid-looking id that belongs to
/// nobody.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetTeamOwnerRequest {
    pub email: String,
}

/// Pause a team, or restart it. Authoritative, not a toggle: the caller sends the state it wants.
///
/// A toggle would depend on the console's copy of the team being current, and two administrators
/// on the same screen would each undo the other. Sending the desired state makes a repeated request
/// idempotent.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetTeamArchivedRequest {
    pub archived: bool,
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
