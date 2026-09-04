use crate::schema::{team_join_requests, team_members, team_page_versions, team_pages, teams};
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
