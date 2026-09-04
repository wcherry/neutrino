//! HTTP surface for Team Spaces (issue #185).
//!
//! Everything hangs off `/api/v1/drive/teams`, additively: no existing Drive route changes shape,
//! so the six iOS apps and the macOS client are unaffected by this release and can adopt the team
//! routes on their own schedule.
//!
//! Every handler is gated in the service rather than here, so a route cannot be added without
//! passing through the gate, and a gated-off route answers 404 — see `feature_flags::gate`.

use actix_web::{delete, get, patch, post, web, HttpResponse};
use std::sync::Arc;

use super::dto::*;
use super::service::TeamsService;
use crate::shared::{ApiError, AuthenticatedUser};

pub struct TeamsApiState {
    pub service: Arc<TeamsService>,
}

// ── Teams ────────────────────────────────────────────────────────────────────

/// List the Team Spaces the caller belongs to.
#[utoipa::path(
    get,
    path = "/api/v1/drive/teams",
    responses(
        (status = 200, description = "The caller's teams", body = TeamListResponse),
        (status = 404, description = "Team Spaces is not enabled on this deployment"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[get("")]
pub async fn list_teams(
    state: web::Data<TeamsApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamListResponse>, ApiError> {
    Ok(web::Json(state.service.list_teams(&user)?))
}

/// Create a Team Space.
///
/// The caller becomes its Owner and the team is created with a Home page.
#[utoipa::path(
    post,
    path = "/api/v1/drive/teams",
    request_body = CreateTeamRequest,
    responses(
        (status = 200, description = "The created team", body = TeamResponse),
        (status = 400, description = "Missing name, or an unknown visibility"),
        (status = 404, description = "Team Spaces is not enabled on this deployment"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[post("")]
pub async fn create_team(
    state: web::Data<TeamsApiState>,
    body: web::Json<CreateTeamRequest>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamResponse>, ApiError> {
    Ok(web::Json(
        state.service.create_team(body.into_inner(), &user)?,
    ))
}

/// Read one team.
#[utoipa::path(
    get,
    path = "/api/v1/drive/teams/{teamId}",
    params(("teamId" = String, Path, description = "Team id")),
    responses(
        (status = 200, description = "The team", body = TeamResponse),
        (status = 404, description = "No such team, or the caller is not a member of it"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[get("/{team_id}")]
pub async fn get_team(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamResponse>, ApiError> {
    Ok(web::Json(state.service.get_team(&path.into_inner(), &user)?))
}

/// Rename a team, change its avatar or visibility, or archive and restore it.
#[utoipa::path(
    patch,
    path = "/api/v1/drive/teams/{teamId}",
    params(("teamId" = String, Path, description = "Team id")),
    request_body = UpdateTeamRequest,
    responses(
        (status = 200, description = "The updated team", body = TeamResponse),
        (status = 403, description = "The caller's role cannot manage this team's settings"),
        (status = 404, description = "No such team, or the caller is not a member of it"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[patch("/{team_id}")]
pub async fn update_team(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    body: web::Json<UpdateTeamRequest>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamResponse>, ApiError> {
    Ok(web::Json(state.service.update_team(
        &path.into_inner(),
        body.into_inner(),
        &user,
    )?))
}

/// Delete a team. Owner only, and reversible: the row is soft-deleted.
#[utoipa::path(
    delete,
    path = "/api/v1/drive/teams/{teamId}",
    params(("teamId" = String, Path, description = "Team id")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 403, description = "The caller is not the team's owner"),
        (status = 404, description = "No such team, or the caller is not a member of it"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[delete("/{team_id}")]
pub async fn delete_team(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    state.service.delete_team(&path.into_inner(), &user)?;
    Ok(HttpResponse::NoContent().finish())
}

// ── Discovery and joining ────────────────────────────────────────────────────

/// List the teams the caller could join but is not in.
///
/// The only route here a non-member may read, and it returns a deliberately smaller shape than
/// `GET /teams/{id}`: enough to decide whether to join, and nothing about the team's contents.
/// Private teams never appear, whoever asks.
#[utoipa::path(
    get,
    path = "/api/v1/drive/teams/discoverable",
    responses(
        (status = 200, description = "Teams the caller could join", body = DiscoverableTeamListResponse),
        (status = 404, description = "Team Spaces is not enabled on this deployment"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[get("/discoverable")]
pub async fn list_discoverable(
    state: web::Data<TeamsApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<DiscoverableTeamListResponse>, ApiError> {
    Ok(web::Json(state.service.list_discoverable(&user)?))
}

/// Join an `organization` team, without asking anyone.
#[utoipa::path(
    post,
    path = "/api/v1/drive/teams/{teamId}/join",
    params(("teamId" = String, Path, description = "Team id")),
    responses(
        (status = 200, description = "The caller's new membership", body = TeamMemberResponse),
        (status = 403, description = "The team is invite only — request access instead"),
        (status = 404, description = "No such team, or it is private"),
        (status = 409, description = "Already a member, or the team is archived"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[post("/{team_id}/join")]
pub async fn join_team(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamMemberResponse>, ApiError> {
    Ok(web::Json(state.service.join_team(&path.into_inner(), &user)?))
}

/// Ask to join an `invite_only` team.
#[utoipa::path(
    post,
    path = "/api/v1/drive/teams/{teamId}/join-requests",
    params(("teamId" = String, Path, description = "Team id")),
    request_body = RequestAccessRequest,
    responses(
        (status = 200, description = "The pending request", body = JoinRequestResponse),
        (status = 400, description = "Anyone can join this team, so no request is needed"),
        (status = 404, description = "No such team, or it is private"),
        (status = 409, description = "Already asked, already a member, or the team is archived"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[post("/{team_id}/join-requests")]
pub async fn request_access(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    body: web::Json<RequestAccessRequest>,
    user: AuthenticatedUser,
) -> Result<web::Json<JoinRequestResponse>, ApiError> {
    Ok(web::Json(state.service.request_access(
        &path.into_inner(),
        body.into_inner(),
        &user,
    )?))
}

/// The team's join requests, oldest first. Owners and Admins only.
#[utoipa::path(
    get,
    path = "/api/v1/drive/teams/{teamId}/join-requests",
    params(
        ("teamId" = String, Path, description = "Team id"),
        ("status" = Option<String>, Query, description = "pending (default), approved or declined"),
    ),
    responses(
        (status = 200, description = "The requests", body = JoinRequestListResponse),
        (status = 403, description = "The caller's role cannot answer join requests"),
        (status = 404, description = "No such team, or the caller is not a member of it"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[get("/{team_id}/join-requests")]
pub async fn list_join_requests(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    query: web::Query<JoinRequestListQuery>,
    user: AuthenticatedUser,
) -> Result<web::Json<JoinRequestListResponse>, ApiError> {
    Ok(web::Json(state.service.list_join_requests(
        &path.into_inner(),
        query.status.as_deref(),
        &user,
    )?))
}

/// Approve a request, admitting the requester as a Viewer unless another role is named.
#[utoipa::path(
    post,
    path = "/api/v1/drive/teams/{teamId}/join-requests/{requestId}/approve",
    params(
        ("teamId" = String, Path, description = "Team id"),
        ("requestId" = String, Path, description = "Join request id"),
    ),
    request_body = ApproveJoinRequestRequest,
    responses(
        (status = 200, description = "The new member", body = TeamMemberResponse),
        (status = 400, description = "Unknown role"),
        (status = 403, description = "The caller's role cannot answer join requests, or cannot grant ownership"),
        (status = 404, description = "No such request in this team"),
        (status = 409, description = "The request was already answered, or they are already a member"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[post("/{team_id}/join-requests/{request_id}/approve")]
pub async fn approve_join_request(
    state: web::Data<TeamsApiState>,
    path: web::Path<(String, String)>,
    body: web::Json<ApproveJoinRequestRequest>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamMemberResponse>, ApiError> {
    let (team_id, request_id) = path.into_inner();
    Ok(web::Json(state.service.approve_join_request(
        &team_id,
        &request_id,
        body.into_inner(),
        &user,
    )?))
}

/// Decline a request. The row is kept as answered rather than deleted.
#[utoipa::path(
    post,
    path = "/api/v1/drive/teams/{teamId}/join-requests/{requestId}/decline",
    params(
        ("teamId" = String, Path, description = "Team id"),
        ("requestId" = String, Path, description = "Join request id"),
    ),
    responses(
        (status = 204, description = "Declined"),
        (status = 403, description = "The caller's role cannot answer join requests"),
        (status = 404, description = "No such request in this team"),
        (status = 409, description = "The request was already answered"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[post("/{team_id}/join-requests/{request_id}/decline")]
pub async fn decline_join_request(
    state: web::Data<TeamsApiState>,
    path: web::Path<(String, String)>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let (team_id, request_id) = path.into_inner();
    state
        .service
        .decline_join_request(&team_id, &request_id, &user)?;
    Ok(HttpResponse::NoContent().finish())
}

// ── Members ──────────────────────────────────────────────────────────────────

/// List a team's members and their roles.
#[utoipa::path(
    get,
    path = "/api/v1/drive/teams/{teamId}/members",
    params(("teamId" = String, Path, description = "Team id")),
    responses(
        (status = 200, description = "The team's members", body = TeamMemberListResponse),
        (status = 404, description = "No such team, or the caller is not a member of it"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[get("/{team_id}/members")]
pub async fn list_members(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamMemberListResponse>, ApiError> {
    Ok(web::Json(
        state.service.list_members(&path.into_inner(), &user)?,
    ))
}

/// Add someone to a team by email address, in a given role.
#[utoipa::path(
    post,
    path = "/api/v1/drive/teams/{teamId}/members",
    params(("teamId" = String, Path, description = "Team id")),
    request_body = AddMemberRequest,
    responses(
        (status = 200, description = "The new member", body = TeamMemberResponse),
        (status = 400, description = "Unknown role"),
        (status = 403, description = "The caller's role cannot invite, or cannot grant ownership"),
        (status = 404, description = "No account has that email address"),
        (status = 409, description = "That person is already in the team"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[post("/{team_id}/members")]
pub async fn add_member(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    body: web::Json<AddMemberRequest>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamMemberResponse>, ApiError> {
    Ok(web::Json(state.service.add_member(
        &path.into_inner(),
        body.into_inner(),
        &user,
    )?))
}

/// Change a member's role.
#[utoipa::path(
    patch,
    path = "/api/v1/drive/teams/{teamId}/members/{userId}",
    params(
        ("teamId" = String, Path, description = "Team id"),
        ("userId" = String, Path, description = "The member's user id"),
    ),
    request_body = UpdateMemberRequest,
    responses(
        (status = 200, description = "The updated member", body = TeamMemberResponse),
        (status = 403, description = "The caller's role cannot manage permissions"),
        (status = 409, description = "Demoting the team's only owner"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[patch("/{team_id}/members/{user_id}")]
pub async fn update_member(
    state: web::Data<TeamsApiState>,
    path: web::Path<(String, String)>,
    body: web::Json<UpdateMemberRequest>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamMemberResponse>, ApiError> {
    let (team_id, member_id) = path.into_inner();
    Ok(web::Json(state.service.update_member(
        &team_id,
        &member_id,
        body.into_inner(),
        &user,
    )?))
}

/// Remove someone from a team, or leave it yourself.
#[utoipa::path(
    delete,
    path = "/api/v1/drive/teams/{teamId}/members/{userId}",
    params(
        ("teamId" = String, Path, description = "Team id"),
        ("userId" = String, Path, description = "The member's user id"),
    ),
    responses(
        (status = 204, description = "Removed"),
        (status = 403, description = "The caller's role cannot manage permissions"),
        (status = 409, description = "Removing the team's only owner"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[delete("/{team_id}/members/{user_id}")]
pub async fn remove_member(
    state: web::Data<TeamsApiState>,
    path: web::Path<(String, String)>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let (team_id, member_id) = path.into_inner();
    state.service.remove_member(&team_id, &member_id, &user)?;
    Ok(HttpResponse::NoContent().finish())
}

// ── Pages ────────────────────────────────────────────────────────────────────

/// List a team's pages, flat, in sibling order — or search them with `?q=`.
#[utoipa::path(
    get,
    path = "/api/v1/drive/teams/{teamId}/pages",
    params(
        ("teamId" = String, Path, description = "Team id"),
        ("q" = Option<String>, Query, description = "Filter on page title and body"),
    ),
    responses(
        (status = 200, description = "The team's pages", body = TeamPageListResponse),
        (status = 404, description = "No such team, or team pages are not enabled"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[get("/{team_id}/pages")]
pub async fn list_pages(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    query: web::Query<PageListQuery>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamPageListResponse>, ApiError> {
    Ok(web::Json(state.service.list_pages(
        &path.into_inner(),
        query.q.as_deref(),
        &user,
    )?))
}

/// Read one page, with its markdown.
#[utoipa::path(
    get,
    path = "/api/v1/drive/teams/{teamId}/pages/{pageId}",
    params(
        ("teamId" = String, Path, description = "Team id"),
        ("pageId" = String, Path, description = "Page id"),
    ),
    responses(
        (status = 200, description = "The page", body = TeamPageResponse),
        (status = 404, description = "No such page in this team"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[get("/{team_id}/pages/{page_id}")]
pub async fn get_page(
    state: web::Data<TeamsApiState>,
    path: web::Path<(String, String)>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamPageResponse>, ApiError> {
    let (team_id, page_id) = path.into_inner();
    Ok(web::Json(state.service.get_page(&team_id, &page_id, &user)?))
}

/// Create a page, optionally nested under another.
#[utoipa::path(
    post,
    path = "/api/v1/drive/teams/{teamId}/pages",
    params(("teamId" = String, Path, description = "Team id")),
    request_body = CreatePageRequest,
    responses(
        (status = 200, description = "The created page", body = TeamPageResponse),
        (status = 400, description = "Missing title, or a parent page from another team"),
        (status = 403, description = "The caller's role cannot create pages"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[post("/{team_id}/pages")]
pub async fn create_page(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    body: web::Json<CreatePageRequest>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamPageResponse>, ApiError> {
    Ok(web::Json(state.service.create_page(
        &path.into_inner(),
        body.into_inner(),
        &user,
    )?))
}

/// Edit a page: its title, markdown, icon, cover, parent, order or published state.
///
/// A change of body records a version of what the page held before it.
#[utoipa::path(
    patch,
    path = "/api/v1/drive/teams/{teamId}/pages/{pageId}",
    params(
        ("teamId" = String, Path, description = "Team id"),
        ("pageId" = String, Path, description = "Page id"),
    ),
    request_body = UpdatePageRequest,
    responses(
        (status = 200, description = "The updated page", body = TeamPageResponse),
        (status = 400, description = "Empty title, a move that would create a cycle, or nesting Home"),
        (status = 403, description = "The caller's role cannot edit pages"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[patch("/{team_id}/pages/{page_id}")]
pub async fn update_page(
    state: web::Data<TeamsApiState>,
    path: web::Path<(String, String)>,
    body: web::Json<UpdatePageRequest>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamPageResponse>, ApiError> {
    let (team_id, page_id) = path.into_inner();
    Ok(web::Json(state.service.update_page(
        &team_id,
        &page_id,
        body.into_inner(),
        &user,
    )?))
}

/// Delete a page and its subpages. Soft, and refused for the Home page.
#[utoipa::path(
    delete,
    path = "/api/v1/drive/teams/{teamId}/pages/{pageId}",
    params(
        ("teamId" = String, Path, description = "Team id"),
        ("pageId" = String, Path, description = "Page id"),
    ),
    responses(
        (status = 204, description = "Deleted"),
        (status = 400, description = "The Home page cannot be deleted"),
        (status = 403, description = "The caller's role cannot delete pages"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[delete("/{team_id}/pages/{page_id}")]
pub async fn delete_page(
    state: web::Data<TeamsApiState>,
    path: web::Path<(String, String)>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let (team_id, page_id) = path.into_inner();
    state.service.delete_page(&team_id, &page_id, &user)?;
    Ok(HttpResponse::NoContent().finish())
}

/// Copy a page alongside itself.
#[utoipa::path(
    post,
    path = "/api/v1/drive/teams/{teamId}/pages/{pageId}/duplicate",
    params(
        ("teamId" = String, Path, description = "Team id"),
        ("pageId" = String, Path, description = "Page id"),
    ),
    responses(
        (status = 200, description = "The copy", body = TeamPageResponse),
        (status = 403, description = "The caller's role cannot create pages"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[post("/{team_id}/pages/{page_id}/duplicate")]
pub async fn duplicate_page(
    state: web::Data<TeamsApiState>,
    path: web::Path<(String, String)>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamPageResponse>, ApiError> {
    let (team_id, page_id) = path.into_inner();
    Ok(web::Json(
        state.service.duplicate_page(&team_id, &page_id, &user)?,
    ))
}

/// A page's version history, newest first, without the bodies.
#[utoipa::path(
    get,
    path = "/api/v1/drive/teams/{teamId}/pages/{pageId}/versions",
    params(
        ("teamId" = String, Path, description = "Team id"),
        ("pageId" = String, Path, description = "Page id"),
    ),
    responses(
        (status = 200, description = "The page's versions", body = TeamPageVersionListResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[get("/{team_id}/pages/{page_id}/versions")]
pub async fn list_page_versions(
    state: web::Data<TeamsApiState>,
    path: web::Path<(String, String)>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamPageVersionListResponse>, ApiError> {
    let (team_id, page_id) = path.into_inner();
    Ok(web::Json(
        state.service.list_page_versions(&team_id, &page_id, &user)?,
    ))
}

/// One version, with its markdown.
#[utoipa::path(
    get,
    path = "/api/v1/drive/teams/{teamId}/pages/{pageId}/versions/{versionId}",
    params(
        ("teamId" = String, Path, description = "Team id"),
        ("pageId" = String, Path, description = "Page id"),
        ("versionId" = String, Path, description = "Version id"),
    ),
    responses(
        (status = 200, description = "The version", body = TeamPageVersionResponse),
        (status = 404, description = "No such version of this page"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[get("/{team_id}/pages/{page_id}/versions/{version_id}")]
pub async fn get_page_version(
    state: web::Data<TeamsApiState>,
    path: web::Path<(String, String, String)>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamPageVersionResponse>, ApiError> {
    let (team_id, page_id, version_id) = path.into_inner();
    Ok(web::Json(state.service.get_page_version(
        &team_id,
        &page_id,
        &version_id,
        &user,
    )?))
}

/// Put an old version back as the page's content, recording the current one first.
#[utoipa::path(
    post,
    path = "/api/v1/drive/teams/{teamId}/pages/{pageId}/versions/{versionId}/restore",
    params(
        ("teamId" = String, Path, description = "Team id"),
        ("pageId" = String, Path, description = "Page id"),
        ("versionId" = String, Path, description = "Version id"),
    ),
    responses(
        (status = 200, description = "The restored page", body = TeamPageResponse),
        (status = 403, description = "The caller's role cannot edit pages"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[post("/{team_id}/pages/{page_id}/versions/{version_id}/restore")]
pub async fn restore_page_version(
    state: web::Data<TeamsApiState>,
    path: web::Path<(String, String, String)>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamPageResponse>, ApiError> {
    let (team_id, page_id, version_id) = path.into_inner();
    Ok(web::Json(state.service.restore_page_version(
        &team_id,
        &page_id,
        &version_id,
        &user,
    )?))
}

// ── Activity ─────────────────────────────────────────────────────────────────

/// The team's recent activity, newest first.
///
/// Behind `teamSpaces` like every other team route. The entries were written on each team write
/// since the flag went on, so the feed has a history from the first team created rather than from
/// whenever someone first looked at it.
#[utoipa::path(
    get,
    path = "/api/v1/drive/teams/{teamId}/activity",
    params(("teamId" = String, Path, description = "Team id")),
    responses(
        (status = 200, description = "Recent activity in this team", body = TeamActivityResponse),
        (status = 404, description = "No such team, or the activity feed is not enabled"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[get("/{team_id}/activity")]
pub async fn list_activity(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamActivityResponse>, ApiError> {
    Ok(web::Json(
        state.service.list_activity(&path.into_inner(), &user)?,
    ))
}

// ── File library ─────────────────────────────────────────────────────────────

/// List one level of a team's file library.
#[utoipa::path(
    get,
    path = "/api/v1/drive/teams/{teamId}/library",
    params(
        ("teamId" = String, Path, description = "Team id"),
        ("folderId" = Option<String>, Query, description = "The folder to list; absent lists the team root"),
    ),
    responses(
        (status = 200, description = "Folders and files at this level", body = TeamLibraryResponse),
        (status = 404, description = "No such team, or the team file library is not enabled"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[get("/{team_id}/library")]
pub async fn list_library(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    query: web::Query<LibraryQuery>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamLibraryResponse>, ApiError> {
    Ok(web::Json(state.service.list_library(
        &path.into_inner(),
        query.folder_id.as_deref(),
        &user,
    )?))
}

/// Create a folder in a team's library.
#[utoipa::path(
    post,
    path = "/api/v1/drive/teams/{teamId}/library/folders",
    params(("teamId" = String, Path, description = "Team id")),
    request_body = CreateTeamFolderRequest,
    responses(
        (status = 200, description = "The created folder", body = TeamFolderResponse),
        (status = 403, description = "The caller's role cannot add to this team's library"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[post("/{team_id}/library/folders")]
pub async fn create_library_folder(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    body: web::Json<CreateTeamFolderRequest>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamFolderResponse>, ApiError> {
    Ok(web::Json(state.service.create_library_folder(
        &path.into_inner(),
        body.into_inner(),
        &user,
    )?))
}

/// Move a file the caller has just uploaded into the team's library.
///
/// The upload itself is the ordinary `POST /api/v1/drive/files/upload`; this is its second step,
/// which is what keeps team files inside the existing encryption, versioning and trash.
#[utoipa::path(
    post,
    path = "/api/v1/drive/teams/{teamId}/library/files",
    params(("teamId" = String, Path, description = "Team id")),
    request_body = ClaimFileRequest,
    responses(
        (status = 200, description = "The file, now in the team", body = TeamFileResponse),
        (status = 403, description = "The caller's role cannot add to this team's library"),
        (status = 404, description = "No file of the caller's with that id is available to move"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[post("/{team_id}/library/files")]
pub async fn claim_library_file(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    body: web::Json<ClaimFileRequest>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamFileResponse>, ApiError> {
    Ok(web::Json(state.service.claim_file(
        &path.into_inner(),
        body.into_inner(),
        &user,
    )?))
}

/// Rename a file in a team's library.
#[utoipa::path(
    patch,
    path = "/api/v1/drive/teams/{teamId}/library/files/{fileId}",
    params(
        ("teamId" = String, Path, description = "Team id"),
        ("fileId" = String, Path, description = "File id"),
    ),
    request_body = RenameTeamFileRequest,
    responses(
        (status = 200, description = "The renamed file", body = TeamFileResponse),
        (status = 403, description = "The caller's role cannot change this team's library"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[patch("/{team_id}/library/files/{file_id}")]
pub async fn rename_library_file(
    state: web::Data<TeamsApiState>,
    path: web::Path<(String, String)>,
    body: web::Json<RenameTeamFileRequest>,
    user: AuthenticatedUser,
) -> Result<web::Json<TeamFileResponse>, ApiError> {
    let (team_id, file_id) = path.into_inner();
    Ok(web::Json(state.service.rename_library_file(
        &team_id,
        &file_id,
        body.into_inner(),
        &user,
    )?))
}

/// Move a team file to the trash.
#[utoipa::path(
    delete,
    path = "/api/v1/drive/teams/{teamId}/library/files/{fileId}",
    params(
        ("teamId" = String, Path, description = "Team id"),
        ("fileId" = String, Path, description = "File id"),
    ),
    responses(
        (status = 204, description = "Trashed"),
        (status = 403, description = "The caller's role cannot delete from this team's library"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams"
)]
#[delete("/{team_id}/library/files/{file_id}")]
pub async fn trash_library_file(
    state: web::Data<TeamsApiState>,
    path: web::Path<(String, String)>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let (team_id, file_id) = path.into_inner();
    state.service.trash_library_file(&team_id, &file_id, &user)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/teams")
            // The more specific paths are registered first: actix matches in registration order,
            // and `/{team_id}` would otherwise swallow `/{team_id}/pages` for a GET.
            //
            // `/discoverable` is the sharpest case — it is a literal single segment competing with
            // `/{team_id}`, so registered after `get_team` it would be read as a team whose id is
            // the word "discoverable" and answer 404 forever.
            .service(list_discoverable)
            .service(approve_join_request)
            .service(decline_join_request)
            .service(list_join_requests)
            .service(request_access)
            .service(join_team)
            .service(list_page_versions)
            .service(get_page_version)
            .service(restore_page_version)
            .service(duplicate_page)
            .service(list_pages)
            .service(create_page)
            .service(get_page)
            .service(update_page)
            .service(delete_page)
            .service(list_members)
            .service(add_member)
            .service(update_member)
            .service(remove_member)
            .service(list_activity)
            .service(list_library)
            .service(create_library_folder)
            .service(claim_library_file)
            .service(rename_library_file)
            .service(trash_library_file)
            .service(list_teams)
            .service(create_team)
            .service(get_team)
            .service(update_team)
            .service(delete_team),
    );
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(
        list_teams,
        create_team,
        get_team,
        update_team,
        delete_team,
        list_discoverable,
        join_team,
        request_access,
        list_join_requests,
        approve_join_request,
        decline_join_request,
        list_members,
        add_member,
        update_member,
        remove_member,
        list_pages,
        get_page,
        create_page,
        update_page,
        delete_page,
        duplicate_page,
        list_page_versions,
        get_page_version,
        restore_page_version,
        list_activity,
        list_library,
        create_library_folder,
        claim_library_file,
        rename_library_file,
        trash_library_file,
    ),
    components(schemas(
        TeamResponse,
        TeamListResponse,
        CreateTeamRequest,
        UpdateTeamRequest,
        DiscoverableTeamResponse,
        DiscoverableTeamListResponse,
        RequestAccessRequest,
        JoinRequestResponse,
        JoinRequestListResponse,
        ApproveJoinRequestRequest,
        TeamMemberResponse,
        TeamMemberListResponse,
        AddMemberRequest,
        UpdateMemberRequest,
        TeamPageResponse,
        TeamPageListResponse,
        CreatePageRequest,
        UpdatePageRequest,
        TeamPageVersionResponse,
        TeamPageVersionListResponse,
        TeamActivityEntry,
        TeamActivityResponse,
        TeamFileResponse,
        TeamFolderResponse,
        TeamLibraryResponse,
        CreateTeamFolderRequest,
        ClaimFileRequest,
        RenameTeamFileRequest,
    )),
    tags((
        name = "drive-teams",
        description = "Team Spaces: a Team owns its members, its wiki pages, its file library, its activity and its storage. Membership decides access to everything beneath a team, and a private team a caller has no role in answers 404 rather than 403 — whether it exists is itself something membership decides. `visibility` is the one exception and the only thing that relaxes it: an `organization` team is discoverable by any signed-in user and joined by adding yourself, and an `invite_only` team is discoverable and joined by asking. Discovery is confined to GET /teams/discoverable, which returns a summary rather than the members' view — every other route still requires membership. Every route here is behind the `teamSpaces` feature flag and answers 404 when it is off."
    )),
    security(("bearer_auth" = []))
)]
pub struct TeamsApiDoc;

/// Route registration, which is not exercised by the service tests.
///
/// `configure` registers by hand in an order that matters: actix matches in registration order, so
/// a literal segment has to come before the `/{team_id}` pattern that would otherwise capture it.
/// Nothing about the service can catch that being wrong — the handler would simply never be
/// reached — and from the e2e suite, with the flag off, both the right and the wrong handler answer
/// 404 with the same body. So it is pinned here, with the flag on.
#[cfg(test)]
mod routing {
    use super::*;
    use actix_web::{test, App};
    use diesel::prelude::*;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel_migrations::MigrationHarness;

    use crate::drive::activity::{repository::ActivityRepository, service::ActivityService};
    use crate::drive::feature_flags::gate::FeatureGate;
    use crate::drive::feature_flags::repository::FeatureFlagsRepository;
    use crate::drive::teams::repository::{DbPool, TeamsRepository};
    use crate::drive::teams::service::{TeamsService, FLAG_TEAM_SPACES};
    use crate::schema::feature_flags;
    use crate::shared::TokenService;

    /// A stack with the real routes and `teamSpaces` on.
    fn app_state() -> (web::Data<TeamsApiState>, web::Data<Arc<TokenService>>) {
        let manager = ConnectionManager::<diesel::SqliteConnection>::new(":memory:");
        let pool: DbPool = Pool::builder().max_size(1).build(manager).expect("pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(crate::MIGRATIONS)
            .expect("migrations");
        diesel::update(feature_flags::table.filter(feature_flags::key.eq(FLAG_TEAM_SPACES)))
            .set(feature_flags::enabled.eq(1))
            .execute(&mut pool.get().expect("conn"))
            .expect("enable flag");

        let service = TeamsService::new(
            Arc::new(TeamsRepository::new(pool.clone())),
            Arc::new(ActivityService::new(Arc::new(ActivityRepository::new(
                pool.clone(),
            )))),
            FeatureGate::new(Arc::new(FeatureFlagsRepository::new(pool.clone()))),
        );

        (
            web::Data::new(TeamsApiState {
                service: Arc::new(service),
            }),
            web::Data::new(Arc::new(TokenService::new("test-secret-for-tests".into()))),
        )
    }

    fn bearer(ts: &TokenService) -> String {
        format!(
            "Bearer {}",
            ts.generate_access_token("u1", "u1@example.com")
                .expect("token")
        )
    }

    /// The hazard: registered after `get_team`, this URL is read as a team whose id is the word
    /// "discoverable" and answers 404 for ever. A 200 here means it reached its own handler.
    #[actix_web::test]
    async fn the_discovery_route_is_not_swallowed_by_the_team_id_route() {
        let (state, ts) = app_state();
        let token = bearer(&ts);
        let app = test::init_service(
            App::new()
                .app_data(state)
                .app_data(ts.clone())
                .configure(configure),
        )
        .await;

        let req = test::TestRequest::get()
            .uri("/teams/discoverable")
            .insert_header(("Authorization", token))
            .to_request();
        let resp = test::call_service(&app, req).await;

        assert_eq!(
            resp.status(),
            200,
            "a 404 here means /teams/discoverable was matched by /teams/{{team_id}}"
        );
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert!(
            body.get("teams").is_some(),
            "reached the discovery handler, not get_team: {body}"
        );
    }

    /// The mirror of the above: an ordinary team id still reaches `get_team`, so putting the
    /// literal first has not shadowed the pattern.
    #[actix_web::test]
    async fn an_ordinary_team_id_still_reaches_get_team() {
        let (state, ts) = app_state();
        let token = bearer(&ts);
        let app = test::init_service(
            App::new()
                .app_data(state)
                .app_data(ts.clone())
                .configure(configure),
        )
        .await;

        let req = test::TestRequest::get()
            .uri("/teams/some-team-id")
            .insert_header(("Authorization", token))
            .to_request();
        let resp = test::call_service(&app, req).await;

        // 404 because no such team exists for this caller — but from `get_team`, which is what the
        // API error shape shows. An unrouted path would carry an empty body.
        assert_eq!(resp.status(), 404);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["error"]["message"], "Team not found");
    }

    /// The join-request routes nest three deep under the same `{team_id}`, so they carry the same
    /// hazard among themselves: `/join-requests/{id}/approve` must not be matched by
    /// `/join-requests`.
    #[actix_web::test]
    async fn the_join_request_routes_do_not_shadow_each_other() {
        let (state, ts) = app_state();
        let token = bearer(&ts);
        let app = test::init_service(
            App::new()
                .app_data(state)
                .app_data(ts.clone())
                .configure(configure),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/teams/t1/join-requests/r1/approve")
            .insert_header(("Authorization", token))
            .set_json(serde_json::json!({}))
            .to_request();
        let resp = test::call_service(&app, req).await;

        // 404 from the handler (no such team for this caller), not 405 from a route that only
        // accepts the collection path.
        assert_eq!(resp.status(), 404);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["error"]["message"], "Team not found");
    }
}
