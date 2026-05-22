use tracing_appender::{rolling, non_blocking};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter, fmt, fmt::time::UtcTime};

pub fn init_logging(log_level: &str, log_path: Option<String>) -> Option<WorkerGuard> {
    let stdout_layer = fmt::layer()
        .with_timer(UtcTime::rfc_3339())
        .with_writer(std::io::stdout);

    let sub = tracing_subscriber::registry()
        .with(EnvFilter::new(log_level))
        .with(stdout_layer);

    if let Some(path) = log_path {
        match rolling::Builder::new()
            .rotation(rolling::Rotation::DAILY)
            .filename_prefix("service")
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