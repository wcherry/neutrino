// ── branding::api ─────────────────────────────────────────────────────────────
//
// Reads are public — the sign-in page and the native clients' sign-in screens need the brand
// before anyone has signed in. Writes take `AdminUser` and are mounted under `/api/v1/admin`.

use std::sync::Arc;

use actix_web::http::header::{CACHE_CONTROL, CONTENT_SECURITY_POLICY, X_CONTENT_TYPE_OPTIONS};
use actix_web::{delete, get, put, web, HttpResponse};
use serde::Deserialize;
use utoipa::OpenApi;

use super::dto::{BrandingResponse, PutBrandingRequest};
use super::service::{BrandingService, MAX_ASSET_BYTES};
use crate::shared::{AdminUser, ApiError};

pub struct BrandingApiState {
    pub service: Arc<BrandingService>,
}

/// The instance's brand: name, accent, sign-in message and image URLs.
#[utoipa::path(
    get,
    path = "/api/v1/branding",
    responses((status = 200, description = "The instance's brand", body = BrandingResponse)),
    tag = "branding"
)]
#[get("/branding")]
pub async fn get_branding(state: web::Data<BrandingApiState>) -> Result<web::Json<BrandingResponse>, ApiError> {
    Ok(web::Json(state.service.get()?))
}

#[derive(Deserialize)]
pub struct AssetQuery {
    v: Option<String>,
}

/// One of the brand's images (`logo-light`, `logo-dark`, `favicon`).
///
/// Requested with the current `?v=`, it is cached for good — a change makes a new URL. Without one,
/// or with an old one, it must be revalidated.
#[utoipa::path(
    get,
    path = "/api/v1/branding/assets/{kind}",
    params(("kind" = String, Path, description = "logo-light, logo-dark or favicon")),
    responses(
        (status = 200, description = "The image"),
        (status = 404, description = "Not set, or not a branding image"),
    ),
    tag = "branding"
)]
#[get("/branding/assets/{kind}")]
pub async fn get_branding_asset(
    state: web::Data<BrandingApiState>,
    path: web::Path<String>,
    query: web::Query<AssetQuery>,
) -> Result<HttpResponse, ApiError> {
    let Some((asset, version)) = state.service.asset(&path.into_inner())? else {
        return Err(ApiError::not_found("This branding image has not been set"));
    };
    let cache = if query.v.as_deref() == Some(version.as_str()) {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    Ok(HttpResponse::Ok()
        .content_type(asset.mime_type)
        .insert_header((CACHE_CONTROL, cache))
        // The bytes were sniffed on upload; these make sure a browser never treats them as
        // anything but the image they are, even opened directly.
        .insert_header((X_CONTENT_TYPE_OPTIONS, "nosniff"))
        .insert_header((CONTENT_SECURITY_POLICY, "default-src 'none'; sandbox"))
        .body(asset.bytes))
}

/// Set the instance's name, accent and sign-in message.
///
/// The accent must reach 4.5:1 on white — it is the colour of primary text in every look — and is
/// lifted automatically for dark mode. Every field is plain text; omitted or `null` restores
/// Neutrino's own.
#[utoipa::path(
    put,
    path = "/api/v1/admin/branding",
    request_body = PutBrandingRequest,
    responses(
        (status = 200, description = "The brand after the change", body = BrandingResponse),
        (status = 400, description = "Too long, not plain text, or an accent that is not legible"),
        (status = 403, description = "Not an administrator"),
    ),
    security(("bearer_auth" = [])),
    tag = "branding"
)]
#[put("/branding")]
pub async fn put_branding(
    state: web::Data<BrandingApiState>,
    admin: AdminUser,
    body: web::Json<PutBrandingRequest>,
) -> Result<web::Json<BrandingResponse>, ApiError> {
    Ok(web::Json(state.service.put(&admin.user_id, body.into_inner())?))
}

/// Upload one of the brand's images as the raw request body: PNG, WebP or ICO, at most 256 KiB.
#[utoipa::path(
    put,
    path = "/api/v1/admin/branding/assets/{kind}",
    params(("kind" = String, Path, description = "logo-light, logo-dark or favicon")),
    request_body(content = Vec<u8>, content_type = "application/octet-stream"),
    responses(
        (status = 200, description = "The brand after the change", body = BrandingResponse),
        (status = 400, description = "Not a PNG, WebP or ICO image, or too large"),
        (status = 403, description = "Not an administrator"),
    ),
    security(("bearer_auth" = [])),
    tag = "branding"
)]
pub async fn put_branding_asset(
    state: web::Data<BrandingApiState>,
    admin: AdminUser,
    path: web::Path<String>,
    body: web::Bytes,
) -> Result<web::Json<BrandingResponse>, ApiError> {
    Ok(web::Json(state.service.put_asset(&admin.user_id, &path.into_inner(), &body)?))
}

/// Remove one of the brand's images, returning that one to Neutrino's own.
#[utoipa::path(
    delete,
    path = "/api/v1/admin/branding/assets/{kind}",
    params(("kind" = String, Path, description = "logo-light, logo-dark or favicon")),
    responses(
        (status = 200, description = "The brand after the change", body = BrandingResponse),
        (status = 403, description = "Not an administrator"),
    ),
    security(("bearer_auth" = [])),
    tag = "branding"
)]
#[delete("/branding/assets/{kind}")]
pub async fn delete_branding_asset(
    state: web::Data<BrandingApiState>,
    admin: AdminUser,
    path: web::Path<String>,
) -> Result<web::Json<BrandingResponse>, ApiError> {
    Ok(web::Json(state.service.delete_asset(&admin.user_id, &path.into_inner())?))
}

pub fn configure_public(cfg: &mut web::ServiceConfig) {
    cfg.service(get_branding).service(get_branding_asset);
}

/// Mounted under `/api/v1/admin`. The upload route is a plain resource so that its body limit — a
/// little over the cap, so an oversized image gets the service's explanation rather than a bare
/// 413 — applies to it alone and not to the rest of the admin scope.
pub fn configure_admin(cfg: &mut web::ServiceConfig) {
    cfg.service(put_branding).service(delete_branding_asset).service(
        web::resource("/branding/assets/{kind}")
            .app_data(web::PayloadConfig::new(MAX_ASSET_BYTES + 1024))
            .route(web::put().to(put_branding_asset)),
    );
}

#[derive(OpenApi)]
#[openapi(
    paths(get_branding, get_branding_asset, put_branding, put_branding_asset, delete_branding_asset),
    components(schemas(BrandingResponse, PutBrandingRequest)),
    tags((
        name = "branding",
        description = "The instance's brand — name, accent, sign-in message, logos and favicon. Read by every client before sign-in; set by administrators. The web app also receives it inside every HTML page, so it paints with no extra request."
    )),
    security(("bearer_auth" = []))
)]
pub struct BrandingApiDoc;
