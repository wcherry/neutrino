use crate::notes::{
    dto::{
        BacklinksResponse, CreateNoteRequest, ListNotesResponse, NoteLinkItem, NoteMetaResponse,
        NoteResponse, SaveNoteRequest,
    },
    service::NotesService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, patch, post, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct NotesApiState {
    pub notes_service: Arc<NotesService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/notes",
    responses(
        (status = 200, description = "List of notes", body = ListNotesResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "notes"
)]
#[get("/notes")]
pub async fn list_notes(
    state: web::Data<NotesApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListNotesResponse>, ApiError> {
    let result = state.notes_service.list_notes(&user).await?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/notes",
    request_body = CreateNoteRequest,
    responses(
        (status = 201, description = "Note created", body = NoteResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "notes"
)]
#[post("/notes")]
pub async fn create_note(
    state: web::Data<NotesApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateNoteRequest>,
) -> Result<HttpResponse, ApiError> {
    let note = state
        .notes_service
        .create_note(&user, body.into_inner())
        .await?;
    Ok(HttpResponse::Created().json(note))
}

#[utoipa::path(
    get,
    path = "/api/v1/notes/{id}",
    params(
        ("id" = String, Path, description = "Note ID")
    ),
    responses(
        (status = 200, description = "Note with content", body = NoteResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "notes"
)]
#[get("/notes/{id}")]
pub async fn get_note(
    state: web::Data<NotesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<NoteResponse>, ApiError> {
    let note_id = path.into_inner();
    let note = state.notes_service.get_note(&user, &note_id).await?;
    Ok(web::Json(note))
}

#[utoipa::path(
    patch,
    path = "/api/v1/notes/{id}",
    params(
        ("id" = String, Path, description = "Note ID")
    ),
    request_body = SaveNoteRequest,
    responses(
        (status = 200, description = "Note saved", body = NoteMetaResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "notes"
)]
#[patch("/notes/{id}")]
pub async fn save_note(
    state: web::Data<NotesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<SaveNoteRequest>,
) -> Result<web::Json<NoteMetaResponse>, ApiError> {
    let note_id = path.into_inner();
    let meta = state
        .notes_service
        .save_note(&user, &note_id, body.into_inner())
        .await?;
    Ok(web::Json(meta))
}

#[utoipa::path(
    get,
    path = "/api/v1/notes/{id}/backlinks",
    params(
        ("id" = String, Path, description = "Note ID")
    ),
    responses(
        (status = 200, description = "Notes that link to this note", body = BacklinksResponse),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "notes"
)]
#[get("/notes/{id}/backlinks")]
pub async fn get_backlinks(
    state: web::Data<NotesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<BacklinksResponse>, ApiError> {
    let note_id = path.into_inner();
    let result = state.notes_service.get_backlinks(&user, &note_id).await?;
    Ok(web::Json(result))
}

#[utoipa::path(
    delete,
    path = "/api/v1/notes/{id}",
    params(
        ("id" = String, Path, description = "Note ID")
    ),
    responses(
        (status = 204, description = "Note deleted"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "notes"
)]
#[delete("/notes/{id}")]
pub async fn delete_note(
    state: web::Data<NotesApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let note_id = path.into_inner();
    state.notes_service.delete_note(&user, &note_id).await?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_notes)
        .service(create_note)
        .service(get_note)
        .service(save_note)
        .service(get_backlinks)
        .service(delete_note);
}

#[derive(OpenApi)]
#[openapi(
    paths(list_notes, create_note, get_note, save_note, get_backlinks, delete_note),
    components(schemas(
        CreateNoteRequest,
        SaveNoteRequest,
        NoteResponse,
        NoteMetaResponse,
        ListNotesResponse,
        BacklinksResponse,
        NoteLinkItem,
    )),
    tags((name = "notes", description = "Markdown note editor")),
    security(("bearer_auth" = []))
)]
pub struct NotesApiDoc;
