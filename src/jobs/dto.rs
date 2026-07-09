use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

fn default_timeout() -> i32 {
    30
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateJobRequest {
    pub job_type: String,
    pub payload: serde_json::Value,
    #[serde(default = "default_timeout")]
    pub timeout_secs: i32,
    /// Optional plaintext file attached to the job, base64-encoded. When present
    /// it is encrypted with a one-time key and stashed in the user's temp
    /// storage; the key and path are recorded in the stored payload.
    #[serde(default)]
    pub file: Option<String>,
    /// Owner of the attached file — required when `file` is set, so the encrypted
    /// blob can be written into that user's storage.
    #[serde(default)]
    pub user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JobResponse {
    pub id: String,
    pub job_type: String,
    pub payload: serde_json::Value,
    pub status: String,
    pub error_message: Option<String>,
    pub worker_id: Option<String>,
    pub timeout_secs: i32,
    pub started_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateJobStatusRequest {
    /// "C" (completed) or "E" (error)
    pub status: String,
    pub error_message: Option<String>,
}

/// Partial update of a job's mutable fields. Omitted fields are left unchanged.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateJobRequest {
    pub job_type: Option<String>,
    pub payload: Option<serde_json::Value>,
    pub status: Option<String>,
    pub timeout_secs: Option<i32>,
    pub error_message: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegisterWorkerRequest {
    pub callback_url: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegisterWorkerResponse {
    pub worker_id: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PendingJobsQuery {
    pub limit: Option<i64>,
}
