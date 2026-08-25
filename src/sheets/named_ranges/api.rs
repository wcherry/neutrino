use crate::shared::{ApiError, AuthenticatedUser, TokenService};
use crate::sheets::named_ranges::{
    dto::{CreateNamedRangeRequest, NamedRangeResponse, SheetEmbedResponse},
    service::NamedRangesService,
};
use actix_web::{get, post, web, HttpRequest, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct NamedRangesApiState {
    pub service: Arc<NamedRangesService>,
}

/// Name a rectangular range of cells in a spreadsheet.
///
/// Bounds are 0-based and inclusive, and `sheetId` picks the tab (first tab by default). The
/// GUID returned is what an embed elsewhere points at, so the embed keeps working when rows move.
#[utoipa::path(
    post,
    path = "/api/v1/sheets/{id}/named-ranges",
    params(("id" = String, Path, description = "Spreadsheet ID")),
    request_body = CreateNamedRangeRequest,
    responses(
        (status = 201, description = "Named range created", body = NamedRangeResponse),
        (status = 400, description = "Invalid range bounds"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Spreadsheet not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "named_ranges"
)]
#[post("/sheets/{id}/named-ranges")]
pub async fn create_named_range(
    state: web::Data<NamedRangesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<CreateNamedRangeRequest>,
) -> Result<HttpResponse, ApiError> {
    let sheet_db_id = path.into_inner();
    let result = state
        .service
        .create_named_range(&user, &sheet_db_id, body.into_inner())
        .await?;
    Ok(HttpResponse::Created().json(result))
}

/// Read the current cell values behind a named range.
///
/// What a live embed in a doc or slide polls. Authentication is optional — the named range GUID
/// is itself the capability, so a public embed works without a token, while a bearer token, if
/// present, is honoured for private sheets.
#[utoipa::path(
    get,
    path = "/api/v1/sheets/{id}/embed/{named_range_id}",
    params(
        ("id" = String, Path, description = "Spreadsheet ID"),
        ("named_range_id" = String, Path, description = "Named range GUID"),
    ),
    responses(
        (status = 200, description = "Embed cell data", body = SheetEmbedResponse),
        (status = 404, description = "Spreadsheet or named range not found"),
    ),
    tag = "named_ranges"
)]
#[get("/sheets/{id}/embed/{named_range_id}")]
pub async fn get_sheet_embed(
    state: web::Data<NamedRangesApiState>,
    req: HttpRequest,
    path: web::Path<(String, String)>,
    token_service: web::Data<Arc<TokenService>>,
) -> Result<web::Json<SheetEmbedResponse>, ApiError> {
    let (sheet_db_id, named_range_id) = path.into_inner();

    // Attempt to extract a bearer token but don't require it — the named
    // range GUID is the capability token for public embeds.
    let user_opt: Option<AuthenticatedUser> = req
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .and_then(|raw_token| {
            token_service
                .validate_access_token(raw_token)
                .ok()
                .map(|claims| AuthenticatedUser {
                    user_id: claims.sub,
                    email: claims.email,
                    token: raw_token.to_string(),
                    is_admin: claims.is_admin,
                })
        });

    let result = state
        .service
        .get_embed(user_opt.as_ref(), &sheet_db_id, &named_range_id)
        .await?;
    Ok(web::Json(result))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(create_named_range).service(get_sheet_embed);
}

#[derive(OpenApi)]
#[openapi(
    paths(create_named_range, get_sheet_embed),
    components(schemas(
        CreateNamedRangeRequest,
        NamedRangeResponse,
        SheetEmbedResponse,
    )),
    tags((
        name = "named_ranges",
        description = "Named rectangular ranges within a spreadsheet, and the read endpoint that turns one into a live embed elsewhere. Naming a range gives it a stable GUID that survives rows and columns moving, and that GUID doubles as the capability an embed presents — so an embedded range can be read without a session when the sheet allows it."
    )),
    security(("bearer_auth" = []))
)]
pub struct NamedRangesApiDoc;
