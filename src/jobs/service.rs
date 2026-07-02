use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};

use chrono::Utc;
use uuid::Uuid;

use crate::jobs::{
    dto::{CreateJobRequest, JobResponse, UpdateJobRequest, UpdateJobStatusRequest},
    model::{NewWorkerJobRecord, NewWorkerRegistrationRecord, WorkerJobChanges, WorkerJobRecord},
    repository::JobsRepository,
};
use crate::shared::ApiError;

/// Consecutive failures needed before a worker is deregistered.
const MAX_WORKER_FAILURES: u32 = 3;

pub struct JobsService {
    repo: Arc<JobsRepository>,
    storage_path: String,
    /// Maximum jobs to fetch per registered worker each dispatch cycle.
    jobs_per_worker: usize,
    dispatch_counter: AtomicUsize,
    /// Tracks consecutive dispatch failures per worker_id.
    worker_failures: Mutex<HashMap<String, u32>>,
    http: reqwest::Client,
}

impl JobsService {
    pub fn new(repo: Arc<JobsRepository>, storage_path: String, jobs_per_worker: usize) -> Self {
        JobsService {
            repo,
            storage_path,
            jobs_per_worker,
            dispatch_counter: AtomicUsize::new(0),
            worker_failures: Mutex::new(HashMap::new()),
            http: reqwest::Client::new(),
        }
    }

    // ── Job management ────────────────────────────────────────────────────────

    pub fn create_job(&self, req: CreateJobRequest) -> Result<JobResponse, ApiError> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().naive_utc();
        let payload_str = req.payload.to_string();
        let record = NewWorkerJobRecord {
            id: &id,
            job_type: &req.job_type,
            payload: &payload_str,
            status: "R",
            timeout_secs: req.timeout_secs,
            created_at: now,
            updated_at: now,
        };
        let job = self.repo.insert_job(record)?;
        Ok(self.to_response(&job))
    }

    pub fn list_jobs(&self) -> Result<Vec<JobResponse>, ApiError> {
        let jobs = self.repo.list_jobs()?;
        Ok(jobs.iter().map(|j| self.to_response(j)).collect())
    }

    pub fn get_job(&self, job_id: &str) -> Result<JobResponse, ApiError> {
        let job = self.repo.get_job(job_id)?;
        Ok(self.to_response(&job))
    }

    pub fn update_job(&self, job_id: &str, req: UpdateJobRequest) -> Result<JobResponse, ApiError> {
        if let Some(status) = &req.status {
            if !matches!(status.as_str(), "R" | "I" | "C" | "E") {
                return Err(ApiError::bad_request("status must be 'R', 'I', 'C' or 'E'"));
            }
        }
        // `payload` is stored as a JSON string; serialize it once and borrow below.
        let payload_str = req.payload.as_ref().map(|p| p.to_string());
        let changes = WorkerJobChanges {
            job_type: req.job_type.as_deref(),
            payload: payload_str.as_deref(),
            status: req.status.as_deref(),
            timeout_secs: req.timeout_secs,
            error_message: req.error_message.as_ref().map(|m| Some(m.as_str())),
            updated_at: Utc::now().naive_utc(),
        };
        let job = self.repo.update_job(job_id, changes)?;
        Ok(self.to_response(&job))
    }

    pub fn delete_job(&self, job_id: &str) -> Result<(), ApiError> {
        self.repo.delete_job(job_id)
    }

    pub fn claim_pending_jobs(
        &self,
        worker_id: &str,
        limit: i64,
    ) -> Result<Vec<JobResponse>, ApiError> {
        let jobs = self.repo.claim_pending_jobs(worker_id, limit)?;
        Ok(jobs.iter().map(|j| self.to_response(j)).collect())
    }

    pub fn update_job_status(
        &self,
        job_id: &str,
        req: UpdateJobStatusRequest,
    ) -> Result<(), ApiError> {
        if req.status != "C" && req.status != "E" {
            return Err(ApiError::bad_request("status must be 'C' or 'E'"));
        }
        self.repo
            .update_job_status(job_id, &req.status, req.error_message.as_deref())
    }

    // ── Worker registration ───────────────────────────────────────────────────

    pub fn register_worker(&self, callback_url: &str) -> Result<String, ApiError> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().naive_utc();
        let rec = NewWorkerRegistrationRecord {
            id: &id,
            callback_url,
            registered_at: now,
            last_seen_at: now,
        };
        self.repo.register_worker(rec)?;
        Ok(id)
    }

    pub fn deregister_worker(&self, worker_id: &str) -> Result<(), ApiError> {
        self.clear_worker_failures(worker_id);
        self.repo.deregister_worker(worker_id)
    }

    // ── File content (for workers to fetch image bytes) ───────────────────────

    pub async fn get_file_content(&self, file_id: &str) -> Result<(Vec<u8>, String), ApiError> {
        let (storage_path, mime_type) = self.repo.get_file_info(file_id)?;
        let full_path = std::path::Path::new(&self.storage_path).join(&storage_path);
        let bytes = tokio::fs::read(&full_path).await.map_err(|e| {
            tracing::error!("Failed to read file {:?}: {:?}", full_path, e);
            ApiError::internal("Failed to read file content")
        })?;
        Ok((bytes, mime_type))
    }

    // ── Background task ───────────────────────────────────────────────────────

    /// Called by the background loop: reset timed-out jobs, then push ready jobs.
    pub async fn process_background_tasks(&self) {
        self.reset_timed_out_jobs().await;
        self.dispatch_ready_jobs().await;
    }

    async fn reset_timed_out_jobs(&self) {
        let repo = self.repo.clone();
        let timed_out = tokio::task::spawn_blocking(move || repo.get_timed_out_jobs())
            .await
            .unwrap_or_else(|e| {
                tracing::error!("Panic in get_timed_out_jobs: {:?}", e);
                Ok(vec![])
            })
            .unwrap_or_default();

        for job in &timed_out {
            let repo = self.repo.clone();
            let id = job.id.clone();
            if let Err(e) = tokio::task::spawn_blocking(move || repo.reset_to_ready(&id)).await {
                tracing::error!("Panic resetting job {}: {:?}", job.id, e);
            } else {
                tracing::info!("Reset timed-out job {} to R", job.id);
            }
        }
    }

    async fn dispatch_ready_jobs(&self) {
        // Fetch workers first so we can compute the job fetch limit.
        let repo = self.repo.clone();
        let workers = tokio::task::spawn_blocking(move || repo.list_workers())
            .await
            .unwrap_or_else(|_| Ok(vec![]))
            .unwrap_or_default();

        if workers.is_empty() {
            return;
        }

        let limit = (workers.len() * self.jobs_per_worker) as i64;
        let repo = self.repo.clone();
        let ready = tokio::task::spawn_blocking(move || repo.get_ready_jobs(limit))
            .await
            .unwrap_or_else(|_| Ok(vec![]))
            .unwrap_or_default();

        if ready.is_empty() {
            return;
        }

        for job in &ready {
            self.dispatch_one_job(job, &workers).await;
        }
    }

    async fn dispatch_one_job(
        &self,
        job: &WorkerJobRecord,
        workers: &[crate::jobs::model::WorkerRegistrationRecord],
    ) {
        let n = workers.len();
        let start = self.dispatch_counter.fetch_add(1, Ordering::Relaxed) % n;

        for i in 0..n {
            let worker = &workers[(start + i) % n];

            // Atomically claim the job for this worker before POSTing.
            let repo = self.repo.clone();
            let job_id = job.id.clone();
            let worker_id = worker.id.clone();
            let claimed =
                tokio::task::spawn_blocking(move || repo.try_claim_job(&job_id, &worker_id))
                    .await
                    .unwrap_or(Ok(false))
                    .unwrap_or(false);

            if !claimed {
                return; // Another dispatch already claimed this job.
            }

            let dto = self.to_response(job);
            let dispatch_result = self.http.post(&worker.callback_url).json(&dto).send().await;

            match dispatch_result {
                Ok(resp) if resp.status().is_success() => {
                    self.clear_worker_failures(&worker.id);
                    tracing::info!("Dispatched job {} to worker {}", job.id, worker.id);
                    return;
                }
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_server_error() {
                        let failures = self.record_worker_failure(&worker.id);
                        if failures >= MAX_WORKER_FAILURES {
                            tracing::error!(
                                "Worker {} returned {} {} times — deregistering",
                                worker.id,
                                status,
                                MAX_WORKER_FAILURES
                            );
                            self.force_deregister_worker(&worker.id).await;
                        } else {
                            tracing::warn!(
                                "Worker {} returned {} for job {} (failure {}/{})",
                                worker.id,
                                status,
                                job.id,
                                failures,
                                MAX_WORKER_FAILURES
                            );
                        }
                    } else {
                        // 4xx means the worker rejected it — don't count as worker failure.
                        tracing::warn!(
                            "Worker {} returned {} for job {} — not retrying",
                            worker.id,
                            status,
                            job.id
                        );
                        return;
                    }
                }
                Err(e) => {
                    let failures = self.record_worker_failure(&worker.id);
                    if failures >= MAX_WORKER_FAILURES {
                        tracing::error!(
                            "Worker {} unreachable {} times: {} — deregistering",
                            worker.id,
                            MAX_WORKER_FAILURES,
                            e
                        );
                        self.force_deregister_worker(&worker.id).await;
                    } else {
                        tracing::warn!(
                            "Failed to reach worker {} for job {} (failure {}/{}): {}",
                            worker.id,
                            job.id,
                            failures,
                            MAX_WORKER_FAILURES,
                            e
                        );
                    }
                }
            }

            // Dispatch failed — reset job back to R and try the next worker.
            let repo = self.repo.clone();
            let id = job.id.clone();
            let _ = tokio::task::spawn_blocking(move || repo.reset_to_ready(&id)).await;
        }
    }

    // ── Worker failure tracking ───────────────────────────────────────────────

    /// Increment failure count for a worker; returns the new count.
    fn record_worker_failure(&self, worker_id: &str) -> u32 {
        if let Ok(mut map) = self.worker_failures.lock() {
            let count = map.entry(worker_id.to_string()).or_insert(0);
            *count += 1;
            *count
        } else {
            1
        }
    }

    fn clear_worker_failures(&self, worker_id: &str) {
        if let Ok(mut map) = self.worker_failures.lock() {
            map.remove(worker_id);
        }
    }

    /// Deregister a worker from the DB and clear its in-memory failure state.
    async fn force_deregister_worker(&self, worker_id: &str) {
        self.clear_worker_failures(worker_id);
        let repo = self.repo.clone();
        let id = worker_id.to_string();
        if let Err(e) = tokio::task::spawn_blocking(move || repo.deregister_worker(&id)).await {
            tracing::error!("Panic deregistering worker {}: {:?}", worker_id, e);
        }
    }

    fn to_response(&self, job: &WorkerJobRecord) -> JobResponse {
        let payload = serde_json::from_str(&job.payload).unwrap_or(serde_json::Value::Null);
        JobResponse {
            id: job.id.clone(),
            job_type: job.job_type.clone(),
            payload,
            status: job.status.clone(),
            error_message: job.error_message.clone(),
            worker_id: job.worker_id.clone(),
            timeout_secs: job.timeout_secs,
            started_at: job.started_at.map(|t| t.and_utc().to_rfc3339()),
            created_at: job.created_at.and_utc().to_rfc3339(),
            updated_at: job.updated_at.and_utc().to_rfc3339(),
        }
    }
}
