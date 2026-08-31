//! Worker logging: stdout, plus a daily file when `LOG_PATH` is set.
//!
//! Deliberately the same shape as the main app's `shared::logger`, down to the
//! rotation and the timestamp format, because the two now run side by side in
//! one container and write into the same directory. What differs is the
//! filename prefix — `worker.<date>.log` beside `service.<date>.log` — so a
//! single `LOG_PATH` gives one stream per process rather than two processes
//! interleaved in one file. The worker is a separate crate and cannot import
//! the app's copy, so the two have to be changed together.

use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::{non_blocking, rolling};
use tracing_subscriber::{
    fmt, fmt::time::UtcTime, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter,
};

/// Prefix for the worker's log files. `service` is the main app's.
const FILENAME_PREFIX: &str = "worker";

/// Installs the subscriber, returning the guard that must be held for the
/// process's lifetime — the file writer is non-blocking, so dropping the guard
/// stops the background flush and loses whatever it was still holding.
pub fn init_logging(log_level: &str, log_path: Option<String>) -> Option<WorkerGuard> {
    let stdout_layer = fmt::layer()
        .with_timer(UtcTime::rfc_3339())
        .with_writer(std::io::stdout);

    // `RUST_LOG` still wins where it is set, which is how the worker has always
    // been driven in development; `LOG_LEVEL` is the fallback so that setting
    // it once configures both processes in a single-container deployment.
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(log_level));

    let sub = tracing_subscriber::registry()
        .with(filter)
        .with(stdout_layer);

    if let Some(path) = log_path {
        match rolling::Builder::new()
            .rotation(rolling::Rotation::DAILY)
            .filename_prefix(FILENAME_PREFIX)
            .filename_suffix("log")
            .build(&path)
        {
            Ok(file_appender) => {
                let (file_writer, guard) = non_blocking(file_appender);
                let file_layer = fmt::layer()
                    .with_timer(UtcTime::rfc_3339())
                    .with_writer(file_writer);
                sub.with(file_layer).init();
                return Some(guard);
            }
            // A log directory that cannot be opened is not worth refusing to
            // start over: the worker still runs and still says everything it
            // has to say on stdout, which is where a container runtime is
            // reading anyway.
            Err(e) => {
                sub.init();
                tracing::warn!("Could not open log file at {path:?}: {e} — logging to stdout only");
                return None;
            }
        }
    }

    sub.init();
    None
}
