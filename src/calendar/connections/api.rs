use crate::shared::{ApiError, AuthenticatedUser};
use crate::calendar::connections::dto::{
    CompleteGoogleRequest, ConnectAppleRequest, ConnectionResponse, ListConnectionsResponse,
    OAuthInitResponse, TriggerSyncRequest, TriggerSyncResponse,
};
use crate::calendar::connections::service::ConnectionsService;
use actix_web::{delete, get, post, web, HttpResponse};
use actix_web::http::header;
use std::sync::Arc;
use utoipa::OpenApi;

pub struct ConnectionsApiState {
    pub connections_service: Arc<ConnectionsService>,
}

// ── List ──────────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/api/v1/connections",
    responses(
        (status = 200, description = "List of connected calendar providers", body = ListConnectionsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "connections"
)]
#[get("/connections")]
pub async fn list_connections(
    state: web::Data<ConnectionsApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListConnectionsResponse>, ApiError> {
    let result = state.connections_service.list_connections(&user)?;
    Ok(web::Json(result))
}

// ── Google ────────────────────────────────────────────────────────────────────

#[utoipa::path(
    post,
    path = "/api/v1/connections/google",
    responses(
        (status = 200, description = "OAuth2 authorization URL to redirect the user to", body = OAuthInitResponse),
        (status = 400, description = "Google OAuth not configured"),
    ),
    security(("bearer_auth" = [])),
    tag = "connections"
)]
#[post("/connections/google")]
pub async fn initiate_google(
    state: web::Data<ConnectionsApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<OAuthInitResponse>, ApiError> {
    let result = state.connections_service.initiate_google(&user.user_id)?;
    Ok(web::Json(result))
}

#[derive(serde::Deserialize)]
pub struct OAuthCallbackQuery {
    pub code: String,
    pub state: Option<String>,
    pub error: Option<String>,
}

#[utoipa::path(
    get,
    path = "/api/v1/connections/google/callback",
    params(
        ("code" = String, Query, description = "Authorization code from Google"),
        ("state" = Option<String>, Query, description = "State parameter"),
    ),
    responses(
        (status = 302, description = "Redirect to /calendar/settings on success"),
        (status = 400, description = "OAuth error"),
    ),
    tag = "connections"
)]
#[get("/connections/google/callback")]
pub async fn google_callback(
    state: web::Data<ConnectionsApiState>,
    query: web::Query<OAuthCallbackQuery>,
) -> Result<HttpResponse, ApiError> {
    if let Some(err) = &query.error {
        return Err(ApiError::bad_request(&format!("Google OAuth error: {}", err)));
    }
    let oauth_state = query.state.as_deref().unwrap_or("");
    let user_id = oauth_state
        .split(':')
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::bad_request("Invalid OAuth state"))?;
    let user = AuthenticatedUser {
        user_id: user_id.to_string(),
        email: String::new(),
        token: String::new(),
        is_admin: false,
    };
    state
        .connections_service
        .connect_google(&user, &query.code)
        .await?;
    Ok(HttpResponse::Found()
        .insert_header((header::LOCATION, "/calendar/settings"))
        .finish())
}

/// Authenticated endpoint: the frontend POSTs the authorization code it captured
/// from the OAuth redirect URL.  This avoids requiring a Bearer token on the
/// raw redirect URI that Google calls (where the browser has no JWT header).
#[utoipa::path(
    post,
    path = "/api/v1/connections/google/complete",
    request_body = CompleteGoogleRequest,
    responses(
        (status = 200, description = "Google Calendar connection established", body = ConnectionResponse),
        (status = 400, description = "OAuth code exchange failed"),
    ),
    security(("bearer_auth" = [])),
    tag = "connections"
)]
#[post("/connections/google/complete")]
pub async fn complete_google(
    state: web::Data<ConnectionsApiState>,
    user: AuthenticatedUser,
    body: web::Json<CompleteGoogleRequest>,
) -> Result<web::Json<ConnectionResponse>, ApiError> {
    let conn = state
        .connections_service
        .connect_google(&user, &body.code)
        .await?;
    Ok(web::Json(conn))
}

// ── Outlook ───────────────────────────────────────────────────────────────────

#[utoipa::path(
    post,
    path = "/api/v1/connections/outlook",
    responses(
        (status = 200, description = "OAuth2 authorization URL to redirect the user to", body = OAuthInitResponse),
        (status = 400, description = "Outlook OAuth not configured"),
    ),
    security(("bearer_auth" = [])),
    tag = "connections"
)]
#[post("/connections/outlook")]
pub async fn initiate_outlook(
    state: web::Data<ConnectionsApiState>,
    _user: AuthenticatedUser,
) -> Result<web::Json<OAuthInitResponse>, ApiError> {
    let result = state.connections_service.initiate_outlook()?;
    Ok(web::Json(result))
}

#[utoipa::path(
    get,
    path = "/api/v1/connections/outlook/callback",
    params(
        ("code" = String, Query, description = "Authorization code from Microsoft"),
        ("state" = Option<String>, Query, description = "State parameter"),
    ),
    responses(
        (status = 200, description = "Connection established", body = ConnectionResponse),
        (status = 400, description = "OAuth error"),
    ),
    security(("bearer_auth" = [])),
    tag = "connections"
)]
#[get("/connections/outlook/callback")]
pub async fn outlook_callback(
    state: web::Data<ConnectionsApiState>,
    user: AuthenticatedUser,
    query: web::Query<OAuthCallbackQuery>,
) -> Result<web::Json<ConnectionResponse>, ApiError> {
    if let Some(err) = &query.error {
        return Err(ApiError::bad_request(&format!("Outlook OAuth error: {}", err)));
    }
    let conn = state
        .connections_service
        .connect_outlook(&user, &query.code)
        .await?;
    Ok(web::Json(conn))
}

// ── Apple ─────────────────────────────────────────────────────────────────────

#[utoipa::path(
    post,
    path = "/api/v1/connections/apple",
    request_body = ConnectAppleRequest,
    responses(
        (status = 200, description = "Apple CalDAV connection established", body = ConnectionResponse),
        (status = 400, description = "Invalid credentials or CalDAV URL"),
    ),
    security(("bearer_auth" = [])),
    tag = "connections"
)]
#[post("/connections/apple")]
pub async fn connect_apple(
    state: web::Data<ConnectionsApiState>,
    user: AuthenticatedUser,
    body: web::Json<ConnectAppleRequest>,
) -> Result<web::Json<ConnectionResponse>, ApiError> {
    let conn = state
        .connections_service
        .connect_apple(&user, body.into_inner())
        .await?;
    Ok(web::Json(conn))
}

// ── Disconnect ────────────────────────────────────────────────────────────────

#[utoipa::path(
    delete,
    path = "/api/v1/connections/{id}",
    params(("id" = String, Path, description = "Connection ID")),
    responses(
        (status = 204, description = "Connection removed"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "connections"
)]
#[delete("/connections/{id}")]
pub async fn disconnect_connection(
    state: web::Data<ConnectionsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state
        .connections_service
        .disconnect(&user, &path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

// ── Sync trigger ──────────────────────────────────────────────────────────────

#[utoipa::path(
    post,
    path = "/api/v1/sync/trigger",
    request_body = TriggerSyncRequest,
    responses(
        (status = 200, description = "Sync complete", body = TriggerSyncResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "connections"
)]
#[post("/sync/trigger")]
pub async fn trigger_sync(
    state: web::Data<ConnectionsApiState>,
    user: AuthenticatedUser,
    body: web::Json<TriggerSyncRequest>,
) -> Result<web::Json<TriggerSyncResponse>, ApiError> {
    let events_synced = state
        .connections_service
        .trigger_sync(&user, body.into_inner())
        .await?;
    Ok(web::Json(TriggerSyncResponse { events_synced }))
}

// ── Router ────────────────────────────────────────────────────────────────────

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_connections)
        .service(initiate_google)
        .service(google_callback)
        .service(complete_google)
        .service(initiate_outlook)
        .service(outlook_callback)
        .service(connect_apple)
        .service(disconnect_connection)
        .service(trigger_sync);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        list_connections,
        initiate_google,
        google_callback,
        complete_google,
        initiate_outlook,
        outlook_callback,
        connect_apple,
        disconnect_connection,
        trigger_sync,
    ),
    components(schemas(
        CompleteGoogleRequest,
        ConnectAppleRequest,
        ConnectionResponse,
        ListConnectionsResponse,
        OAuthInitResponse,
        TriggerSyncRequest,
        TriggerSyncResponse,
    )),
    tags((name = "connections", description = "External calendar provider connections")),
    security(("bearer_auth" = []))
)]
pub struct ConnectionsApiDoc;

