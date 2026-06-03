use crate::shared::{
    apply_list_query, ApiError, AuthenticatedUser, ListQuery, ListQueryParams, OrderDirection,
};
use crate::drive::irm::service::IrmService;
use crate::drive::jobs::{dto::CreateJobRequest, service::JobsService};
use crate::drive::permissions::service::PermissionsService;
use crate::drive::storage::{
    dto::{
        CreateFileRequest, DocFileMetadataResponse, FileMetadataResponse, FileOrderField,
        FileVersionResponse, ListFilesResponse, ListVersionsResponse, QuotaResponse,
        SaveVersionRequest, UpdateVersionLabelRequest, VersionOrderField, ZipContentsResponse,
        ZipEntry, ZipEntryOrderField,
    },
    service::StorageService,
};
use crate::drive::tags::service::TagsService;
use actix_files::NamedFile;
use actix_multipart::Multipart;
use actix_web::{delete, get, patch, post, put, web, HttpRequest, HttpResponse};
use futures_util::StreamExt;
use std::sync::Arc;
use tokio::io::{AsyncWriteExt, BufWriter};
use utoipa::OpenApi;
use uuid::Uuid;

pub struct StorageApiState {
    pub storage_service: Arc<StorageService>,
    pub irm_service: Arc<IrmService>,
    pub permissions_service: Arc<PermissionsService>,
    pub jobs_service: Arc<JobsService>,
    pub tags_service: Arc<TagsService>,
}

/// MIME types for which the worker can generate a cover thumbnail.
fn is_thumbnail_supported(mime_type: &str) -> bool {
    let mime = mime_type.split(';').next().unwrap_or(mime_type).trim();
    if mime.starts_with("image/") {
        return true;
    }
    matches!(
        mime,
        "application/pdf"
            | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            | "application/msword"
            | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            | "application/vnd.ms-powerpoint"
            | "text/csv"
            | "application/csv"
            | "text/comma-separated-values"
            | "application/x-neutrino-doc"
            | "application/x-neutrino-sheet"
            | "application/x-neutrino-slide"
    )
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/files",
    responses(
        (status = 201, description = "File uploaded successfully", body = FileMetadataResponse),
        (status = 400, description = "No file provided or invalid multipart data"),
        (status = 413, description = "Storage quota exceeded"),
        (status = 429, description = "Daily upload limit exceeded"),
    ),
    security(("bearer_auth" = [])),
    tag = "storage"
)]
#[post("/files/upload")]
pub async fn upload_file(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    mut payload: Multipart,
) -> Result<web::Json<FileMetadataResponse>, ApiError> {
    let mut folder_id: Option<String> = None;
    let mut encrypted_metadata: Option<String> = None;
    let mut explicit_mime_type: Option<String> = None;
    let mut thumbnail_b64: Option<String> = None;

    while let Some(field) = payload.next().await {
        let mut field = field.map_err(|e| {
            tracing::error!("Multipart error: {:?}", e);
            ApiError::bad_request("Invalid multipart data")
        })?;

        let field_name = field
            .content_disposition()
            .and_then(|cd| cd.get_name().map(|s| s.to_string()))
            .unwrap_or_default();

        // Non-file text field — read scalar value
        if field
            .content_disposition()
            .and_then(|cd| cd.get_filename())
            .is_none()
        {
            if matches!(field_name.as_str(), "folder_id" | "encrypted_metadata" | "mime_type" | "thumbnail_b64") {
                let mut buf = Vec::new();
                while let Some(chunk) = field.next().await {
                    let data = chunk.map_err(|e| {
                        tracing::error!("Chunk read error: {:?}", e);
                        ApiError::bad_request("Upload interrupted")
                    })?;
                    buf.extend_from_slice(&data);
                }
                let value = String::from_utf8_lossy(&buf).trim().to_string();
                if !value.is_empty() {
                    match field_name.as_str() {
                        "folder_id" => folder_id = Some(value),
                        "encrypted_metadata" => encrypted_metadata = Some(value),
                        "mime_type" => explicit_mime_type = Some(value),
                        "thumbnail_b64" => {
                            tracing::info!("thumbnail_b64 received, length: {}", value.len());
                            thumbnail_b64 = Some(value);
                        }
                        _ => {}
                    }
                }
            }
            continue;
        }

        let file_name = field
            .content_disposition()
            .and_then(|cd| cd.get_filename())
            .unwrap_or("untitled")
            .to_string();

        let mime_type = explicit_mime_type.take().unwrap_or_else(|| {
            field
                .content_type()
                .map(|m| m.to_string())
                .unwrap_or_else(|| {
                    mime_guess::from_path(&file_name)
                        .first_or_octet_stream()
                        .to_string()
                })
        });

        let temp_id = Uuid::new_v4().to_string();
        state
            .storage_service
            .store()
            .ensure_user_dir(&user.user_id)
            .map_err(ApiError::internal)?;

        let temp_path = state
            .storage_service
            .store()
            .temp_path(&user.user_id, &temp_id);

        let raw_file = tokio::fs::File::create(&temp_path).await.map_err(|e| {
            tracing::error!("Failed to create temp file: {:?}", e);
            ApiError::internal("Failed to initialize upload")
        })?;
        // Buffer writes to reduce backpressure on the network stream.
        // Without this, each ~32 KB chunk causes a blocking disk syscall, stalling
        // the TCP receive window and potentially triggering client/proxy timeouts.
        let mut file = BufWriter::with_capacity(1 << 20, raw_file); // 1 MB write buffer

        let mut size: i64 = 0;
        while let Some(chunk) = field.next().await {
            let data = chunk.map_err(|e| {
                tracing::error!("Chunk read error: {:?}", e);
                ApiError::bad_request("Upload interrupted")
            })?;
            size += data.len() as i64;
            file.write_all(&data).await.map_err(|e| {
                tracing::error!("Write error: {:?}", e);
                ApiError::internal("Failed to write upload data")
            })?;
        }

        file.flush().await.map_err(|e| {
            tracing::error!("Flush error: {:?}", e);
            ApiError::internal("Failed to finalize upload")
        })?;
        drop(file);

        let response = state
            .storage_service
            .finalize_upload(
                &user,
                &temp_path,
                &file_name,
                &mime_type,
                size,
                folder_id.as_deref(),
                encrypted_metadata.as_deref(),
            ).await
            .inspect_err(|_| {
                let _ = std::fs::remove_file(&temp_path);
            })?;

        // Save client-generated thumbnail if provided.
        if let Some(b64) = thumbnail_b64.take() {
            tracing::info!("saving thumbnail for file {}, base64 length: {}", response.id, b64.len());
            match state.storage_service.set_cover_thumbnail(&response.id, b64, "image/jpeg".to_string()) {
                Ok(_) => tracing::info!("thumbnail saved successfully for file {}", response.id),
                Err(e) => tracing::warn!("failed to save thumbnail for {}: {:?}", response.id, e),
            }
        } else {
            tracing::info!("no thumbnail_b64 in upload request for file {}", response.id);
        }

        // Enqueue a thumbnail job for non-image file types that need an external worker
        // (e.g. PDF, Office docs).
        let mime_base = mime_type.split(';').next().unwrap_or(&mime_type).trim();
        if is_thumbnail_supported(&mime_type) && !mime_base.starts_with("image/") {
            let req = CreateJobRequest {
                job_type: "thumbnail".to_string(),
                payload: serde_json::json!({ "fileId": response.id }),
                timeout_secs: 60,
            };
            if let Err(e) = state.jobs_service.create_job(req) {
                tracing::warn!("Failed to enqueue thumbnail job for file {}: {:?}", response.id, e);
            }
        }

        // Enqueue content indexing job (best-effort)
        let job_req = CreateJobRequest {
            job_type: "index_content".to_string(),
            payload: serde_json::json!({
                "fileId": response.id,
                "userId": user.user_id,
            }),
            timeout_secs: 60,
        };
        if let Err(e) = state.jobs_service.create_job(job_req) {
            tracing::warn!("Failed to enqueue index_content job for file {}: {:?}", response.id, e);
        }

        return Ok(web::Json(response));
    }

    Err(ApiError::bad_request("No file provided in multipart body"))
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/files",
    request_body = CreateFileRequest,
    responses(
        (status = 201, description = "File record created", body = DocFileMetadataResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "storage"
)]
#[post("/files")]
pub async fn create_file_record(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateFileRequest>,
) -> Result<HttpResponse, ApiError> {
    let req = body.into_inner();
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad_request("File name cannot be empty"));
    }
    let file = state
        .storage_service
        .save_file(&user, &req.id, &name, &req.mime_type, req.folder_id.as_deref())
        .await?;
    let response = DocFileMetadataResponse {
        id: file.id,
        name: file.name,
        size_bytes: file.size_bytes,
        folder_id: file.folder_id,
        deleted_at: file.deleted_at,
        your_role: "owner".to_string(),
        storage_path: match file.storage_path.len()>1 {true => Some(file.storage_path), _ => None,},    //TODO: Storage path can be None
        mime_type: match file.mime_type.len()>1 {true => Some(file.mime_type), _ => None,},             //TODO: Mime type can be None
        created_at: file.created_at,
        updated_at: file.updated_at,
        cover_thumbnail: file.cover_thumbnail,
        cover_thumbnail_mime_type: file.cover_thumbnail_mime_type,
        tags: vec![],
        encrypted_metadata: file.encrypted_metadata,
    };
    Ok(HttpResponse::Created().json(response))
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{id}/info",
    params(("id" = String, Path, description = "File ID")),
    responses(
        (status = 200, description = "File info with caller's role", body = DocFileMetadataResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "File not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "storage"
)]
#[get("/files/{id}/info")]
pub async fn get_file_info(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<DocFileMetadataResponse>, ApiError> {
    let file_id = path.into_inner();
    let file = state
        .storage_service
        .find_file_any_user(&file_id)?
        .ok_or_else(|| ApiError::not_found("File not found"))?;
    let role = state
        .permissions_service
        .get_effective_role(&user.user_id, "file", &file_id)?
        .ok_or_else(|| ApiError::new(403, "FORBIDDEN", "Access denied"))?;
    let tags = state
        .tags_service
        .get_tag_names_for_file(&file_id, &user.user_id)
        .unwrap_or_default();
    Ok(web::Json(DocFileMetadataResponse {
        id: file.id,
        name: file.name,
        size_bytes: file.size_bytes,
        folder_id: file.folder_id,
        deleted_at: file.deleted_at,
        your_role: role,
        storage_path: match file.storage_path.len()>1 {true => Some(file.storage_path), _ => None,},    //TODO: Storage path can be None
        mime_type: match file.mime_type.len()>1 {true => Some(file.mime_type), _ => None,},             //TODO: Mime type can be None
        created_at: file.created_at,
        updated_at: file.updated_at,
        cover_thumbnail: file.cover_thumbnail,
        cover_thumbnail_mime_type: file.cover_thumbnail_mime_type,
        tags,
        encrypted_metadata: file.encrypted_metadata,
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/files",
    params(
        ("limit" = Option<i64>, Query, description = "Max results per page (default 50)"),
        ("offset" = Option<i64>, Query, description = "Pagination offset"),
        ("orderBy" = Option<FileOrderField>, Query, description = "Sort field"),
        ("direction" = Option<String>, Query, description = "asc or desc"),
    ),
    responses(
        (status = 200, description = "List of files", body = ListFilesResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "storage"
)]
#[get("/files")]
pub async fn list_files(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    query: web::Query<ListQuery<FileOrderField>>,
) -> Result<web::Json<ListFilesResponse>, ApiError> {
    let response = state
        .storage_service
        .list_files(&user.user_id, &query.into_inner())?;
    Ok(web::Json(response))
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{id}/metadata",
    params(("id" = String, Path, description = "File ID")),
    responses(
        (status = 200, description = "File metadata", body = FileMetadataResponse),
        (status = 404, description = "File not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "storage"
)]
#[get("/files/{id}/metadata")]
pub async fn get_file_metadata(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<FileMetadataResponse>, ApiError> {
    let file_id = path.into_inner();
    let metadata = state
        .storage_service
        .get_file_metadata(&user.user_id, &file_id)?;
    Ok(web::Json(metadata))
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{id}",
    params(("id" = String, Path, description = "File ID")),
    responses(
        (status = 200, description = "File content (supports Range requests for resume)"),
        (status = 404, description = "File not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "storage"
)]
#[get("/files/{id}")]
pub async fn download_file(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    req: HttpRequest,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();

    let role = state
        .permissions_service
        .get_effective_role(&user.user_id, "file", &file_id)?
        .ok_or_else(|| ApiError::new(403, "FORBIDDEN", "Access denied"))?;

    // Enforce IRM download restriction based on caller's effective role
    let restrictions = state
        .irm_service
        .get_restrictions("file", &file_id, &role)?;
    if restrictions.restrict_download {
        return Err(ApiError::new(
            403,
            "DOWNLOAD_RESTRICTED",
            "Download is restricted by the file owner's IRM policy",
        ));
    }

    let (file_path, mime_type, file_name) = state
        .storage_service
        .resolve_file_path_by_id(&file_id)?;

    let content_type: mime::Mime = mime_type
        .parse()
        .unwrap_or(mime::APPLICATION_OCTET_STREAM);

    let disposition = actix_web::http::header::ContentDisposition {
        disposition: actix_web::http::header::DispositionType::Attachment,
        parameters: vec![actix_web::http::header::DispositionParam::Filename(
            file_name,
        )],
    };

    let named_file = NamedFile::open(&file_path)
        .map_err(|e| {
            tracing::error!("Failed to open file {:?}: {:?}", file_path, e);
            ApiError::internal("Failed to serve file")
        })?
        .set_content_type(content_type)
        .set_content_disposition(disposition);

    Ok(named_file.into_response(&req))
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{id}/preview",
    params(("id" = String, Path, description = "File ID")),
    responses(
        (status = 200, description = "File content served inline for in-browser preview"),
        (status = 404, description = "File not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "storage"
)]
#[get("/files/{id}/preview")]
pub async fn preview_file(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    req: HttpRequest,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();

    let role = state
        .permissions_service
        .get_effective_role(&user.user_id, "file", &file_id)?
        .ok_or_else(|| ApiError::new(403, "FORBIDDEN", "Access denied"))?;

    // Check IRM print/copy restrictions for this user's role
    let restrict_print_copy = state
        .irm_service
        .get_restrictions("file", &file_id, &role)?
        .restrict_print_copy;

    let (file_path, mime_type, _) = state
        .storage_service
        .resolve_file_path_by_id(&file_id)?;

    let content_type: mime::Mime = mime_type
        .parse()
        .unwrap_or(mime::APPLICATION_OCTET_STREAM);

    let disposition = actix_web::http::header::ContentDisposition {
        disposition: actix_web::http::header::DispositionType::Inline,
        parameters: vec![],
    };

    let named_file = NamedFile::open(&file_path)
        .map_err(|e| {
            tracing::error!("Failed to open file {:?}: {:?}", file_path, e);
            ApiError::internal("Failed to serve file")
        })?
        .set_content_type(content_type)
        .set_content_disposition(disposition);

    let mut response = named_file.into_response(&req);
    if restrict_print_copy {
        let headers = response.headers_mut();
        headers.insert(
            actix_web::http::header::HeaderName::from_static("x-irm-restrict-print"),
            actix_web::http::header::HeaderValue::from_static("true"),
        );
        headers.insert(
            actix_web::http::header::HeaderName::from_static("x-irm-restrict-copy"),
            actix_web::http::header::HeaderValue::from_static("true"),
        );
    }
    Ok(response)
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{id}/zip-contents",
    params(
        ("id" = String, Path, description = "File ID (must be a ZIP archive)"),
        ("limit" = Option<i64>, Query, description = "Max results per page"),
        ("offset" = Option<i64>, Query, description = "Pagination offset"),
        ("orderBy" = Option<ZipEntryOrderField>, Query, description = "Sort field"),
        ("direction" = Option<String>, Query, description = "asc or desc"),
    ),
    responses(
        (status = 200, description = "ZIP archive entry listing", body = ZipContentsResponse),
        (status = 400, description = "File is not a valid ZIP archive"),
        (status = 404, description = "File not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "storage"
)]
#[get("/files/{id}/zip-contents")]
pub async fn zip_contents(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    query: web::Query<ListQueryParams<ZipEntryOrderField>>,
) -> Result<web::Json<ZipContentsResponse>, ApiError> {
    let file_id = path.into_inner();

    state
        .permissions_service
        .get_effective_role(&user.user_id, "file", &file_id)?
        .ok_or_else(|| ApiError::new(403, "FORBIDDEN", "Access denied"))?;

    let (file_path, _, _) = state
        .storage_service
        .resolve_file_path_by_id(&file_id)?;

    let entries = web::block(move || {
        let file = std::fs::File::open(&file_path).map_err(|e| {
            tracing::error!("Failed to open ZIP file {:?}: {:?}", file_path, e);
            ApiError::internal("Failed to open file")
        })?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|_| ApiError::new(400, "INVALID_ZIP", "File is not a valid ZIP archive"))?;
        let entries = (0..archive.len())
            .map(|i| {
                archive.by_index(i).map(|entry| ZipEntry {
                    name: entry.name().to_string(),
                    size: entry.size(),
                    compressed_size: entry.compressed_size(),
                    is_dir: entry.is_dir(),
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| ApiError::internal("Failed to read ZIP entries"))?;
        Ok::<Vec<ZipEntry>, ApiError>(entries)
    })
    .await
    .map_err(|_| ApiError::internal("Failed to read ZIP archive"))??;

    let entries = apply_list_query(
        entries,
        &query,
        ZipEntryOrderField::Name,
        OrderDirection::Asc,
        |a, b, order_by| match order_by {
            ZipEntryOrderField::Name => a.name.cmp(&b.name),
            ZipEntryOrderField::Size => a.size.cmp(&b.size),
            ZipEntryOrderField::CompressedSize => a.compressed_size.cmp(&b.compressed_size),
            ZipEntryOrderField::IsDir => a.is_dir.cmp(&b.is_dir),
        },
    );

    Ok(web::Json(ZipContentsResponse { entries }))
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/quota",
    responses(
        (status = 200, description = "Current user quota usage", body = QuotaResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "storage"
)]
#[get("/quota")]
pub async fn get_quota(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<QuotaResponse>, ApiError> {
    let quota = state.storage_service.get_quota(&user.user_id)?;
    Ok(web::Json(quota))
}

#[utoipa::path(
    put,
    path = "/api/v1/drive/files/{id}/autosave",
    params(("id" = String, Path, description = "File ID")),
    responses(
        (status = 200, description = "File autosaved", body = FileMetadataResponse),
        (status = 403, description = "Edit access required"),
        (status = 404, description = "File not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "storage"
)]
#[put("/files/{id}/autosave")]
pub async fn autosave_file(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    mut payload: Multipart,
) -> Result<web::Json<FileMetadataResponse>, ApiError> {
    let file_id = path.into_inner();

    let role = state
        .permissions_service
        .get_effective_role(&user.user_id, "file", &file_id)?
        .ok_or_else(|| ApiError::new(403, "FORBIDDEN", "Access denied"))?;
    if role != "owner" && role != "editor" {
        return Err(ApiError::new(403, "FORBIDDEN", "Edit access required"));
    }

    while let Some(field) = payload.next().await {
        let mut field = field.map_err(|e| {
            tracing::error!("Multipart error: {:?}", e);
            ApiError::bad_request("Invalid multipart data")
        })?;

        if field
            .content_disposition()
            .and_then(|cd| cd.get_filename())
            .is_none()
        {
            continue;
        }

        let temp_id = Uuid::new_v4().to_string();
        state
            .storage_service
            .store()
            .ensure_user_dir(&user.user_id)
            .map_err(ApiError::internal)?;

        let temp_path = state
            .storage_service
            .store()
            .temp_path(&user.user_id, &temp_id);

        let raw_file = tokio::fs::File::create(&temp_path).await.map_err(|e| {
            tracing::error!("Failed to create temp file: {:?}", e);
            ApiError::internal("Failed to initialize autosave")
        })?;
        let mut file = BufWriter::with_capacity(1 << 20, raw_file);

        let mut size: i64 = 0;
        while let Some(chunk) = field.next().await {
            let data = chunk.map_err(|e| {
                tracing::error!("Chunk read error: {:?}", e);
                ApiError::bad_request("Upload interrupted")
            })?;
            size += data.len() as i64;
            file.write_all(&data).await.map_err(|e| {
                tracing::error!("Write error: {:?}", e);
                ApiError::internal("Failed to write autosave data")
            })?;
        }

        file.flush().await.map_err(|e| {
            tracing::error!("Flush error: {:?}", e);
            ApiError::internal("Failed to finalize autosave")
        })?;
        drop(file);

        let response = state
            .storage_service
            .autosave(&file_id, &temp_path, size)
            .inspect_err(|_| {
                let _ = std::fs::remove_file(&temp_path);
            })?;

        return Ok(web::Json(response));
    }

    Err(ApiError::bad_request("No file provided in multipart body"))
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/files/{id}/versions",
    params(("id" = String, Path, description = "File ID")),
    responses(
        (status = 201, description = "Named version saved", body = FileVersionResponse),
        (status = 403, description = "Edit access required"),
        (status = 404, description = "File not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "versioning"
)]
#[post("/files/{id}/versions")]
pub async fn save_version(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    mut payload: Multipart,
) -> Result<web::Json<FileVersionResponse>, ApiError> {
    let file_id = path.into_inner();

    let role = state
        .permissions_service
        .get_effective_role(&user.user_id, "file", &file_id)?
        .ok_or_else(|| ApiError::new(403, "FORBIDDEN", "Access denied"))?;
    if role != "owner" && role != "editor" {
        return Err(ApiError::new(403, "FORBIDDEN", "Edit access required"));
    }

    let mut label: Option<String> = None;

    while let Some(field) = payload.next().await {
        let mut field = field.map_err(|e| {
            tracing::error!("Multipart error: {:?}", e);
            ApiError::bad_request("Invalid multipart data")
        })?;

        let field_name = field
            .content_disposition()
            .and_then(|cd| cd.get_name().map(|s| s.to_string()))
            .unwrap_or_default();

        // Non-file text field — read scalar value
        if field
            .content_disposition()
            .and_then(|cd| cd.get_filename())
            .is_none()
        {
            if field_name == "label" {
                let mut buf = Vec::new();
                while let Some(chunk) = field.next().await {
                    let data = chunk.map_err(|e| {
                        tracing::error!("Chunk read error: {:?}", e);
                        ApiError::bad_request("Upload interrupted")
                    })?;
                    buf.extend_from_slice(&data);
                }
                let value = String::from_utf8_lossy(&buf).trim().to_string();
                if !value.is_empty() {
                    label = Some(value);
                }
            }
            continue;
        }

        let temp_id = Uuid::new_v4().to_string();
        state
            .storage_service
            .store()
            .ensure_user_dir(&user.user_id)
            .map_err(ApiError::internal)?;

        let temp_path = state
            .storage_service
            .store()
            .temp_path(&user.user_id, &temp_id);

        let raw_file = tokio::fs::File::create(&temp_path).await.map_err(|e| {
            tracing::error!("Failed to create temp file: {:?}", e);
            ApiError::internal("Failed to initialize version save")
        })?;
        let mut file = BufWriter::with_capacity(1 << 20, raw_file);

        let mut size: i64 = 0;
        while let Some(chunk) = field.next().await {
            let data = chunk.map_err(|e| {
                tracing::error!("Chunk read error: {:?}", e);
                ApiError::bad_request("Upload interrupted")
            })?;
            size += data.len() as i64;
            file.write_all(&data).await.map_err(|e| {
                tracing::error!("Write error: {:?}", e);
                ApiError::internal("Failed to write version data")
            })?;
        }

        file.flush().await.map_err(|e| {
            tracing::error!("Flush error: {:?}", e);
            ApiError::internal("Failed to finalize version save")
        })?;
        drop(file);

        let response = state
            .storage_service
            .save_named_version(&file_id, &temp_path, size, label.as_deref())
            .inspect_err(|_| {
                let _ = std::fs::remove_file(&temp_path);
            })?;

        return Ok(web::Json(response));
    }

    Err(ApiError::bad_request("No file provided in multipart body"))
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{id}/versions",
    params(
        ("id" = String, Path, description = "File ID"),
        ("limit" = Option<i64>, Query, description = "Max results per page"),
        ("offset" = Option<i64>, Query, description = "Pagination offset"),
        ("orderBy" = Option<VersionOrderField>, Query, description = "Sort field"),
        ("direction" = Option<String>, Query, description = "asc or desc"),
    ),
    responses(
        (status = 200, description = "Version history", body = ListVersionsResponse),
        (status = 404, description = "File not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "versioning"
)]
#[get("/files/{id}/versions")]
pub async fn list_versions(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    query: web::Query<ListQueryParams<VersionOrderField>>,
) -> Result<web::Json<ListVersionsResponse>, ApiError> {
    let file_id = path.into_inner();
    let response = state
        .storage_service
        .list_versions(&user.user_id, &file_id, &query)?;
    Ok(web::Json(response))
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{id}/versions/{vid}",
    params(
        ("id" = String, Path, description = "File ID"),
        ("vid" = String, Path, description = "Version ID"),
    ),
    responses(
        (status = 200, description = "Version metadata", body = FileVersionResponse),
        (status = 404, description = "File or version not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "versioning"
)]
#[get("/files/{id}/versions/{vid}")]
pub async fn get_version(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<web::Json<FileVersionResponse>, ApiError> {
    let (file_id, version_id) = path.into_inner();
    let response = state
        .storage_service
        .get_version(&user.user_id, &file_id, &version_id)?;
    Ok(web::Json(response))
}

#[utoipa::path(
    patch,
    path = "/api/v1/drive/files/{id}/versions/{vid}",
    params(
        ("id" = String, Path, description = "File ID"),
        ("vid" = String, Path, description = "Version ID"),
    ),
    request_body = UpdateVersionLabelRequest,
    responses(
        (status = 200, description = "Version label updated", body = FileVersionResponse),
        (status = 404, description = "File or version not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "versioning"
)]
#[patch("/files/{id}/versions/{vid}")]
pub async fn update_version_label(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
    body: web::Json<UpdateVersionLabelRequest>,
) -> Result<web::Json<FileVersionResponse>, ApiError> {
    let (file_id, version_id) = path.into_inner();
    let response = state.storage_service.update_version_label(
        &user.user_id,
        &file_id,
        &version_id,
        body.into_inner().label,
    )?;
    Ok(web::Json(response))
}

#[utoipa::path(
    post,
    path = "/api/v1/drive/files/{id}/versions/{vid}/restore",
    params(
        ("id" = String, Path, description = "File ID"),
        ("vid" = String, Path, description = "Version ID"),
    ),
    responses(
        (status = 200, description = "File restored to version", body = FileMetadataResponse),
        (status = 404, description = "File or version not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "versioning"
)]
#[post("/files/{id}/versions/{vid}/restore")]
pub async fn restore_version(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<web::Json<FileMetadataResponse>, ApiError> {
    let (file_id, version_id) = path.into_inner();
    let response = state
        .storage_service
        .restore_version(&user.user_id, &file_id, &version_id)?;
    Ok(web::Json(response))
}

#[utoipa::path(
    get,
    path = "/api/v1/drive/files/{id}/versions/{vid}/download",
    params(
        ("id" = String, Path, description = "File ID"),
        ("vid" = String, Path, description = "Version ID"),
    ),
    responses(
        (status = 200, description = "Version content as file download"),
        (status = 404, description = "File or version not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "versioning"
)]
#[get("/files/{id}/versions/{vid}/download")]
pub async fn download_version(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, ApiError> {
    let (file_id, version_id) = path.into_inner();
    let (file_path, mime_type, file_name) = state
        .storage_service
        .resolve_version_path(&user.user_id, &file_id, &version_id)?;

    let content_type: mime::Mime = mime_type
        .parse()
        .unwrap_or(mime::APPLICATION_OCTET_STREAM);

    let disposition = actix_web::http::header::ContentDisposition {
        disposition: actix_web::http::header::DispositionType::Attachment,
        parameters: vec![actix_web::http::header::DispositionParam::Filename(
            file_name,
        )],
    };

    let named_file = NamedFile::open(&file_path)
        .map_err(|e| {
            tracing::error!("Failed to open version file {:?}: {:?}", file_path, e);
            ApiError::internal("Failed to serve version content")
        })?
        .set_content_type(content_type)
        .set_content_disposition(disposition);

    Ok(named_file.into_response(&req))
}

#[utoipa::path(
    delete,
    path = "/api/v1/drive/files/{id}/versions/{vid}",
    params(
        ("id" = String, Path, description = "File ID"),
        ("vid" = String, Path, description = "Version ID"),
    ),
    responses(
        (status = 204, description = "Version deleted"),
        (status = 404, description = "File or version not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "versioning"
)]
#[delete("/files/{id}/versions/{vid}")]
pub async fn delete_version(
    state: web::Data<StorageApiState>,
    user: AuthenticatedUser,
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (file_id, version_id) = path.into_inner();
    state
        .storage_service
        .delete_version(&user.user_id, &file_id, &version_id)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(upload_file)
        .service(create_file_record)
        .service(get_file_info)
        .service(list_files)
        .service(get_file_metadata)
        .service(preview_file)
        .service(zip_contents)
        .service(download_file)
        .service(get_quota)
        .service(autosave_file)
        .service(save_version)
        .service(list_versions)
        .service(get_version)
        .service(update_version_label)
        .service(restore_version)
        .service(download_version)
        .service(delete_version);
}

#[derive(OpenApi)]
#[openapi(
    paths(
        upload_file, create_file_record, get_file_info, list_files, get_file_metadata,
        preview_file, zip_contents, download_file, get_quota, autosave_file, save_version,
        list_versions, get_version, update_version_label, restore_version, download_version, delete_version,
    ),
    components(schemas(
        FileMetadataResponse,
        FileOrderField,
        ListFilesResponse,
        QuotaResponse,
        ZipContentsResponse,
        ZipEntry,
        ZipEntryOrderField,
        FileVersionResponse,
        ListVersionsResponse,
        VersionOrderField,
        UpdateVersionLabelRequest,
        SaveVersionRequest,
        CreateFileRequest,
        DocFileMetadataResponse,
    )),
    tags(
        (name = "storage", description = "File storage endpoints"),
        (name = "versioning", description = "File version history endpoints"),
    ),
    modifiers(&SecurityAddon)
)]
pub struct StorageApiDoc;

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
