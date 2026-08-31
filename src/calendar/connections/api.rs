use crate::calendar::connections::dto::{
    CompleteGoogleRequest, ConnectAppleRequest, ConnectionResponse, ListConnectionsResponse,
    OAuthInitResponse, TriggerSyncRequest, TriggerSyncResponse,
};
use crate::calendar::connections::service::ConnectionsService;
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::http::header;
use actix_web::{delete, get, post, web, HttpRequest, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct ConnectionsApiState {
    pub connections_service: Arc<ConnectionsService>,
}

/// The public origin this request arrived on, used to build an OAuth redirect
/// URI that points at wherever the deployment is actually served from rather
/// than at the container's own `localhost` (issue #158).
///
/// `Origin` for the two XHR steps — the browser sends it on every POST — and the
/// forwarded host for the redirect endpoints, which are top-level navigations
/// from the provider and so carry no `Origin` at all. Deliberately not `Referer`
/// there: it would be `accounts.google.com`, not us.
fn request_origin(req: &HttpRequest) -> Option<String> {
    if let Some(origin) = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .filter(|v| *v != "null" && !v.is_empty())
    {
        return Some(origin.to_string());
    }

    let info = req.connection_info();
    let host = info.host();
    if host.is_empty() {
        return None;
    }
    Some(format!("{}://{}", info.scheme(), host))
}

// ── List ──────────────────────────────────────────────────────────────────────

/// List the caller's connected external calendars.
///
/// Returns one entry per linked Google, Outlook or Apple CalDAV account, including its last
/// sync time and status.
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

/// Start the Google Calendar OAuth flow.
///
/// Returns the Google authorization URL the browser should be sent to; the resulting code
/// is handed back to `/connections/google/complete`.
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
    req: HttpRequest,
    state: web::Data<ConnectionsApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<OAuthInitResponse>, ApiError> {
    let result = state
        .connections_service
        .initiate_google(&user.user_id, request_origin(&req).as_deref())?;
    Ok(web::Json(result))
}

#[derive(serde::Deserialize)]
pub struct OAuthCallbackQuery {
    pub code: String,
    pub state: Option<String>,
    pub error: Option<String>,
}

/// Handle the redirect Google sends back after the user grants access.
///
/// Unauthenticated, because the browser arrives here without a Bearer token: the caller is
/// identified from the `state` parameter minted by `POST /connections/google`. On success it
/// stores the connection and 302s to `/calendar/settings`.
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
    req: HttpRequest,
    state: web::Data<ConnectionsApiState>,
    query: web::Query<OAuthCallbackQuery>,
) -> Result<HttpResponse, ApiError> {
    if let Some(err) = &query.error {
        return Err(ApiError::bad_request(&format!(
            "Google OAuth error: {}",
            err
        )));
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
        .connect_google(&user, request_origin(&req).as_deref(), &query.code)
        .await?;
    Ok(HttpResponse::Found()
        .insert_header((header::LOCATION, "/calendar/settings"))
        .finish())
}

/// Finish the Google Calendar OAuth flow.
///
/// The frontend POSTs the authorization code it captured from the OAuth redirect URL,
/// which avoids requiring a Bearer token on the raw redirect URI that Google calls
/// (where the browser has no JWT header). Exchanges the code for tokens and stores the
/// connection.
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
    req: HttpRequest,
    state: web::Data<ConnectionsApiState>,
    user: AuthenticatedUser,
    body: web::Json<CompleteGoogleRequest>,
) -> Result<web::Json<ConnectionResponse>, ApiError> {
    let conn = state
        .connections_service
        .connect_google(&user, request_origin(&req).as_deref(), &body.code)
        .await?;
    Ok(web::Json(conn))
}

// ── Outlook ───────────────────────────────────────────────────────────────────

/// Start the Outlook Calendar OAuth flow.
///
/// Returns the Microsoft authorization URL to redirect the browser to.
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
    req: HttpRequest,
    state: web::Data<ConnectionsApiState>,
    _user: AuthenticatedUser,
) -> Result<web::Json<OAuthInitResponse>, ApiError> {
    let result = state
        .connections_service
        .initiate_outlook(request_origin(&req).as_deref())?;
    Ok(web::Json(result))
}

/// Complete the Outlook Calendar OAuth flow.
///
/// Exchanges the authorization code Microsoft returned for tokens and stores the resulting
/// connection.
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
    req: HttpRequest,
    state: web::Data<ConnectionsApiState>,
    user: AuthenticatedUser,
    query: web::Query<OAuthCallbackQuery>,
) -> Result<web::Json<ConnectionResponse>, ApiError> {
    if let Some(err) = &query.error {
        return Err(ApiError::bad_request(&format!(
            "Outlook OAuth error: {}",
            err
        )));
    }
    let conn = state
        .connections_service
        .connect_outlook(&user, request_origin(&req).as_deref(), &query.code)
        .await?;
    Ok(web::Json(conn))
}

// ── Apple ─────────────────────────────────────────────────────────────────────

/// Connect an Apple Calendar over CalDAV.
///
/// Validates the supplied CalDAV URL and app-specific password before storing the
/// credentials as a connection.
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

/// Remove a connected external calendar.
///
/// Deletes the stored credentials and stops any further syncing from that provider.
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

/// Run a calendar sync now.
///
/// Pulls events from the requested connection (or all of them) immediately instead of
/// waiting for the scheduled background sync, and reports what changed.
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
    tags((
        name = "connections",
        description = "Links to external calendars — Google and Outlook over OAuth 2.0, Apple over CalDAV. Each connection stores the credentials needed to pull events in, and sync runs on a schedule or on demand through the trigger endpoint."
    )),
    security(("bearer_auth" = []))
)]
pub struct ConnectionsApiDoc;

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::test::TestRequest;

    #[test]
    fn takes_the_origin_header_when_the_browser_sends_one() {
        let req = TestRequest::default()
            .insert_header((header::ORIGIN, "https://neutrino.example.com"))
            .to_http_request();
        assert_eq!(
            request_origin(&req).as_deref(),
            Some("https://neutrino.example.com")
        );
    }

    /// A provider redirect is a top-level navigation with no `Origin`, so the
    /// forwarded host is all there is — and behind a reverse proxy it is the
    /// public address, which is the one registered with the provider.
    #[test]
    fn falls_back_to_the_forwarded_host_on_a_redirect() {
        let req = TestRequest::default()
            .insert_header(("x-forwarded-proto", "https"))
            .insert_header(("x-forwarded-host", "neutrino.example.com"))
            .to_http_request();
        assert_eq!(
            request_origin(&req).as_deref(),
            Some("https://neutrino.example.com")
        );
    }

    #[test]
    fn ignores_an_opaque_origin() {
        let req = TestRequest::default()
            .insert_header((header::ORIGIN, "null"))
            .insert_header(("host", "neutrino.example.com"))
            .to_http_request();
        assert_eq!(
            request_origin(&req).as_deref(),
            Some("http://neutrino.example.com")
        );
    }
}
