use crate::calendar::reminders::repository::RemindersRepository;
use chrono::Utc;
use std::sync::Arc;
use tokio::time::{interval, Duration};
use tracing::{error, info, warn};

/// Polls the reminders table every `poll_secs` seconds.
/// For each due reminder (due_time <= now, not completed, not yet notified):
///   - logs the notification (email/push hooks can be wired in here later)
///   - stamps notified_at so it isn't re-fired
///
/// For recurring reminders (with an RRULE), advancing due_time is Phase 8 work;
/// for now they are treated like one-time reminders once the engine fires.
pub async fn run(repo: Arc<RemindersRepository>, poll_secs: u64) {
    let mut ticker = interval(Duration::from_secs(poll_secs));
    info!("Reminder engine started (poll interval: {}s)", poll_secs);

    loop {
        ticker.tick().await;

        let now = Utc::now().naive_utc();

        let due = match repo.find_due(now) {
            Ok(r) => r,
            Err(e) => {
                error!("Reminder engine: failed to query due reminders: {:?}", e);
                continue;
            }
        };

        if due.is_empty() {
            continue;
        }

        info!("Reminder engine: {} reminder(s) due", due.len());

        for reminder in due {
            // --- Notification dispatch -----------------------------------
            // Replace this log line with real delivery (email, push, in-app)
            // once the notification infrastructure is available.
            warn!(
                reminder_id = %reminder.id,
                user_id     = %reminder.user_id,
                title       = %reminder.title,
                due_time    = %reminder.due_time,
                "REMINDER FIRED — notification pending delivery"
            );
            // ------------------------------------------------------------

            if let Err(e) = repo.mark_notified(&reminder.id, now) {
                error!(
                    reminder_id = %reminder.id,
                    "Reminder engine: failed to mark reminder notified: {:?}", e
                );
            }
        }
    }
}
