use super::dto::{AuthorizeQuery, RevokeRequest, TokenRequest, TokenResponse};
use super::service::OauthService;
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{HttpResponse, get, post, web};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct OauthApiState {
    pub oauth_service: Arc<OauthService>,
}

// ── GET /oauth/authorize ──────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/api/v1/oauth/authorize",
    params(
        ("client_id" = String, Query, description = "Registered OAuth client ID"),
        ("redirect_uri" = String, Query, description = "Registered redirect URI"),
        ("response_type" = String, Query, description = "Must be 'code'"),
        ("code_challenge" = String, Query, description = "PKCE code challenge (BASE64URL(SHA256(verifier)))"),
        ("code_challenge_method" = String, Query, description = "Must be 'S256'"),
        ("state" = Option<String>, Query, description = "Optional opaque state value"),
        ("scope" = Option<String>, Query, description = "Optional requested scope"),
    ),
    responses(
        (status = 302, description = "Redirect to redirect_uri with authorization code"),
        (status = 400, description = "Invalid request parameters"),
        (status = 401, description = "User not authenticated"),
    ),
    security(("bearer_auth" = [])),
    tag = "oauth"
)]
#[get("/authorize")]
pub async fn authorize(
    state: web::Data<OauthApiState>,
    query: web::Query<AuthorizeQuery>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let query = query.into_inner();
    state.oauth_service.validate_authorize(&query)?;
    let code = state
        .oauth_service
        .issue_authorization_code(&user.user_id, &query)?;

    let mut location = format!("{}?code={}", query.redirect_uri, code);
    if let Some(ref s) = query.state {
        location.push_str(&format!("&state={}", s));
    }

    Ok(HttpResponse::Found()
        .append_header(("Location", location))
        .finish())
}

// ── POST /oauth/token ─────────────────────────────────────────────────────────

#[utoipa::path(
    post,
    path = "/api/v1/oauth/token",
    request_body(
        content = TokenRequest,
        content_type = "application/x-www-form-urlencoded"
    ),
    responses(
        (status = 200, description = "Tokens issued", body = TokenResponse),
        (status = 400, description = "Invalid request or grant"),
    ),
    tag = "oauth"
)]
#[post("/token")]
pub async fn token(
    state: web::Data<OauthApiState>,
    form: web::Form<TokenRequest>,
) -> Result<web::Json<TokenResponse>, ApiError> {
    let req = form.into_inner();
    let response = match req.grant_type.as_str() {
        "authorization_code" => state.oauth_service.exchange_code(&req)?,
        "refresh_token" => {
            let rt = req
                .refresh_token
                .as_deref()
                .ok_or_else(|| ApiError::bad_request("refresh_token is required"))?;
            state.oauth_service.refresh_token(rt)?
        }
        _ => return Err(ApiError::bad_request("Unsupported grant_type")),
    };
    Ok(web::Json(response))
}

// ── POST /oauth/revoke ────────────────────────────────────────────────────────

#[utoipa::path(
    post,
    path = "/api/v1/oauth/revoke",
    request_body(
        content = RevokeRequest,
        content_type = "application/x-www-form-urlencoded"
    ),
    responses(
        (status = 200, description = "Token revoked (or was already invalid)"),
        (status = 400, description = "Invalid request"),
    ),
    tag = "oauth"
)]
#[post("/revoke")]
pub async fn revoke(
    state: web::Data<OauthApiState>,
    form: web::Form<RevokeRequest>,
) -> Result<HttpResponse, ApiError> {
    let req = form.into_inner();
    let token_str = req.token.clone();
    state.oauth_service.revoke_token(&req, &token_str)?;
    Ok(HttpResponse::Ok().json(serde_json::json!({})))
}

// ── Route configuration ───────────────────────────────────────────────────────

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(
        web::scope("/oauth")
            .service(authorize)
            .service(token)
            .service(revoke),
    );
}

#[derive(OpenApi)]
#[openapi(
    paths(authorize, token, revoke),
    components(schemas(
        AuthorizeQuery,
        TokenRequest,
        TokenResponse,
        RevokeRequest,
    )),
    tags((name = "oauth", description = "OAuth 2.0 authorization server endpoints")),
    security(("bearer_auth" = []))
)]
pub struct OauthApiDoc;
