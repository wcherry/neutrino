//! Background worker service.
//!
//! Runs as a standalone process alongside the main app. It shares the same
//! SQLite database and pulls its tasks from the `worker_jobs` table: it polls
//! for ready jobs, claims one, processes it, and records the outcome. The main
//! process owns the job APIs that enqueue work into that table.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;
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
mod logger;
mod purge;
mod schema;
mod tasks;
mod versions;
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
    // The same `.env` the main app loads, and for a stronger reason: every
    // variable below has a default, so a worker that never read the file starts
    // cleanly and quietly does its work against the wrong database and the
    // wrong storage root — see `storage_root` below for what that costs. In a
    // container the variables are already in the environment and this finds no
    // file, which is fine: dotenv never overrides what is already set.
    // `dotenv()` searches upward from the working directory, so which file it
    // finds depends on where this was started; the app prints the same line for
    // the same reason. Printed rather than logged because logging is configured
    // from what this loads.
    match dotenvy::dotenv() {
        Ok(path) => println!("worker: loaded environment from {}", path.display()),
        Err(_) => println!("worker: no .env found; using the environment as it stands"),
    }

    // Same `LOG_LEVEL` / `LOG_PATH` pair the main app reads, so one set of
    // variables configures both processes. Held for the whole of `main`: the
    // file writer is non-blocking, and dropping the guard would cut the flush.
    let log_level = env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string());
    let _log_guard = logger::init_logging(&log_level, env::var("LOG_PATH").ok());

    let database_url =
        env::var("DATABASE_URL").unwrap_or_else(|_| "./data/neutrino.db".to_string());
    let model_path = env::var("FACE_MODEL_PATH")
        .unwrap_or_else(|_| "./models/seeta_fd_frontal_v1.0.bin".to_string());
    // Same variable and same default as the main app's `Config::storage_path`;
    // the purge and version-retention sweeps delete blobs under it. Pointing
    // the worker at a different root than the app makes them no-ops that still
    // delete the rows, so the bytes would be left orphaned.
    let storage_root = PathBuf::from(
        env::var("STORAGE_PATH").unwrap_or_else(|_| "./storage".to_string()),
    );
    let worker_id = format!("worker-{}", Uuid::new_v4());

    // Both paths default, so a missing or misspelled variable puts the worker
    // on a different database and storage root than the app with nothing said
    // about it — the failure the comment above describes. Reported here so the
    // two processes' first log lines can be compared.
    tracing::info!(
        "worker: database={} storage={}",
        database_url,
        storage_root.display()
    );

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

    tracing::info!(
        %worker_id,
        db = %database_url,
        model = %model_path,
        storage = %storage_root.display(),
        "background worker started",
    );

    // Tracks the two sweeps, which run on a wall-clock interval rather than
    // per poll. `None` means one has never run, so the first pass through the
    // loop sweeps immediately — a restart then catches up on anything whose
    // window closed while the process was down.
    let mut last_purge_sweep: Option<Instant> = None;
    let mut last_version_sweep: Option<Instant> = None;

    // Poll the jobs table forever, claiming and processing one task at a time.
    loop {
        if last_purge_sweep.is_none_or(|t| t.elapsed() >= purge::SWEEP_INTERVAL) {
            last_purge_sweep = Some(Instant::now());
            match purge::sweep(&pool, &storage_root) {
                Ok(0) => {}
                Ok(n) => tracing::info!("purged {n} expired account(s)"),
                Err(e) => tracing::error!("account purge sweep failed: {e}"),
            }
        }

        if last_version_sweep.is_none_or(|t| t.elapsed() >= versions::SWEEP_INTERVAL) {
            last_version_sweep = Some(Instant::now());
            match versions::sweep(&pool, &storage_root) {
                Ok(r) if r.deleted == 0 => {}
                Ok(r) => tracing::info!(
                    "pruned {} file version(s), freeing {} bytes",
                    r.deleted,
                    r.bytes_freed,
                ),
                Err(e) => tracing::error!("version retention sweep failed: {e}"),
            }
        }

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
