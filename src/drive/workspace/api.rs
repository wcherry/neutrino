use crate::drive::workspace::{
    dto::{UpdateWorkspaceSettingsRequest, WorkspaceSettingsResponse},
    service::WorkspaceService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{get, patch, web};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct WorkspaceApiState {
    pub workspace_service: Arc<WorkspaceService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/admin/workspace-settings",
    responses(
        (status = 200, description = "Current workspace settings", body = WorkspaceSettingsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "workspace"
)]
#[get("/workspace-settings")]
pub async fn get_workspace_settings(
    state: web::Data<WorkspaceApiState>,
    _user: AuthenticatedUser,
) -> Result<web::Json<WorkspaceSettingsResponse>, ApiError> {
    let settings = state.workspace_service.get_settings()?;
    Ok(web::Json(settings))
}

#[utoipa::path(
    patch,
    path = "/api/v1/admin/workspace-settings",
    request_body = UpdateWorkspaceSettingsRequest,
    responses(
        (status = 200, description = "Workspace settings updated", body = WorkspaceSettingsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "workspace"
)]
#[patch("/workspace-settings")]
pub async fn update_workspace_settings(
    state: web::Data<WorkspaceApiState>,
    _user: AuthenticatedUser,
    body: web::Json<UpdateWorkspaceSettingsRequest>,
) -> Result<web::Json<WorkspaceSettingsResponse>, ApiError> {
    let settings = state
        .workspace_service
        .update_settings(body.into_inner())?;
    Ok(web::Json(settings))
}

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(get_workspace_settings)
        .service(update_workspace_settings);
}

#[derive(OpenApi)]
#[openapi(
    paths(get_workspace_settings, update_workspace_settings),
    components(schemas(WorkspaceSettingsResponse, UpdateWorkspaceSettingsRequest)),
    tags((name = "workspace", description = "Workspace administration endpoints")),
    modifiers(&SecurityAddon)
)]
pub struct WorkspaceApiDoc;

struct SecurityAddon;
impl utoipa::Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearer_auth",
                utoipa::openapi::security::SecurityScheme::Http(
                    utoipa::openapi::security::HttpBuilder::new()
                        .scheme(utoipa::openapi::security::HttpAuthScheme::Bearer)
                        .bearer_format("JWT")
                        .build(),
                ),
            );
        }
    }
}
