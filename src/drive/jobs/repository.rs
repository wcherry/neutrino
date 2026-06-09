use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel::sql_types::Text;
use diesel::SqliteConnection;

use crate::drive::jobs::model::{
    NewWorkerJobRecord, NewWorkerRegistrationRecord, WorkerJobRecord, WorkerRegistrationRecord,
};
use crate::schema::{worker_jobs, worker_registrations};
use crate::shared::ApiError;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct JobsRepository {
    pool: DbPool,
}

impl JobsRepository {
    pub fn new(pool: DbPool) -> Self {
        JobsRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert_job(&self, job: NewWorkerJobRecord) -> Result<WorkerJobRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(worker_jobs::table)
            .values(&job)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert job error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        worker_jobs::table
            .filter(worker_jobs::id.eq(job.id))
            .select(WorkerJobRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB fetch job after insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_ready_jobs(&self, limit: i64) -> Result<Vec<WorkerJobRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        worker_jobs::table
            .filter(worker_jobs::status.eq("R"))
            .order(worker_jobs::created_at.asc())
            .limit(limit)
            .select(WorkerJobRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get ready jobs error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Atomically claim up to `limit` ready jobs for a specific worker.
    pub fn claim_pending_jobs(
        &self,
        worker_id: &str,
        limit: i64,
    ) -> Result<Vec<WorkerJobRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        let now = chrono::Utc::now().naive_utc();

        conn.transaction(|conn| {
            let ready: Vec<WorkerJobRecord> = worker_jobs::table
                .filter(worker_jobs::status.eq("R"))
                .order(worker_jobs::created_at.asc())
                .limit(limit)
                .select(WorkerJobRecord::as_select())
                .load(conn)?;

            for job in &ready {
                diesel::update(worker_jobs::table.filter(worker_jobs::id.eq(&job.id)))
                    .set((
                        worker_jobs::status.eq("I"),
                        worker_jobs::worker_id.eq(Some(worker_id)),
                        worker_jobs::started_at.eq(Some(now)),
                        worker_jobs::updated_at.eq(now),
                    ))
                    .execute(conn)?;
            }
            Ok(ready)
        })
        .map_err(|e: diesel::result::Error| {
            tracing::error!("DB claim jobs error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    /// Atomically mark a single ready job as in-progress for a worker.
    /// Returns true if the job was successfully claimed.
    pub fn try_claim_job(&self, job_id: &str, worker_id: &str) -> Result<bool, ApiError> {
        let mut conn = self.get_conn()?;
        let now = chrono::Utc::now().naive_utc();
        let rows = diesel::update(
            worker_jobs::table
                .filter(worker_jobs::id.eq(job_id))
                .filter(worker_jobs::status.eq("R")),
        )
        .set((
            worker_jobs::status.eq("I"),
            worker_jobs::worker_id.eq(Some(worker_id)),
            worker_jobs::started_at.eq(Some(now)),
            worker_jobs::updated_at.eq(now),
        ))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB try claim job error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        Ok(rows > 0)
    }

    pub fn update_job_status(
        &self,
        job_id: &str,
        status: &str,
        error_message: Option<&str>,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let now = chrono::Utc::now().naive_utc();
        diesel::update(worker_jobs::table.filter(worker_jobs::id.eq(job_id)))
            .set((
                worker_jobs::status.eq(status),
                worker_jobs::error_message.eq(error_message),
                worker_jobs::updated_at.eq(now),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update job status error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    pub fn reset_to_ready(&self, job_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let now = chrono::Utc::now().naive_utc();
        diesel::update(worker_jobs::table.filter(worker_jobs::id.eq(job_id)))
            .set((
                worker_jobs::status.eq("R"),
                worker_jobs::worker_id.eq(None::<String>),
                worker_jobs::started_at.eq(None::<NaiveDateTime>),
                worker_jobs::updated_at.eq(now),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB reset job error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    /// Returns jobs stuck in I status past their timeout.
    pub fn get_timed_out_jobs(&self) -> Result<Vec<WorkerJobRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::sql_query(
            "SELECT id, job_type, payload, status, error_message, worker_id, \
             timeout_secs, started_at, created_at, updated_at \
             FROM worker_jobs \
             WHERE status = 'I' AND started_at IS NOT NULL \
             AND (CAST(strftime('%s','now') AS INTEGER) \
                  - CAST(strftime('%s', started_at) AS INTEGER)) > timeout_secs",
        )
        .load::<WorkerJobRecord>(&mut conn)
        .map_err(|e| {
            tracing::error!("DB get timed-out jobs error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    pub fn register_worker(
        &self,
        rec: NewWorkerRegistrationRecord,
    ) -> Result<WorkerRegistrationRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(worker_registrations::table)
            .values(&rec)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB register worker error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        worker_registrations::table
            .filter(worker_registrations::id.eq(rec.id))
            .select(WorkerRegistrationRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB fetch worker after register error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn deregister_worker(&self, worker_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(worker_registrations::table.filter(worker_registrations::id.eq(worker_id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB deregister worker error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    pub fn list_workers(&self) -> Result<Vec<WorkerRegistrationRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        worker_registrations::table
            .select(WorkerRegistrationRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list workers error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Look up a file's storage path and MIME type (for serving content to workers).
    pub fn get_file_info(&self, file_id: &str) -> Result<(String, String), ApiError> {
        #[derive(QueryableByName)]
        struct FileRow {
            #[diesel(sql_type = Text)]
            storage_path: String,
            #[diesel(sql_type = Text)]
            mime_type: String,
        }

        let mut conn = self.get_conn()?;
        let rows: Vec<FileRow> = diesel::sql_query(
            "SELECT storage_path, mime_type FROM files \
             WHERE id = ? AND deleted_at IS NULL LIMIT 1",
        )
        .bind::<Text, _>(file_id)
        .load(&mut conn)
        .map_err(|e| {
            tracing::error!("DB get file info error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        rows.into_iter()
            .next()
            .map(|r| (r.storage_path, r.mime_type))
            .ok_or_else(|| ApiError::not_found("File not found"))
    }
}
