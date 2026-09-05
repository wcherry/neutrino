use crate::schema::{
    team_file_shares, team_join_requests, team_members, team_page_versions, team_pages, teams,
};
use chrono::NaiveDateTime;
use diesel::prelude::*;

// ── Team ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = teams)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct Team {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub avatar_color: Option<String>,
    pub avatar_emoji: Option<String>,
    pub visibility: String,
    pub created_by: String,
    /// The page a team opens on. Set to the Home page at creation, and repointable at any live page
    /// so a team can land somewhere other than Home once it has a dashboard worth landing on.
    pub default_page_id: Option<String>,
    pub storage_used_bytes: i64,
    pub storage_limit_bytes: Option<i64>,
    pub settings_json: Option<String>,
    pub archived_at: Option<NaiveDateTime>,
    pub deleted_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

impl Team {
    pub fn is_archived(&self) -> bool {
        self.archived_at.is_some()
    }
}

#[derive(Debug, Insertable)]
#[diesel(table_name = teams)]
pub struct NewTeam {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub avatar_color: Option<String>,
    pub avatar_emoji: Option<String>,
    pub visibility: String,
    pub created_by: String,
    /// The team's disk quota, in bytes. `None` is unlimited.
    ///
    /// Written at creation rather than left to a column default, because the column has none and
    /// must not get one: a default would make `None` unreachable through an INSERT that omits the
    /// field, and "unlimited" is a choice an administrator is allowed to make. See
    /// [`DEFAULT_TEAM_QUOTA_BYTES`](crate::drive::teams::quota::DEFAULT_TEAM_QUOTA_BYTES).
    pub storage_limit_bytes: Option<i64>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

// ── Membership ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = team_members)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TeamMember {
    pub id: String,
    pub team_id: String,
    pub user_id: String,
    pub user_email: String,
    pub user_name: String,
    pub role: String,
    pub added_by: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = team_members)]
pub struct NewTeamMember {
    pub id: String,
    pub team_id: String,
    pub user_id: String,
    pub user_email: String,
    pub user_name: String,
    pub role: String,
    pub added_by: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

// ── Join requests ────────────────────────────────────────────────────────────

/// Someone asking to join an invite-only team.
///
/// Only `invite_only` produces these. An `organization` team is joined by adding yourself, so there
/// is nothing to record beyond the membership itself, and a `private` team cannot be found to ask
/// about — see [`Visibility`](super::visibility::Visibility).
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = team_join_requests)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TeamJoinRequest {
    pub id: String,
    pub team_id: String,
    pub user_id: String,
    pub user_email: String,
    pub user_name: String,
    pub message: Option<String>,
    /// `pending` | `approved` | `declined`. See [`RequestStatus`].
    pub status: String,
    pub decided_by: Option<String>,
    pub decided_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

/// The three states of a request, as stored.
///
/// Text rather than an integer for the same reason `team_members.role` is: the value is read
/// straight out of the database by hand often enough that it should say what it means.
pub struct RequestStatus;

impl RequestStatus {
    pub const PENDING: &'static str = "pending";
    pub const APPROVED: &'static str = "approved";
    pub const DECLINED: &'static str = "declined";
}

#[derive(Debug, Insertable)]
#[diesel(table_name = team_join_requests)]
pub struct NewTeamJoinRequest {
    pub id: String,
    pub team_id: String,
    pub user_id: String,
    pub user_email: String,
    pub user_name: String,
    pub message: Option<String>,
    pub status: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

// ── Pages ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = team_pages)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TeamPage {
    pub id: String,
    pub team_id: String,
    pub parent_page_id: Option<String>,
    pub title: String,
    pub slug: String,
    pub content_md: String,
    pub icon: Option<String>,
    pub cover_image: Option<String>,
    pub sort_order: i32,
    /// SQLite has no boolean, and the partial unique index in 00127 is written against the integer,
    /// so this stays an `i32` rather than becoming a `bool` that Diesel would have to map.
    pub is_home: i32,
    pub published: i32,
    pub created_by: String,
    pub last_edited_by: String,
    pub deleted_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

impl TeamPage {
    pub fn is_home(&self) -> bool {
        self.is_home != 0
    }
}

#[derive(Debug, Insertable)]
#[diesel(table_name = team_pages)]
pub struct NewTeamPage {
    pub id: String,
    pub team_id: String,
    pub parent_page_id: Option<String>,
    pub title: String,
    pub slug: String,
    pub content_md: String,
    pub icon: Option<String>,
    pub sort_order: i32,
    pub is_home: i32,
    pub created_by: String,
    pub last_edited_by: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = team_page_versions)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TeamPageVersion {
    pub id: String,
    pub page_id: String,
    pub version_number: i32,
    pub title: String,
    pub content_md: String,
    pub label: Option<String>,
    pub created_by: String,
    pub created_by_name: String,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = team_page_versions)]
pub struct NewTeamPageVersion {
    pub id: String,
    pub page_id: String,
    pub version_number: i32,
    pub title: String,
    pub content_md: String,
    pub label: Option<String>,
    pub created_by: String,
    pub created_by_name: String,
    pub created_at: NaiveDateTime,
}

// ── Shared files ─────────────────────────────────────────────────────────────

/// A personal file its owner has lent to a team (migration 00130).
///
/// The counterpart to a *move*, which is `files.team_id` and leaves no row anywhere: a moved file
/// belongs to the team and is indistinguishable from one uploaded into it. A share leaves the file
/// where it is and in its owner's hands, so it needs somewhere to say so — and somewhere to be
/// deleted from when the owner takes it back.
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = team_file_shares)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TeamFileShare {
    pub id: String,
    pub team_id: String,
    pub file_id: String,
    /// `viewer` | `editor`, in the Drive vocabulary rather than the six team roles — this is what
    /// `get_effective_role` will return for every member of the team, and it is a ceiling: a team
    /// Owner reading a file shared as `viewer` gets `viewer`.
    pub role: String,
    pub shared_by: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

/// The two roles a file may be lent at.
///
/// `owner` is deliberately not among them, for the reason `role_from_team_membership` gives for
/// never returning it: a Drive owner may reshare a file and change its permissions, and lending a
/// file to a team is not handing every member the authority to give it away.
pub struct ShareRole;

impl ShareRole {
    pub const VIEWER: &'static str = "viewer";
    pub const EDITOR: &'static str = "editor";

    /// Parse an incoming role name, returning the canonical stored form.
    ///
    /// `None` for anything else — including `owner`, which is a real Drive role and the one this
    /// deliberately will not grant, so it has to be rejected rather than fall through to a default.
    pub fn parse(value: &str) -> Option<&'static str> {
        match value {
            Self::VIEWER => Some(Self::VIEWER),
            Self::EDITOR => Some(Self::EDITOR),
            _ => None,
        }
    }

    /// The stronger of two lent roles.
    ///
    /// A file can be lent to two teams the same person is in, at different roles. Taking the
    /// stronger is the only answer that does not depend on row order, and it matches what the two
    /// shares actually said: one of the owner's decisions was that this person may edit.
    pub fn stronger<'a>(a: &'a str, b: &'a str) -> &'a str {
        if a == Self::EDITOR || b == Self::EDITOR {
            Self::EDITOR
        } else {
            a
        }
    }
}
