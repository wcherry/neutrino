use crate::calendar::attachments::{
    dto::{CreateAttachmentRequest, ListAttachmentsResponse},
    service::AttachmentsService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, post, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct AttachmentsApiState {
    pub attachments_service: Arc<AttachmentsService>,
}

/// List the attachments and notes on an event.
///
/// Attachments reference Drive files by ID; the file bytes themselves stay in Drive and
/// are fetched separately.
#[utoipa::path(
    get,
    path = "/api/v1/events/{event_id}/attachments",
    params(("event_id" = String, Path, description = "Event ID")),
    responses(
        (status = 200, description = "List of attachments", body = ListAttachmentsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "attachments"
)]
#[get("/events/{event_id}/attachments")]
pub async fn list_attachments(
    state: web::Data<AttachmentsApiState>,
    _user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<ListAttachmentsResponse>, ApiError> {
    let result = state
        .attachments_service
        .list_attachments(&path.into_inner())?;
    Ok(web::Json(result))
}

/// Attach a file or note to an event.
///
/// Links an existing Drive file (or a free-text note) to the event and returns the created
/// attachment record.
#[utoipa::path(
    post,
    path = "/api/v1/events/{event_id}/attachments",
    params(("event_id" = String, Path, description = "Event ID")),
    request_body = CreateAttachmentRequest,
    responses(
        (status = 201, description = "Attachment created", body = crate::calendar::attachments::dto::AttachmentResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "attachments"
)]
#[post("/events/{event_id}/attachments")]
pub async fn create_attachment(
    state: web::Data<AttachmentsApiState>,
    _user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<CreateAttachmentRequest>,
) -> Result<HttpResponse, ApiError> {
    let attachment = state
        .attachments_service
        .create_attachment(&path.into_inner(), body.into_inner())?;
    Ok(HttpResponse::Created().json(attachment))
}

/// Remove an attachment from an event.
///
/// Only the link is removed — the underlying Drive file is left untouched.
#[utoipa::path(
    delete,
    path = "/api/v1/events/{event_id}/attachments/{attachment_id}",
    params(
        ("event_id" = String, Path, description = "Event ID"),
        ("attachment_id" = String, Path, description = "Attachment ID"),
    ),
    responses(
        (status = 204, description = "Attachment deleted"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "attachments"
)]
#[delete("/events/{event_id}/attachments/{attachment_id}")]
pub async fn delete_attachment(
    state: web::Data<AttachmentsApiState>,
    _user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (event_id, attachment_id) = path.into_inner();
    state
        .attachments_service
        .delete_attachment(&event_id, &attachment_id)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_attachments)
        .service(create_attachment)
        .service(delete_attachment);
}

#[derive(OpenApi)]
#[openapi(
    paths(list_attachments, create_attachment, delete_attachment),
    components(schemas(
        CreateAttachmentRequest,
        crate::calendar::attachments::dto::AttachmentResponse,
        ListAttachmentsResponse,
    )),
    tags((
        name = "attachments",
        description = "Files and notes hung off a calendar event. Attachments reference Drive files by ID rather than storing bytes, so deleting an attachment never touches the underlying file."
    )),
    security(("bearer_auth" = []))
)]
pub struct AttachmentsApiDoc;
