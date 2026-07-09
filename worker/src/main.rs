//! Background worker service.
//!
//! Runs as a standalone process alongside the main app. It shares the same
//! SQLite database and pulls its tasks from the `worker_jobs` table: it polls
//! for ready jobs, claims one, processes it, and records the outcome. The main
//! process owns the job APIs that enqueue work into that table.

use std::collections::HashMap;
use std::{env, thread, time::Duration};

use chrono::Utc;
use diesel::prelude::*;
use diesel::r2d2::{
    ConnectionManager, CustomizeConnection, Error as R2D2Error, Pool, PooledConnection,
};
use diesel::sqlite::SqliteConnection;
use uuid::Uuid;

mod crypto;
mod face;
mod schema;
mod tasks;
use face::FaceScanner;
use schema::worker_jobs;
use tasks::{FaceScanHandler, TaskHandler};

/// Maps a `job_type` to the handler that runs it.
type Registry = HashMap<String, Box<dyn TaskHandler>>;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;
type Conn = PooledConnection<ConnectionManager<SqliteConnection>>;

/// How long to wait between polls when there is no work.
const POLL_INTERVAL: Duration = Duration::from_secs(2);

// Job lifecycle status codes, matching the main app's jobs API.
const STATUS_READY: &str = "R";
const STATUS_IN_PROGRESS: &str = "I";
const STATUS_COMPLETE: &str = "C";
const STATUS_ERROR: &str = "E";

/// A task claimed from the jobs table.
pub struct Task {
    pub id: String,
    pub job_type: String,
    pub payload: String,
}

/// Sets pragmas so the worker cooperates with the main app on the shared file.
#[derive(Debug)]
struct SqliteConnectionInit;

impl CustomizeConnection<SqliteConnection, R2D2Error> for SqliteConnectionInit {
    fn on_acquire(&self, conn: &mut SqliteConnection) -> Result<(), R2D2Error> {
        diesel::sql_query("PRAGMA busy_timeout = 5000")
            .execute(conn)
            .map_err(R2D2Error::QueryError)?;
        diesel::sql_query("PRAGMA journal_mode = WAL")
            .execute(conn)
            .map_err(R2D2Error::QueryError)?;
        Ok(())
    }
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let database_url =
        env::var("DATABASE_URL").unwrap_or_else(|_| "./data/neutrino.db".to_string());
    let model_path = env::var("FACE_MODEL_PATH")
        .unwrap_or_else(|_| "./models/seeta_fd_frontal_v1.0.bin".to_string());
    let worker_id = format!("worker-{}", Uuid::new_v4());

    let pool = Pool::builder()
        .max_size(1)
        .test_on_check_out(true)
        .connection_customizer(Box::new(SqliteConnectionInit))
        .build(ConnectionManager::<SqliteConnection>::new(&database_url))
        .unwrap_or_else(|e| {
            tracing::error!("failed to open database {database_url}: {e}");
            std::process::exit(1);
        });

    let scanner = FaceScanner::new(&model_path).unwrap_or_else(|e| {
        tracing::error!("{e}");
        std::process::exit(1);
    });

    // Register each handler under the job type it declares.
    let handlers: Vec<Box<dyn TaskHandler>> =
        vec![Box::new(FaceScanHandler::new(scanner, pool.clone()))];
    let mut registry: Registry = handlers
        .into_iter()
        .map(|h| (h.job_type().to_string(), h))
        .collect();

    tracing::info!(%worker_id, db = %database_url, model = %model_path, "background worker started");

    // Poll the jobs table forever, claiming and processing one task at a time.
    loop {
        match run_once(&pool, &worker_id, &mut registry) {
            Ok(true) => continue, // processed a task; look for the next immediately
            Ok(false) => thread::sleep(POLL_INTERVAL), // no work waiting
            Err(e) => {
                tracing::error!("worker cycle failed: {e}");
                thread::sleep(POLL_INTERVAL);
            }
        }
    }
}

/// Claims a single task and dispatches it to the handler registered for its job
/// type. Returns `Ok(true)` if a task was handled.
fn run_once(
    pool: &DbPool,
    worker_id: &str,
    registry: &mut Registry,
) -> Result<bool, diesel::result::Error> {
    let mut conn = match pool.get() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("could not get db connection: {e}");
            return Ok(false);
        }
    };

    let Some(task) = claim_next_task(&mut conn, worker_id)? else {
        return Ok(false);
    };

    tracing::info!(job = %task.id, kind = %task.job_type, "processing task");

    // Match the task type to its handler and run it.
    let result = match registry.get_mut(&task.job_type) {
        Some(handler) => handler.process(&task),
        None => Err(format!("no handler registered for job type '{}'", task.job_type)),
    };

    match result {
        Ok(()) => {
            finish_task(&mut conn, &task.id, STATUS_COMPLETE, None)?;
            tracing::info!(job = %task.id, "task complete");
        }
        Err(msg) => {
            finish_task(&mut conn, &task.id, STATUS_ERROR, Some(&msg))?;
            tracing::warn!(job = %task.id, "task failed: {msg}");
        }
    }

    Ok(true)
}

/// Atomically claims the oldest ready job for this worker (`R` -> `I`).
fn claim_next_task(
    conn: &mut Conn,
    worker_id: &str,
) -> Result<Option<Task>, diesel::result::Error> {
    conn.transaction(|conn| {
        let candidate: Option<String> = worker_jobs::table
            .filter(worker_jobs::status.eq(STATUS_READY))
            .order(worker_jobs::created_at.asc())
            .select(worker_jobs::id)
            .first::<String>(conn)
            .optional()?;

        let Some(id) = candidate else {
            return Ok(None);
        };

        let now = Utc::now().naive_utc();
        let claimed = diesel::update(
            worker_jobs::table
                .filter(worker_jobs::id.eq(&id))
                .filter(worker_jobs::status.eq(STATUS_READY)),
        )
        .set((
            worker_jobs::status.eq(STATUS_IN_PROGRESS),
            worker_jobs::worker_id.eq(worker_id),
            worker_jobs::started_at.eq(now),
            worker_jobs::updated_at.eq(now),
        ))
        .execute(conn)?;

        if claimed == 0 {
            // Another worker won the race between the select and the update.
            return Ok(None);
        }

        let (id, job_type, payload) = worker_jobs::table
            .filter(worker_jobs::id.eq(&id))
            .select((
                worker_jobs::id,
                worker_jobs::job_type,
                worker_jobs::payload,
            ))
            .first::<(String, String, String)>(conn)?;

        Ok(Some(Task {
            id,
            job_type,
            payload,
        }))
    })
}

/// Records the terminal status of a job.
fn finish_task(
    conn: &mut Conn,
    id: &str,
    status: &str,
    error_message: Option<&str>,
) -> Result<(), diesel::result::Error> {
    let now = Utc::now().naive_utc();
    diesel::update(worker_jobs::table.filter(worker_jobs::id.eq(id)))
        .set((
            worker_jobs::status.eq(status),
            worker_jobs::error_message.eq(error_message),
            worker_jobs::updated_at.eq(now),
        ))
        .execute(conn)?;
    Ok(())
}
