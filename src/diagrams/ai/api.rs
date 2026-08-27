use crate::diagrams::ai::service::DiagramsAIService;
use crate::shared::{AiCredentials, ApiError, AuthenticatedUser};
use actix_web::{post, web, HttpResponse};
use serde::Deserialize;
use std::sync::Arc;

pub struct DiagramsAIApiState {
    pub ai_service: Arc<DiagramsAIService>,
}

// ── Request DTOs ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GenerateDiagramRequest {
    /// The provider and key from Settings → AI Assistant.
    #[serde(flatten)]
    pub credentials: AiCredentials,
    pub prompt: String,
}

// ── Endpoints ────────────────────────────────────────────────────────────────

/// Draw a diagram from a plain-language description.
///
/// Returns `shapes` and `connectors` for the editor to insert on the current page. The route takes
/// no diagram id because generation reads nothing from the stored file — diagram content is E2EE
/// and the server could not read it anyway. The provider and key come with the request, from
/// Settings → AI Assistant.
#[utoipa::path(
    post,
    path = "/api/v1/diagrams/ai/generate",
    request_body = GenerateDiagramRequest,
    responses(
        (status = 200, description = "Generated shapes and connectors"),
        (status = 400, description = "Empty prompt"),
        (status = 503, description = "No API key configured, or the model returned nothing usable"),
    ),
    security(("bearer_auth" = [])),
    tag = "diagrams-ai"
)]
#[post("/diagrams/ai/generate")]
pub async fn generate_diagram(
    state: web::Data<DiagramsAIApiState>,
    _user: AuthenticatedUser,
    body: web::Json<GenerateDiagramRequest>,
) -> Result<HttpResponse, ApiError> {
    let req = body.into_inner();
    let prompt = req.prompt.trim();
    if prompt.is_empty() {
        return Err(ApiError::bad_request("Prompt cannot be empty"));
    }

    let diagram = state
        .ai_service
        .generate_diagram(&req.credentials, prompt)
        .await
        .map_err(|e| ApiError::new(503, "AI_UNAVAILABLE", e))?;

    Ok(HttpResponse::Ok().json(diagram))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(generate_diagram);
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{http::StatusCode, test, App};

    /// The editor used to POST to `/api/ai/diagram-generate`, a Next.js route handler — which
    /// exists in `next dev` and nowhere else, because production is a static export served by
    /// this binary. Every Generate in a deployed instance was answered `405` by the static file
    /// handler (issue #139). This pins the route the editor calls now to something actually
    /// registered here: an unauthenticated request must be rejected by the handler's own
    /// extractors, never by the router for want of a route.
    #[actix_web::test]
    async fn generate_is_routed_under_api_v1() {
        let app = test::init_service(
            App::new().service(actix_web::web::scope("/api/v1").configure(configure)),
        )
        .await;

        let req = test::TestRequest::post()
            .uri("/api/v1/diagrams/ai/generate")
            .set_json(serde_json::json!({
                "provider": "claude",
                "apiKey": "sk-test",
                "prompt": "A CI/CD pipeline",
            }))
            .to_request();
        let resp = test::call_service(&app, req).await;

        assert_ne!(resp.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_ne!(resp.status(), StatusCode::NOT_FOUND);
    }
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(generate_diagram),
    components(schemas(GenerateDiagramRequest, AiCredentials)),
    tags((
        name = "diagrams-ai",
        description = "Diagram generation: turns a plain-language description into shapes and connectors the editor drops onto the page. The provider and API key travel with the request — they are the ones set in Settings → AI Assistant."
    )),
    security(("bearer_auth" = []))
)]
pub struct DiagramsAIApiDoc;
