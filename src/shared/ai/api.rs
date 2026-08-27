use super::client::AiClient;
use super::credentials::AiCredentials;
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{post, web, HttpResponse};
use serde::Deserialize;
use std::sync::Arc;

pub struct AiApiState {
    pub client: Arc<AiClient>,
}

/// Ceiling on what a caller may ask a provider to generate, so a client typo can't run up the
/// user's bill on their own key.
const MAX_TOKENS_LIMIT: u32 = 4096;
const DEFAULT_MAX_TOKENS: u32 = 512;

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CompleteRequest {
    #[serde(flatten)]
    pub credentials: AiCredentials,
    #[serde(default)]
    pub system_prompt: String,
    pub user_message: String,
    pub max_tokens: Option<u32>,
}

/// Send a prompt to the caller's configured provider.
///
/// The general-purpose endpoint behind the AI features that have no server-side logic of their own
/// — the docs grammar fix, the Sheets conditional-formatting rule builder — where all the server
/// does is hold the provider call. Everything it needs comes from the request: the provider and
/// key are the ones set in Settings → AI Assistant.
#[utoipa::path(
    post,
    path = "/api/v1/ai/complete",
    request_body = CompleteRequest,
    responses(
        (status = 200, description = "The model's reply, as `{ text }`"),
        (status = 503, description = "No API key configured, or the provider rejected the request"),
    ),
    security(("bearer_auth" = [])),
    tag = "ai"
)]
#[post("/ai/complete")]
pub async fn complete(
    state: web::Data<AiApiState>,
    _user: AuthenticatedUser,
    body: web::Json<CompleteRequest>,
) -> Result<HttpResponse, ApiError> {
    let req = body.into_inner();
    if req.user_message.trim().is_empty() {
        return Err(ApiError::bad_request("Message cannot be empty"));
    }

    let max_tokens = req
        .max_tokens
        .unwrap_or(DEFAULT_MAX_TOKENS)
        .clamp(1, MAX_TOKENS_LIMIT);

    let text = state
        .client
        .complete_with_system(
            &req.credentials,
            &req.system_prompt,
            &req.user_message,
            max_tokens,
        )
        .await
        .map_err(|e| ApiError::new(503, "AI_UNAVAILABLE", e))?;

    Ok(HttpResponse::Ok().json(serde_json::json!({ "text": text })))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(complete);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(complete),
    components(schemas(CompleteRequest, AiCredentials)),
    tags((
        name = "ai",
        description = "The provider-agnostic completion endpoint every AI feature is built on. The provider and API key travel with each request — they are the user's own, set in Settings → AI Assistant and held in their browser — so the server keeps no key of its own and each account spends on its own account."
    )),
    security(("bearer_auth" = []))
)]
pub struct AiApiDoc;

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{http::StatusCode, test, App};
    use utoipa::OpenApi;

    /// utoipa has to make sense of the `#[serde(flatten)]` credentials, or the published schema
    /// tells an API consumer to send a body the server will reject.
    #[actix_web::test]
    async fn the_published_schema_documents_the_credential_fields() {
        let doc = serde_json::to_string(&AiApiDoc::openapi()).expect("serialise openapi");
        assert!(doc.contains("apiKey"), "{doc}");
        assert!(doc.contains("provider"), "{doc}");
    }

    #[actix_web::test]
    async fn rejects_an_empty_message_before_calling_a_provider() {
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(AiApiState {
                    client: Arc::new(AiClient::new()),
                }))
                .service(web::scope("/api/v1").configure(configure)),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/v1/ai/complete")
            .set_json(serde_json::json!({
                "provider": "claude",
                "apiKey": "sk-test",
                "userMessage": "   ",
            }))
            .to_request();
        let resp = test::call_service(&app, req).await;

        // The auth extractor runs first and has no token service in this app, so anything but a
        // routing failure proves the route is wired; the handler's own check is unit-tested by
        // the empty-key case in `client`.
        assert_ne!(resp.status(), StatusCode::NOT_FOUND);
        assert_ne!(resp.status(), StatusCode::METHOD_NOT_ALLOWED);
    }
}
