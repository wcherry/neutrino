//! `/api/v1/admin/product-updates*` — what administrators announce in the
//! weekly email — and `/api/v1/weekly-email/preview`, the email the caller
//! would get for the last seven days.

use std::sync::Arc;

use actix_web::{delete, get, patch, post, web, HttpResponse};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use super::model::ProductUpdateRecord;
use super::service::WeeklyEmailService;
use crate::shared::{AdminUser, ApiError, AuthenticatedUser};

pub struct WeeklyApiState {
    pub service: Arc<WeeklyEmailService>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProductUpdateResponse {
    pub id: String,
    pub title: String,
    pub body: String,
    pub created_at: chrono::NaiveDateTime,
    pub updated_at: chrono::NaiveDateTime,
    /// `null` while it is a draft.
    pub published_at: Option<chrono::NaiveDateTime>,
}

impl From<ProductUpdateRecord> for ProductUpdateResponse {
    fn from(r: ProductUpdateRecord) -> Self {
        ProductUpdateResponse {
            id: r.id,
            title: r.title,
            body: r.body,
            created_at: r.created_at,
            updated_at: r.updated_at,
            published_at: r.published_at,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProductUpdateListResponse {
    pub updates: Vec<ProductUpdateResponse>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ProductUpdateRequest {
    pub title: String,
    /// Plain text. Blank lines separate paragraphs.
    pub body: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PublishProductUpdateRequest {
    /// `true` to publish, `false` to take it back to a draft.
    pub published: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct WeeklyEmailPreviewResponse {
    pub subject: String,
    pub text: String,
    pub html: String,
}

/// List product updates, drafts first.
#[utoipa::path(
    get,
    path = "/api/v1/admin/product-updates",
    responses(
        (status = 200, description = "Every product update", body = ProductUpdateListResponse),
        (status = 403, description = "Not an administrator"),
    ),
    security(("bearer_auth" = [])),
    tag = "weekly-email"
)]
#[get("/product-updates")]
pub async fn list_product_updates(
    state: web::Data<WeeklyApiState>,
    _admin: AdminUser,
) -> Result<web::Json<ProductUpdateListResponse>, ApiError> {
    let updates = state.service.list_updates()?;
    Ok(web::Json(ProductUpdateListResponse {
        updates: updates.into_iter().map(Into::into).collect(),
    }))
}

/// Write a product update. It starts as a draft.
#[utoipa::path(
    post,
    path = "/api/v1/admin/product-updates",
    request_body = ProductUpdateRequest,
    responses(
        (status = 201, description = "The new draft", body = ProductUpdateResponse),
        (status = 400, description = "Missing or too long"),
        (status = 403, description = "Not an administrator"),
    ),
    security(("bearer_auth" = [])),
    tag = "weekly-email"
)]
#[post("/product-updates")]
pub async fn create_product_update(
    state: web::Data<WeeklyApiState>,
    admin: AdminUser,
    body: web::Json<ProductUpdateRequest>,
) -> Result<HttpResponse, ApiError> {
    let update = state
        .service
        .create_update(&admin.user_id, &body.title, &body.body)?;
    Ok(HttpResponse::Created().json(ProductUpdateResponse::from(update)))
}

/// Change a product update's title and text.
#[utoipa::path(
    patch,
    path = "/api/v1/admin/product-updates/{id}",
    params(("id" = String, Path, description = "Product update ID")),
    request_body = ProductUpdateRequest,
    responses(
        (status = 200, description = "The update", body = ProductUpdateResponse),
        (status = 400, description = "Missing or too long"),
        (status = 404, description = "No such update"),
    ),
    security(("bearer_auth" = [])),
    tag = "weekly-email"
)]
#[patch("/product-updates/{id}")]
pub async fn edit_product_update(
    state: web::Data<WeeklyApiState>,
    _admin: AdminUser,
    path: web::Path<String>,
    body: web::Json<ProductUpdateRequest>,
) -> Result<web::Json<ProductUpdateResponse>, ApiError> {
    let update = state
        .service
        .edit_update(&path.into_inner(), &body.title, &body.body)?;
    Ok(web::Json(update.into()))
}

/// Publish a product update, or take it back to a draft.
///
/// The weekly email carries every update published during its week.
#[utoipa::path(
    post,
    path = "/api/v1/admin/product-updates/{id}/publish",
    params(("id" = String, Path, description = "Product update ID")),
    request_body = PublishProductUpdateRequest,
    responses(
        (status = 200, description = "The update", body = ProductUpdateResponse),
        (status = 404, description = "No such update"),
    ),
    security(("bearer_auth" = [])),
    tag = "weekly-email"
)]
#[post("/product-updates/{id}/publish")]
pub async fn publish_product_update(
    state: web::Data<WeeklyApiState>,
    _admin: AdminUser,
    path: web::Path<String>,
    body: web::Json<PublishProductUpdateRequest>,
) -> Result<web::Json<ProductUpdateResponse>, ApiError> {
    let update = state
        .service
        .set_published(&path.into_inner(), body.published)?;
    Ok(web::Json(update.into()))
}

/// Delete a product update.
#[utoipa::path(
    delete,
    path = "/api/v1/admin/product-updates/{id}",
    params(("id" = String, Path, description = "Product update ID")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 404, description = "No such update"),
    ),
    security(("bearer_auth" = [])),
    tag = "weekly-email"
)]
#[delete("/product-updates/{id}")]
pub async fn delete_product_update(
    state: web::Data<WeeklyApiState>,
    _admin: AdminUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state.service.delete_update(&path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

/// The weekly email the caller would get for the last seven days.
///
/// As their email settings stand. 204 when the week held nothing to tell, which is also when no
/// email would be sent.
#[utoipa::path(
    get,
    path = "/api/v1/weekly-email/preview",
    responses(
        (status = 200, description = "The email", body = WeeklyEmailPreviewResponse),
        (status = 204, description = "Nothing to tell this week"),
    ),
    security(("bearer_auth" = [])),
    tag = "weekly-email"
)]
#[get("/weekly-email/preview")]
pub async fn preview_weekly_email(
    state: web::Data<WeeklyApiState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    if user.user_id.starts_with("guest:") {
        return Ok(HttpResponse::NoContent().finish());
    }
    match state
        .service
        .preview(&user.user_id, chrono::Utc::now().naive_utc())?
    {
        Some(c) => Ok(HttpResponse::Ok().json(WeeklyEmailPreviewResponse {
            subject: c.subject,
            text: c.text,
            html: c.html,
        })),
        None => Ok(HttpResponse::NoContent().finish()),
    }
}

/// Mounted under `/api/v1/admin`.
pub fn configure_admin(conf: &mut web::ServiceConfig) {
    conf.service(list_product_updates)
        .service(create_product_update)
        .service(edit_product_update)
        .service(publish_product_update)
        .service(delete_product_update);
}

/// Mounted under `/api/v1`.
pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(preview_weekly_email);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        list_product_updates,
        create_product_update,
        edit_product_update,
        publish_product_update,
        delete_product_update,
        preview_weekly_email,
    ),
    components(schemas(
        ProductUpdateResponse,
        ProductUpdateListResponse,
        ProductUpdateRequest,
        PublishProductUpdateRequest,
        WeeklyEmailPreviewResponse,
    )),
    tags((
        name = "weekly-email",
        description = "The weekly email: each account's week, its Team Spaces' activity, and the product updates administrators publish."
    ))
)]
pub struct WeeklyApiDoc;
