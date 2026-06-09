use crate::shared::{ApiError, AuthenticatedUser};
use crate::sheets::ai::service::SheetsAIService;
use actix_web::{post, web, HttpResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub struct SheetsAIApiState {
    pub ai_service: Arc<SheetsAIService>,
}

// ── Request / response DTOs ──────────────────────────────────────────────────

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SmartFillRequest {
    pub column_values: Vec<String>,
    /// Each element is a [input, output] pair
    pub examples: Vec<[String; 2]>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SmartFillResponse {
    pub values: Vec<String>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExploreRequest {
    pub question: String,
    pub sheet_data: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PivotRequest {
    pub prompt: String,
    pub sheet_data: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InsightsRequest {
    pub sheet_data: String,
}

// ── Endpoints ────────────────────────────────────────────────────────────────

#[utoipa::path(
    post,
    path = "/api/v1/sheets/{id}/ai/smart-fill",
    params(("id" = String, Path, description = "Sheet ID")),
    request_body = SmartFillRequest,
    responses(
        (status = 200, description = "Smart fill predictions", body = SmartFillResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "sheets-ai"
)]
#[post("/sheets/{id}/ai/smart-fill")]
pub async fn smart_fill(
    state: web::Data<SheetsAIApiState>,
    _user: AuthenticatedUser,
    _path: web::Path<String>,
    body: web::Json<SmartFillRequest>,
) -> Result<HttpResponse, ApiError> {
    let req = body.into_inner();
    let examples: Vec<(String, String)> = req
        .examples
        .into_iter()
        .map(|pair| (pair[0].clone(), pair[1].clone()))
        .collect();

    let values = state
        .ai_service
        .smart_fill(req.column_values, examples)
        .await
        .map_err(|e| ApiError::new(503, "AI_UNAVAILABLE", e))?;

    Ok(HttpResponse::Ok().json(SmartFillResponse { values }))
}

#[utoipa::path(
    post,
    path = "/api/v1/sheets/{id}/ai/explore",
    params(("id" = String, Path, description = "Sheet ID")),
    request_body = ExploreRequest,
    responses(
        (status = 200, description = "AI exploration answer"),
    ),
    security(("bearer_auth" = [])),
    tag = "sheets-ai"
)]
#[post("/sheets/{id}/ai/explore")]
pub async fn explore(
    state: web::Data<SheetsAIApiState>,
    _user: AuthenticatedUser,
    _path: web::Path<String>,
    body: web::Json<ExploreRequest>,
) -> Result<HttpResponse, ApiError> {
    let req = body.into_inner();

    let result = state
        .ai_service
        .explore(&req.question, &req.sheet_data)
        .await
        .map_err(|e| ApiError::new(503, "AI_UNAVAILABLE", e))?;

    Ok(HttpResponse::Ok().json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/sheets/{id}/ai/pivot",
    params(("id" = String, Path, description = "Sheet ID")),
    request_body = PivotRequest,
    responses(
        (status = 200, description = "AI-generated pivot table configuration"),
    ),
    security(("bearer_auth" = [])),
    tag = "sheets-ai"
)]
#[post("/sheets/{id}/ai/pivot")]
pub async fn pivot(
    state: web::Data<SheetsAIApiState>,
    _user: AuthenticatedUser,
    _path: web::Path<String>,
    body: web::Json<PivotRequest>,
) -> Result<HttpResponse, ApiError> {
    let req = body.into_inner();

    let result = state
        .ai_service
        .generate_pivot(&req.prompt, &req.sheet_data)
        .await
        .map_err(|e| ApiError::new(503, "AI_UNAVAILABLE", e))?;

    Ok(HttpResponse::Ok().json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/sheets/{id}/ai/insights",
    params(("id" = String, Path, description = "Sheet ID")),
    request_body = InsightsRequest,
    responses(
        (status = 200, description = "AI-generated insights for the sheet data"),
    ),
    security(("bearer_auth" = [])),
    tag = "sheets-ai"
)]
#[post("/sheets/{id}/ai/insights")]
pub async fn insights(
    state: web::Data<SheetsAIApiState>,
    _user: AuthenticatedUser,
    _path: web::Path<String>,
    body: web::Json<InsightsRequest>,
) -> Result<HttpResponse, ApiError> {
    let req = body.into_inner();

    let result = state
        .ai_service
        .get_insights(&req.sheet_data)
        .await
        .map_err(|e| ApiError::new(503, "AI_UNAVAILABLE", e))?;

    Ok(HttpResponse::Ok().json(result))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(smart_fill)
        .service(explore)
        .service(pivot)
        .service(insights);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(smart_fill, explore, pivot, insights),
    components(schemas(
        SmartFillRequest,
        SmartFillResponse,
        ExploreRequest,
        PivotRequest,
        InsightsRequest,
    )),
    tags((name = "sheets-ai", description = "Sheets AI endpoints")),
    security(("bearer_auth" = []))
)]
pub struct SheetsAIApiDoc;
