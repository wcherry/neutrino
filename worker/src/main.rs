//! Background worker service.
//!
//! Runs as a standalone process alongside the main app. It shares the same
//! SQLite database and pulls its tasks from the `worker_jobs` table: it polls
//! for ready jobs, claims one, processes it, and records the outcome. The main
//! process owns the job APIs that enqueue work into that table.

use std::{env, thread, time::Duration};

use chrono::Utc;
use diesel::prelude::*;
use diesel::r2d2::{
    ConnectionManager, CustomizeConnection, Error as R2D2Error, Pool, PooledConnection,
};
use diesel::sqlite::SqliteConnection;
use uuid::Uuid;

mod schema;
use schema::worker_jobs;

type DbPool = Pool<ConnectionManager<SqliteConnection>>;
type Conn = PooledConnection<ConnectionManager<SqliteConnection>>;

/// How long to wait between polls when there is no work.
const POLL_INTERVAL: Duration = Duration::from_secs(2);

// Job lifecycle status codes, matching the main app's jobs API.
const STATUS_READY: &str = "R";
const STATUS_IN_PROGRESS: &str = "I";
const STATUS_COMPLETE: &str = "C";
const STATUS_ERROR: &str = "E";

/// A task claimed from the jobs table.
struct Task {
    id: String,
    job_type: String,
    payload: String,
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

    tracing::info!(%worker_id, db = %database_url, "background worker started");

    // Poll the jobs table forever, claiming and processing one task at a time.
    loop {
        match run_once(&pool, &worker_id) {
            Ok(true) => continue, // processed a task; look for the next immediately
            Ok(false) => thread::sleep(POLL_INTERVAL), // no work waiting
            Err(e) => {
                tracing::error!("worker cycle failed: {e}");
                thread::sleep(POLL_INTERVAL);
            }
        }
    }
}

/// Claims and processes a single task. Returns `Ok(true)` if a task was handled.
fn run_once(pool: &DbPool, worker_id: &str) -> Result<bool, diesel::result::Error> {
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

    match process(&task) {
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

/// Performs the task described by a job. Returns `Err(message)` on failure.
fn process(task: &Task) -> Result<(), String> {
    // Task-type-specific handling can be added here as the system grows.
    // For now the worker records that it picked the task up off the table.
    tracing::debug!(job = %task.id, payload = %task.payload, "handling {}", task.job_type);
    Ok(())
}
