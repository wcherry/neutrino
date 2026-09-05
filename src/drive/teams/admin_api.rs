//! The administrator's view of teams (issue #185, phase 1's "storage quotas").
//!
//! Separate from `teams::api` because the two answer to different authorities and it should not be
//! possible to reach one from the other by accident. Everything in `teams::api` resolves the
//! caller's membership and 404s without it; everything here takes `AdminUser` and no membership at
//! all. A route that drifted between the files would change who may call it, silently.
//!
//! What that authority buys is deliberately narrow: **the outside of a team**. Its name, how full
//! it is, how many members it has, and the one thing an administrator can change — the disk quota.
//! Not its pages, not its files, not its activity. Being a deployment's administrator is authority
//! over the deployment, not membership of every team on it, and a team's wiki is exactly the sort
//! of content where the difference matters.
//!
//! Behind `teamSpaces`, like the rest of the module. With the flag off no team can exist, so this
//! is a console page about nothing — and a 404 keeps the rule that a gated feature is invisible
//! rather than merely refused.

use actix_web::{delete, get, patch, web, HttpResponse};

use super::api::TeamsApiState;
use super::dto::*;
use crate::shared::{AdminUser, ApiError};

/// Every live team, fullest first, with a live storage figure for each.
///
/// Ordered by occupancy rather than by name because of what the page is for: "which team is about
/// to run out?" is the question, and an alphabetical list makes it a search rather than a glance.
#[utoipa::path(
    get,
    path = "/api/v1/admin/teams",
    params(
        ("q" = Option<String>, Query, description = "Filter on team name and slug"),
        ("limit" = Option<i64>, Query, description = "Page size, clamped to 1..=200 (default 50)"),
        ("offset" = Option<i64>, Query, description = "Rows to skip"),
    ),
    responses(
        (status = 200, description = "Teams with their storage", body = AdminTeamListResponse),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
        (status = 404, description = "Team Spaces is not enabled on this deployment"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams-admin"
)]
#[get("/teams")]
pub async fn list_teams(
    state: web::Data<TeamsApiState>,
    query: web::Query<AdminTeamListQuery>,
    _admin: AdminUser,
) -> Result<web::Json<AdminTeamListResponse>, ApiError> {
    let q = query.into_inner();
    Ok(web::Json(state.service.admin_list_teams(
        q.q.as_deref(),
        q.limit.unwrap_or(50),
        q.offset.unwrap_or(0),
    )?))
}

/// Set or clear a team's disk quota.
///
/// `storageLimitBytes: null` is unlimited. Lowering a limit below what the team already stores is
/// allowed and deletes nothing: the team keeps its files and is refused the next one.
///
/// There is no member-facing counterpart. A team's own Owner cannot raise its quota — a limit a
/// team can lift is not a limit — so `UpdateTeamRequest` carries no such field and this is the only
/// route that writes the column.
#[utoipa::path(
    patch,
    path = "/api/v1/admin/teams/{teamId}/quota",
    params(("teamId" = String, Path, description = "Team id")),
    request_body = SetTeamQuotaRequest,
    responses(
        (status = 200, description = "The team, with its new quota", body = AdminTeamResponse),
        (status = 400, description = "A negative limit"),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
        (status = 404, description = "No such team, or Team Spaces is not enabled"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams-admin"
)]
#[patch("/teams/{team_id}/quota")]
pub async fn set_team_quota(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    body: web::Json<SetTeamQuotaRequest>,
    admin: AdminUser,
) -> Result<web::Json<AdminTeamResponse>, ApiError> {
    Ok(web::Json(state.service.admin_set_team_quota(
        &path.into_inner(),
        body.into_inner(),
        &admin.user_id,
    )?))
}

/// Hand a team to somebody, taking it off whoever holds it now.
///
/// A transfer: the named account becomes the team's Owner and every existing Owner is demoted to
/// Admin — recoverable, since they keep everything but deleting the team and handing it on. The
/// new Owner is added as a member if they are not one, which is the point when the previous one has
/// left. Works on an archived team, and on a team with no Owner at all, which is the case the
/// member-facing routes cannot serve.
#[utoipa::path(
    patch,
    path = "/api/v1/admin/teams/{teamId}/owner",
    params(("teamId" = String, Path, description = "Team id")),
    request_body = SetTeamOwnerRequest,
    responses(
        (status = 200, description = "The team, with its new owner", body = AdminTeamResponse),
        (status = 400, description = "Missing email address"),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
        (status = 404, description = "No such team, no account with that email, or Team Spaces is not enabled"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams-admin"
)]
#[patch("/teams/{team_id}/owner")]
pub async fn set_team_owner(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    body: web::Json<SetTeamOwnerRequest>,
    admin: AdminUser,
) -> Result<web::Json<AdminTeamResponse>, ApiError> {
    Ok(web::Json(state.service.admin_set_team_owner(
        &path.into_inner(),
        body.into_inner(),
        &admin.user_id,
    )?))
}

/// Archive a team, or restore it.
///
/// Authoritative rather than a toggle — the caller sends the state it wants — so a repeated request
/// is idempotent and two administrators on the same screen cannot each undo the other.
#[utoipa::path(
    patch,
    path = "/api/v1/admin/teams/{teamId}/archived",
    params(("teamId" = String, Path, description = "Team id")),
    request_body = SetTeamArchivedRequest,
    responses(
        (status = 200, description = "The team, in its new state", body = AdminTeamResponse),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
        (status = 404, description = "No such team, or Team Spaces is not enabled"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams-admin"
)]
#[patch("/teams/{team_id}/archived")]
pub async fn set_team_archived(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    body: web::Json<SetTeamArchivedRequest>,
    admin: AdminUser,
) -> Result<web::Json<AdminTeamResponse>, ApiError> {
    Ok(web::Json(state.service.admin_set_team_archived(
        &path.into_inner(),
        body.into_inner(),
        &admin.user_id,
    )?))
}

/// Delete a team.
///
/// Soft, exactly as the Owner's own delete is: the row is marked and the pages and files that
/// cascade off it survive, so a deletion made in error is recoverable from the database. Nothing in
/// the console lists deleted teams, which is deliberate — an undo button would make this a routine
/// action.
#[utoipa::path(
    delete,
    path = "/api/v1/admin/teams/{teamId}",
    params(("teamId" = String, Path, description = "Team id")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
        (status = 404, description = "No such team, or Team Spaces is not enabled"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-teams-admin"
)]
#[delete("/teams/{team_id}")]
pub async fn delete_team(
    state: web::Data<TeamsApiState>,
    path: web::Path<String>,
    admin: AdminUser,
) -> Result<HttpResponse, ApiError> {
    state
        .service
        .admin_delete_team(&path.into_inner(), &admin.user_id)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure_admin(cfg: &mut web::ServiceConfig) {
    // `/teams/{id}/quota` before `/teams`, for the reason `teams::api::configure` spells out:
    // actix matches in registration order. These two cannot shadow each other — one is a literal
    // three-segment path and the other a single segment — but the ordering convention is worth
    // keeping so the next route added here inherits it.
    cfg.service(set_team_quota)
        .service(set_team_owner)
        .service(set_team_archived)
        .service(delete_team)
        .service(list_teams);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(list_teams, set_team_quota, set_team_owner, set_team_archived, delete_team),
    components(schemas(
        AdminTeamResponse,
        AdminTeamOwner,
        AdminTeamListResponse,
        SetTeamQuotaRequest,
        SetTeamOwnerRequest,
        SetTeamArchivedRequest,
    )),
    tags((
        name = "drive-teams-admin",
        description = "The administrator's view of Team Spaces: every team's name, size, owners and membership count, and the four things an administrator can change about a team without being in it — its disk quota, its owner, whether it is archived, and whether it exists. Deliberately the outside of a team only: its pages, files and activity stay behind membership even here. The routes exist for the case the member-facing ones cannot serve, a team whose Owners have all gone, which is why the transfer works on a team with no Owner at all. Every change is written into the team's own activity feed, where its members can see it. Behind the `teamSpaces` feature flag, and 404 when it is off."
    )),
    security(("bearer_auth" = []))
)]
pub struct TeamsAdminApiDoc;

/// Route registration and the admin gate, neither of which the service tests reach.
///
/// The check that matters here is the one the service cannot make: that these routes are behind
/// `AdminUser` rather than `AuthenticatedUser`. A service test proves what
/// `admin_set_team_quota` does once it is called; only the wired stack proves who may call it.
#[cfg(test)]
mod routing {
    use super::*;
    use actix_web::{test, App};
    use diesel::prelude::*;
    use std::sync::Arc;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel_migrations::MigrationHarness;

    use crate::drive::activity::{repository::ActivityRepository, service::ActivityService};
    use crate::drive::feature_flags::gate::FeatureGate;
    use crate::drive::feature_flags::repository::FeatureFlagsRepository;
    use crate::drive::teams::repository::{DbPool, TeamsRepository};
    use crate::drive::teams::service::{TeamsService, FLAG_TEAM_SPACES};
    use crate::schema::feature_flags;
    use crate::shared::TokenService;

    fn app_state(flag_on: bool) -> (web::Data<TeamsApiState>, web::Data<Arc<TokenService>>) {
        let manager = ConnectionManager::<diesel::SqliteConnection>::new(":memory:");
        let pool: DbPool = Pool::builder().max_size(1).build(manager).expect("pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(crate::MIGRATIONS)
            .expect("migrations");
        if flag_on {
            diesel::update(feature_flags::table.filter(feature_flags::key.eq(FLAG_TEAM_SPACES)))
                .set(feature_flags::enabled.eq(1))
                .execute(&mut pool.get().expect("conn"))
                .expect("enable flag");
        }

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

    async fn get_teams(flag_on: bool, admin: bool) -> u16 {
        let (state, ts) = app_state(flag_on);
        let token = ts
            .generate_access_token_with_admin(
                if admin { "a1" } else { "u1" },
                "someone@example.com",
                admin,
            )
            .expect("token");
        let app = test::init_service(
            App::new()
                .app_data(state)
                .app_data(ts.clone())
                .configure(configure_admin),
        )
        .await;

        let req = test::TestRequest::get()
            .uri("/teams")
            .insert_header(("Authorization", format!("Bearer {token}")))
            .to_request();
        test::call_service(&app, req).await.status().as_u16()
    }

    #[actix_web::test]
    async fn an_admin_reaches_the_team_list() {
        assert_eq!(get_teams(true, true).await, 200);
    }

    /// The point of the file. An ordinary signed-in user gets 403 — not a list of every team on the
    /// deployment, which is what `AuthenticatedUser` here would have handed them.
    #[actix_web::test]
    async fn an_ordinary_user_is_refused() {
        assert_eq!(get_teams(true, false).await, 403);
    }

    /// 403 for a non-admin, but 404 for everyone once the flag is off: the gate is checked inside
    /// the service, so being an administrator does not make a disabled feature visible.
    #[actix_web::test]
    async fn the_flag_hides_the_list_from_an_admin_too() {
        assert_eq!(get_teams(false, true).await, 404);
    }

    /// Each sub-route reaches its own handler rather than being swallowed by the collection path,
    /// and answers from the service (404 for an unknown team) rather than 405 from the router.
    ///
    /// The three PATCHes differ only in their last segment, which is the shape that goes wrong
    /// quietly: a misregistration would leave "archive" running the quota handler with an unparsed
    /// body, and both answer 404 for a team that does not exist. The message is what tells them
    /// apart from a route that was never reached at all — an unrouted path carries an empty body.
    #[actix_web::test]
    async fn every_admin_sub_route_reaches_its_own_handler() {
        let (state, ts) = app_state(true);
        let token = ts
            .generate_access_token_with_admin("a1", "admin@example.com", true)
            .expect("token");
        let app = test::init_service(
            App::new()
                .app_data(state)
                .app_data(ts.clone())
                .configure(configure_admin),
        )
        .await;

        let cases: [(&str, serde_json::Value); 3] = [
            ("quota", serde_json::json!({ "storageLimitBytes": 1024 })),
            ("owner", serde_json::json!({ "email": "someone@example.com" })),
            ("archived", serde_json::json!({ "archived": true })),
        ];

        for (segment, body) in cases {
            let req = test::TestRequest::patch()
                .uri(&format!("/teams/no-such-team/{segment}"))
                .insert_header(("Authorization", format!("Bearer {token}")))
                .set_json(body)
                .to_request();
            let resp = test::call_service(&app, req).await;

            assert_eq!(resp.status(), 404, "/{segment} should reach its handler");
            let answer: serde_json::Value = test::read_body_json(resp).await;
            assert_eq!(
                answer["error"]["message"], "Team not found",
                "/{segment} answered from somewhere other than its handler"
            );
        }

        // And the bare path is the delete, not a fourth PATCH target.
        let req = test::TestRequest::delete()
            .uri("/teams/no-such-team")
            .insert_header(("Authorization", format!("Bearer {token}")))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 404);
        let answer: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(answer["error"]["message"], "Team not found");
    }

    /// Every write is admin-only, not just the list. Each of these would hand an ordinary signed-in
    /// user a team that is not theirs — or take one away — if the extractor were wrong.
    #[actix_web::test]
    async fn an_ordinary_user_is_refused_every_write() {
        let (state, ts) = app_state(true);
        let token = ts
            .generate_access_token_with_admin("u1", "user@example.com", false)
            .expect("token");
        let app = test::init_service(
            App::new()
                .app_data(state)
                .app_data(ts.clone())
                .configure(configure_admin),
        )
        .await;

        for (segment, body) in [
            ("quota", serde_json::json!({ "storageLimitBytes": 1 })),
            ("owner", serde_json::json!({ "email": "me@example.com" })),
            ("archived", serde_json::json!({ "archived": true })),
        ] {
            let req = test::TestRequest::patch()
                .uri(&format!("/teams/t1/{segment}"))
                .insert_header(("Authorization", format!("Bearer {token}")))
                .set_json(body)
                .to_request();
            assert_eq!(
                test::call_service(&app, req).await.status(),
                403,
                "/{segment} must be admin-only"
            );
        }

        let req = test::TestRequest::delete()
            .uri("/teams/t1")
            .insert_header(("Authorization", format!("Bearer {token}")))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 403);
    }
}
