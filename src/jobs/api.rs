use std::sync::Arc;

use actix_web::dev::Payload;
use actix_web::FromRequest;
use actix_web::{delete, get, patch, post, put, web, HttpRequest, HttpResponse};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use std::future::{ready, Ready};

use crate::drive::jobs::{
    dto::{
        CreateJobRequest, JobResponse, PendingJobsQuery, RegisterWorkerRequest,
        RegisterWorkerResponse, UpdateJobRequest, UpdateJobStatusRequest,
    },
    service::JobsService,
};
use crate::drive::storage::service::StorageService;
use crate::shared::{ApiError, AuthenticatedUser};

// ── Worker auth ───────────────────────────────────────────────────────────────

/// Newtype wrapper so it can be registered as app data without conflicting with String.
pub struct WorkerSecretData(pub String);

/// Extractor that validates `Authorization: Bearer <WORKER_SECRET>`.
struct WorkerAuth;

impl FromRequest for WorkerAuth {
    type Error = ApiError;
    type Future = Ready<Result<Self, Self::Error>>;

    fn from_request(req: &HttpRequest, _payload: &mut Payload) -> Self::Future {
        let expected = req
            .app_data::<web::Data<WorkerSecretData>>()
            .map(|s| s.0.as_str().to_owned());

        let provided = req
            .headers()
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|s| s.to_owned());

        let ok = match (expected, provided) {
            (Some(exp), Some(prov)) => exp == prov,
            _ => false,
        };

        if ok {
            ready(Ok(WorkerAuth))
        } else {
            ready(Err(ApiError::new(
                401,
                "UNAUTHORIZED",
                "Invalid worker secret",
            )))
        }
    }
}

// ── App state ─────────────────────────────────────────────────────────────────

pub struct JobsApiState {
    pub jobs_service: Arc<JobsService>,
    pub storage_service: Arc<StorageService>,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// Create a job (called by other services, e.g. photos when a photo is registered).
#[utoipa::path(
    post,
    path = "/api/v1/jobs",
    request_body = CreateJobRequest,
    responses(
        (status = 200, description = "Job created", body = JobResponse),
        (status = 401, description = "Invalid worker secret"),
    ),
    tag = "drive-jobs"
)]
#[post("/jobs")]
async fn create_job(
    state: web::Data<JobsApiState>,
    _auth: WorkerAuth,
    body: web::Json<CreateJobRequest>,
) -> Result<web::Json<JobResponse>, ApiError> {
    let resp = state.jobs_service.create_job(body.into_inner())?;
    Ok(web::Json(resp))
}

/// List all jobs in the table (newest first).
#[utoipa::path(
    get,
    path = "/api/v1/jobs",
    responses(
        (status = 200, description = "List of jobs", body = Vec<JobResponse>),
        (status = 401, description = "Unauthorized"),
    ),
    tag = "drive-jobs"
)]
#[get("/jobs")]
async fn list_jobs(
    state: web::Data<JobsApiState>,
    _user: AuthenticatedUser,
) -> Result<web::Json<Vec<JobResponse>>, ApiError> {
    Ok(web::Json(state.jobs_service.list_jobs()?))
}

/// Fetch a single job by ID.
#[utoipa::path(
    get,
    path = "/api/v1/jobs/{id}",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 200, description = "The job", body = JobResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Job not found"),
    ),
    tag = "drive-jobs"
)]
#[get("/jobs/{id}")]
async fn get_job(
    state: web::Data<JobsApiState>,
    _user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<JobResponse>, ApiError> {
    Ok(web::Json(state.jobs_service.get_job(&path.into_inner())?))
}

/// Update a job's mutable fields (partial update; omitted fields are unchanged).
#[utoipa::path(
    put,
    path = "/api/v1/jobs/{id}",
    params(("id" = String, Path, description = "Job ID")),
    request_body = UpdateJobRequest,
    responses(
        (status = 200, description = "The updated job", body = JobResponse),
        (status = 400, description = "Invalid field value"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Job not found"),
    ),
    tag = "drive-jobs"
)]
#[put("/jobs/{id}")]
async fn update_job(
    state: web::Data<JobsApiState>,
    _user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<UpdateJobRequest>,
) -> Result<web::Json<JobResponse>, ApiError> {
    let resp = state
        .jobs_service
        .update_job(&path.into_inner(), body.into_inner())?;
    Ok(web::Json(resp))
}

/// Delete a job by ID.
#[utoipa::path(
    delete,
    path = "/api/v1/jobs/{id}",
    params(("id" = String, Path, description = "Job ID")),
    responses(
        (status = 204, description = "Job deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Job not found"),
    ),
    tag = "drive-jobs"
)]
#[delete("/jobs/{id}")]
async fn delete_job(
    state: web::Data<JobsApiState>,
    _user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state.jobs_service.delete_job(&path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

/// Worker pulls up to `limit` pending jobs on startup and claims them immediately.
#[utoipa::path(
    get,
    path = "/api/v1/jobs/pending",
    params(
        ("limit" = Option<i64>, Query, description = "Maximum number of jobs to claim"),
    ),
    responses(
        (status = 200, description = "List of claimed pending jobs", body = Vec<JobResponse>),
        (status = 401, description = "Invalid worker secret"),
    ),
    tag = "drive-jobs"
)]
#[get("/jobs/pending")]
async fn get_pending_jobs(
    state: web::Data<JobsApiState>,
    _auth: WorkerAuth,
    query: web::Query<PendingJobsQuery>,
    req: HttpRequest,
) -> Result<web::Json<Vec<JobResponse>>, ApiError> {
    // Worker ID comes from a header so drive knows which worker is claiming.
    let worker_id = req
        .headers()
        .get("X-Worker-Id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_owned();
    let limit = query.limit.unwrap_or(4).min(100);
    let jobs = state.jobs_service.claim_pending_jobs(&worker_id, limit)?;
    Ok(web::Json(jobs))
}

/// Worker reports job completion (status C) or failure (status E).
#[utoipa::path(
    patch,
    path = "/api/v1/jobs/{id}/status",
    params(("id" = String, Path, description = "Job ID")),
    request_body = UpdateJobStatusRequest,
    responses(
        (status = 204, description = "Job status updated"),
        (status = 401, description = "Invalid worker secret"),
        (status = 404, description = "Job not found"),
    ),
    tag = "drive-jobs"
)]
#[patch("/jobs/{id}/status")]
async fn update_job_status(
    state: web::Data<JobsApiState>,
    _auth: WorkerAuth,
    path: web::Path<String>,
    body: web::Json<UpdateJobStatusRequest>,
) -> Result<HttpResponse, ApiError> {
    state
        .jobs_service
        .update_job_status(&path.into_inner(), body.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

/// Worker fetches raw file bytes to process (e.g. generate a thumbnail).
#[utoipa::path(
    get,
    path = "/api/v1/jobs/file-content/{file_id}",
    params(("file_id" = String, Path, description = "File ID")),
    responses(
        (status = 200, description = "Raw file bytes with appropriate Content-Type"),
        (status = 401, description = "Invalid worker secret"),
        (status = 404, description = "File not found"),
    ),
    tag = "drive-jobs"
)]
#[get("/jobs/file-content/{file_id}")]
async fn get_file_content(
    state: web::Data<JobsApiState>,
    _auth: WorkerAuth,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let (bytes, mime_type) = state
        .jobs_service
        .get_file_content(&path.into_inner())
        .await?;
    Ok(HttpResponse::Ok().content_type(mime_type).body(bytes))
}

/// Worker registers itself and provides a callback URL for job dispatch.
#[utoipa::path(
    post,
    path = "/api/v1/jobs/workers",
    request_body = RegisterWorkerRequest,
    responses(
        (status = 200, description = "Worker registered", body = RegisterWorkerResponse),
        (status = 401, description = "Invalid worker secret"),
    ),
    tag = "drive-jobs"
)]
#[post("/jobs/workers")]
async fn register_worker(
    state: web::Data<JobsApiState>,
    _auth: WorkerAuth,
    body: web::Json<RegisterWorkerRequest>,
) -> Result<web::Json<RegisterWorkerResponse>, ApiError> {
    let worker_id = state.jobs_service.register_worker(&body.callback_url)?;
    Ok(web::Json(RegisterWorkerResponse { worker_id }))
}

/// Worker deregisters itself (clean shutdown).
#[utoipa::path(
    delete,
    path = "/api/v1/jobs/workers/{id}",
    params(("id" = String, Path, description = "Worker ID")),
    responses(
        (status = 204, description = "Worker deregistered"),
        (status = 401, description = "Invalid worker secret"),
    ),
    tag = "drive-jobs"
)]
#[delete("/jobs/workers/{id}")]
async fn deregister_worker(
    state: web::Data<JobsApiState>,
    _auth: WorkerAuth,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    state.jobs_service.deregister_worker(&path.into_inner())?;
    Ok(HttpResponse::NoContent().finish())
}

/// Worker uploads a generated cover thumbnail for a file.
/// Accepts image bytes as the raw request body; Content-Type is used as MIME type.
#[utoipa::path(
    put,
    path = "/api/v1/jobs/files/{file_id}/thumbnail",
    params(("file_id" = String, Path, description = "File ID")),
    responses(
        (status = 204, description = "Thumbnail stored"),
        (status = 401, description = "Invalid worker secret"),
    ),
    tag = "drive-jobs"
)]
#[put("/jobs/files/{file_id}/thumbnail")]
async fn put_file_thumbnail(
    state: web::Data<JobsApiState>,
    _auth: WorkerAuth,
    path: web::Path<String>,
    req: HttpRequest,
    body: web::Bytes,
) -> Result<HttpResponse, ApiError> {
    let file_id = path.into_inner();
    let mime_type = req
        .headers()
        .get("Content-Type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let b64 = BASE64.encode(&body);
    state
        .storage_service
        .set_cover_thumbnail(&file_id, b64, mime_type)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    // Register static-path routes before the dynamic `/jobs/{id}` routes so the
    // latter don't shadow paths like `/jobs/pending` or `/jobs/workers`.
    cfg.service(create_job)
        .service(list_jobs)
        .service(get_pending_jobs)
        .service(update_job_status)
        .service(get_file_content)
        .service(put_file_thumbnail)
        .service(register_worker)
        .service(deregister_worker)
        .service(get_job)
        .service(update_job)
        .service(delete_job);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(
        create_job,
        list_jobs,
        get_job,
        update_job,
        delete_job,
        get_pending_jobs,
        update_job_status,
        get_file_content,
        register_worker,
        deregister_worker,
        put_file_thumbnail,
    ),
    components(schemas(
        CreateJobRequest,
        JobResponse,
        UpdateJobRequest,
        UpdateJobStatusRequest,
        RegisterWorkerRequest,
        RegisterWorkerResponse,
        PendingJobsQuery,
    )),
    tags((name = "drive-jobs", description = "Drive background jobs endpoints"))
)]
pub struct JobsApiDoc;
