use actix_web::{get, post, web, HttpResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::service::{DocsAIService, ProviderOptions};
use crate::shared::{ApiError, AuthenticatedUser};

pub struct DocsAIState {
    pub ai_service: Arc<DocsAIService>,
}

// ── Shared provider fields (mixed into every request body) ────────────────────

/// Convenience struct — embedded in every request body so callers can override
/// the AI provider + API key on a per-request basis.
#[derive(Deserialize, Default, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProviderFields {
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
}

impl From<ProviderFields> for ProviderOptions {
    fn from(f: ProviderFields) -> Self {
        ProviderOptions {
            provider: f.provider,
            api_key: f.api_key,
        }
    }
}

// ── Request bodies ────────────────────────────────────────────────────────────

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SmartComposeRequest {
    pub context: String,
    #[serde(flatten)]
    pub provider_fields: ProviderFields,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TranslateRequest {
    pub content: String,
    pub target_lang: String,
    #[serde(flatten)]
    pub provider_fields: ProviderFields,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct HelpMeWriteRequest {
    pub description: String,
    #[serde(flatten)]
    pub provider_fields: ProviderFields,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct SummarizeRequest {
    /// Full document content (plain text or TipTap JSON-derived text).
    pub content: String,
    /// When set, only this text is summarised (full doc is passed as context).
    #[serde(default)]
    pub selected_text: Option<String>,
    /// If true and no text is selected, save the summary as the doc description.
    #[serde(default)]
    pub save_to_metadata: bool,
    #[serde(flatten)]
    pub provider_fields: ProviderFields,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionsRequest {
    /// Full document content.
    pub content: String,
    /// When set, suggest continuation after this text (using full doc as context).
    #[serde(default)]
    pub selected_text: Option<String>,
    #[serde(flatten)]
    pub provider_fields: ProviderFields,
}

#[derive(Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangeToneRequest {
    /// Full document content.
    pub content: String,
    /// When set, only rewrite this text (using full doc as context).
    #[serde(default)]
    pub selected_text: Option<String>,
    /// 0 = informal, 100 = formal.
    pub formal: u8,
    /// 0 = reserved, 100 = cheerful.
    pub cheerful: u8,
    /// 0 = succinct, 100 = verbose.
    pub verbose: u8,
    #[serde(flatten)]
    pub provider_fields: ProviderFields,
}

// ── Response bodies ───────────────────────────────────────────────────────────

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompletionResponse {
    pub completion: String,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TranslateResponse {
    pub translated: String,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SummarizeResponse {
    pub summary: String,
    pub saved_to_metadata: bool,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionsResponse {
    pub suggestion: String,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangeToneResponse {
    pub result: String,
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

/// POST /api/v1/docs/{id}/ai/complete
#[utoipa::path(
    post,
    path = "/api/v1/docs/{id}/ai/complete",
    params(("id" = String, Path, description = "Document ID")),
    request_body = SmartComposeRequest,
    responses(
        (status = 200, description = "AI completion", body = CompletionResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "docs-ai"
)]
#[post("/docs/{id}/ai/complete")]
pub async fn smart_compose(
    state: web::Data<DocsAIState>,
    _user: AuthenticatedUser,
    _path: web::Path<String>,
    body: web::Json<SmartComposeRequest>,
) -> Result<web::Json<CompletionResponse>, ApiError> {
    let body = body.into_inner();
    let completion = state
        .ai_service
        .smart_compose(&body.context, body.provider_fields.into())
        .await?;
    Ok(web::Json(CompletionResponse { completion }))
}

/// POST /api/v1/docs/{id}/ai/translate
#[utoipa::path(
    post,
    path = "/api/v1/docs/{id}/ai/translate",
    params(("id" = String, Path, description = "Document ID")),
    request_body = TranslateRequest,
    responses(
        (status = 200, description = "Translation result", body = TranslateResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "docs-ai"
)]
#[post("/docs/{id}/ai/translate")]
pub async fn translate(
    state: web::Data<DocsAIState>,
    _user: AuthenticatedUser,
    _path: web::Path<String>,
    body: web::Json<TranslateRequest>,
) -> Result<web::Json<TranslateResponse>, ApiError> {
    let body = body.into_inner();
    let translated = state
        .ai_service
        .translate(&body.content, &body.target_lang, body.provider_fields.into())
        .await?;
    Ok(web::Json(TranslateResponse { translated }))
}

/// POST /api/v1/docs/ai/help-me-write
#[utoipa::path(
    post,
    path = "/api/v1/docs/ai/help-me-write",
    request_body = HelpMeWriteRequest,
    responses(
        (status = 200, description = "AI-generated content", body = CompletionResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "docs-ai"
)]
#[post("/docs/ai/help-me-write")]
pub async fn help_me_write(
    state: web::Data<DocsAIState>,
    _user: AuthenticatedUser,
    body: web::Json<HelpMeWriteRequest>,
) -> Result<web::Json<CompletionResponse>, ApiError> {
    let body = body.into_inner();
    let completion = state
        .ai_service
        .help_me_write(&body.description, body.provider_fields.into())
        .await?;
    Ok(web::Json(CompletionResponse { completion }))
}

/// GET /api/v1/docs/{id}/ai/summarize — legacy no-op, direct clients to POST
#[utoipa::path(
    get,
    path = "/api/v1/docs/{id}/ai/summarize",
    params(("id" = String, Path, description = "Document ID")),
    responses(
        (status = 400, description = "Use POST instead"),
    ),
    security(("bearer_auth" = [])),
    tag = "docs-ai"
)]
#[get("/docs/{id}/ai/summarize")]
pub async fn summarize(
    _state: web::Data<DocsAIState>,
    _user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let _ = path.into_inner();
    Ok(HttpResponse::BadRequest().json(serde_json::json!({
        "error": {
            "code": "USE_POST",
            "message": "Use POST /docs/{id}/ai/summarize with body {content: string, selectedText?: string, saveToMetadata?: bool}"
        }
    })))
}

/// POST /api/v1/docs/{id}/ai/summarize
#[utoipa::path(
    post,
    path = "/api/v1/docs/{id}/ai/summarize",
    params(("id" = String, Path, description = "Document ID")),
    request_body = SummarizeRequest,
    responses(
        (status = 200, description = "Document summary", body = SummarizeResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "docs-ai"
)]
#[post("/docs/{id}/ai/summarize")]
pub async fn summarize_post(
    state: web::Data<DocsAIState>,
    _user: AuthenticatedUser,
    _path: web::Path<String>,
    body: web::Json<SummarizeRequest>,
) -> Result<web::Json<SummarizeResponse>, ApiError> {
    let body = body.into_inner();
    let selected = body.selected_text.as_deref();
    let summary = state
        .ai_service
        .summarize(&body.content, selected, body.provider_fields.into())
        .await?;
    // save_to_metadata is handled client-side by calling PATCH /docs/{id} with the
    // summary as the description; we return the flag so the client knows to do so.
    Ok(web::Json(SummarizeResponse {
        summary,
        saved_to_metadata: false, // actual save is a separate client PATCH call
    }))
}

/// POST /api/v1/docs/{id}/ai/suggestions
#[utoipa::path(
    post,
    path = "/api/v1/docs/{id}/ai/suggestions",
    params(("id" = String, Path, description = "Document ID")),
    request_body = SuggestionsRequest,
    responses(
        (status = 200, description = "AI writing suggestion", body = SuggestionsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "docs-ai"
)]
#[post("/docs/{id}/ai/suggestions")]
pub async fn suggestions(
    state: web::Data<DocsAIState>,
    _user: AuthenticatedUser,
    _path: web::Path<String>,
    body: web::Json<SuggestionsRequest>,
) -> Result<web::Json<SuggestionsResponse>, ApiError> {
    let body = body.into_inner();
    let selected = body.selected_text.as_deref();
    let suggestion = state
        .ai_service
        .suggestions(&body.content, selected, body.provider_fields.into())
        .await?;
    Ok(web::Json(SuggestionsResponse { suggestion }))
}

/// POST /api/v1/docs/{id}/ai/change-tone
#[utoipa::path(
    post,
    path = "/api/v1/docs/{id}/ai/change-tone",
    params(("id" = String, Path, description = "Document ID")),
    request_body = ChangeToneRequest,
    responses(
        (status = 200, description = "Rewritten content", body = ChangeToneResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "docs-ai"
)]
#[post("/docs/{id}/ai/change-tone")]
pub async fn change_tone(
    state: web::Data<DocsAIState>,
    _user: AuthenticatedUser,
    _path: web::Path<String>,
    body: web::Json<ChangeToneRequest>,
) -> Result<web::Json<ChangeToneResponse>, ApiError> {
    let body = body.into_inner();
    let selected = body.selected_text.as_deref();
    let result = state
        .ai_service
        .change_tone(
            &body.content,
            selected,
            body.formal,
            body.cheerful,
            body.verbose,
            body.provider_fields.into(),
        )
        .await?;
    Ok(web::Json(ChangeToneResponse { result }))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(help_me_write)
        .service(smart_compose)
        .service(translate)
        .service(summarize)
        .service(summarize_post)
        .service(suggestions)
        .service(change_tone);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(
        smart_compose,
        translate,
        help_me_write,
        summarize,
        summarize_post,
        suggestions,
        change_tone,
    ),
    components(schemas(
        ProviderFields,
        SmartComposeRequest,
        TranslateRequest,
        HelpMeWriteRequest,
        SummarizeRequest,
        SuggestionsRequest,
        ChangeToneRequest,
        CompletionResponse,
        TranslateResponse,
        SummarizeResponse,
        SuggestionsResponse,
        ChangeToneResponse,
    )),
    tags((name = "docs-ai", description = "Docs AI endpoints")),
    security(("bearer_auth" = []))
)]
pub struct DocsAIApiDoc;
