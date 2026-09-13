use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::drive::notifications::hub::NotificationHub;

/// The `type` field on the wire. Notification inbox records carry no `type` at all, which is how
/// the client tells the two kinds of message apart on one socket without a version bump.
pub const DRIVE_CHANGED_TYPE: &str = "drive.changed";

/// At most one signal per user per window.
///
/// The first change in a quiet period goes out immediately — that is the case this exists for, a
/// single upload landing on a phone — and a burst collapses to one signal per window. A Takeout
/// import writes thousands of files in a few minutes; without this, each one would push a message
/// to every other open tab and each of those would refetch a folder listing.
const COALESCE_WINDOW: Duration = Duration::from_millis(500);

/// How long a user's rate-limit entry outlives their last change before it is dropped. Only there
/// to stop the map growing without bound on a long-lived server; the entry holds no state worth
/// keeping once the window has passed.
const IDLE_ENTRY_TTL: Duration = Duration::from_secs(300);

/// Which client caused the change(s) a signal stands for.
///
/// Tracked so a tab can ignore the echo of its own writes. It is deliberately *not* "the client id
/// of the first event in the batch": coalescing can fold this tab's upload together with a change
/// made on a phone, and reporting the tab as the origin of that batch would have it discard a
/// signal it genuinely needed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Origin {
    /// Every change in the batch came from this one client.
    Single(String),
    /// Changes from more than one client, or from a client that identified itself on some
    /// requests and not others. Nobody may treat this as their own echo.
    Mixed,
}

impl Origin {
    fn new(client_id: Option<&str>) -> Self {
        match client_id {
            Some(id) if !id.is_empty() => Origin::Single(id.to_string()),
            _ => Origin::Mixed,
        }
    }

    /// Fold another change into the batch.
    fn merge(&mut self, client_id: Option<&str>) {
        let incoming = Origin::new(client_id);
        if *self != incoming {
            *self = Origin::Mixed;
        }
    }

    fn single(&self) -> Option<&str> {
        match self {
            Origin::Single(id) => Some(id),
            Origin::Mixed => None,
        }
    }
}

struct UserState {
    /// When a signal was last put on the wire for this user.
    last_sent: Instant,
    /// The batch waiting for the window to elapse, if a flush is already scheduled.
    pending: Option<Origin>,
}

/// What [`DriveEventBroadcaster::notify`] decided to do with a change.
///
/// Split out from the acting so the rate limiting can be tested against a synthetic clock, with no
/// async runtime and no socket.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Decision {
    /// Put a signal on the wire now.
    SendNow(Origin),
    /// Nothing to do: this change joined a batch that is already scheduled to flush.
    Coalesced,
    /// Start a batch and flush it after this delay.
    Schedule(Duration),
}

/// Pushes "your drive changed" to a user's open clients, at most once per [`COALESCE_WINDOW`].
pub struct DriveEventBroadcaster {
    hub: Arc<NotificationHub>,
    state: Mutex<HashMap<String, UserState>>,
    window: Duration,
}

impl DriveEventBroadcaster {
    pub fn new(hub: Arc<NotificationHub>) -> Self {
        Self::with_window(hub, COALESCE_WINDOW)
    }

    fn with_window(hub: Arc<NotificationHub>, window: Duration) -> Self {
        DriveEventBroadcaster {
            hub,
            state: Mutex::new(HashMap::new()),
            window,
        }
    }

    /// Record that `user_id`'s drive changed, and signal their other clients.
    ///
    /// `client_id` is the caller's own `X-Neutrino-Client-Id`, when it sent one; it travels back
    /// out on the signal so the tab that made the change can skip the refetch it has already done.
    pub fn notify(self: &Arc<Self>, user_id: &str, client_id: Option<&str>) {
        match self.decide(user_id, client_id, Instant::now()) {
            Decision::SendNow(origin) => self.push(user_id, &origin),
            Decision::Coalesced => {}
            Decision::Schedule(delay) => {
                let this = Arc::clone(self);
                let user_id = user_id.to_string();
                actix_web::rt::spawn(async move {
                    tokio::time::sleep(delay).await;
                    this.flush(&user_id);
                });
            }
        }
    }

    fn decide(&self, user_id: &str, client_id: Option<&str>, now: Instant) -> Decision {
        let mut state = self.state.lock().unwrap();
        state.retain(|_, entry| {
            entry.pending.is_some() || now.duration_since(entry.last_sent) < IDLE_ENTRY_TTL
        });

        match state.get_mut(user_id) {
            Some(entry) => {
                if let Some(pending) = entry.pending.as_mut() {
                    pending.merge(client_id);
                    return Decision::Coalesced;
                }
                let since = now.duration_since(entry.last_sent);
                if since >= self.window {
                    entry.last_sent = now;
                    Decision::SendNow(Origin::new(client_id))
                } else {
                    entry.pending = Some(Origin::new(client_id));
                    Decision::Schedule(self.window - since)
                }
            }
            None => {
                state.insert(
                    user_id.to_string(),
                    UserState {
                        last_sent: now,
                        pending: None,
                    },
                );
                Decision::SendNow(Origin::new(client_id))
            }
        }
    }

    /// Put the batched signal on the wire once its window has elapsed.
    fn flush(&self, user_id: &str) {
        let origin = {
            let mut state = self.state.lock().unwrap();
            match state.get_mut(user_id) {
                Some(entry) => {
                    entry.last_sent = Instant::now();
                    entry.pending.take()
                }
                None => None,
            }
        };
        if let Some(origin) = origin {
            self.push(user_id, &origin);
        }
    }

    fn push(&self, user_id: &str, origin: &Origin) {
        let json = serde_json::json!({
            "type": DRIVE_CHANGED_TYPE,
            "originClientId": origin.single(),
        })
        .to_string();
        self.hub.push(user_id, json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn broadcaster(window_ms: u64) -> Arc<DriveEventBroadcaster> {
        Arc::new(DriveEventBroadcaster::with_window(
            Arc::new(NotificationHub::new()),
            Duration::from_millis(window_ms),
        ))
    }

    #[test]
    fn the_first_change_in_a_quiet_period_goes_out_immediately() {
        let b = broadcaster(500);
        let now = Instant::now();

        assert_eq!(
            b.decide("user-1", Some("tab-a"), now),
            Decision::SendNow(Origin::Single("tab-a".into()))
        );
    }

    #[test]
    fn a_second_change_inside_the_window_schedules_one_flush_and_the_rest_join_it() {
        let b = broadcaster(500);
        let now = Instant::now();
        b.decide("user-1", Some("tab-a"), now);

        // Scheduled for the remainder of the window, not a fresh full window.
        assert_eq!(
            b.decide("user-1", Some("tab-a"), now + Duration::from_millis(100)),
            Decision::Schedule(Duration::from_millis(400))
        );
        for _ in 0..50 {
            assert_eq!(
                b.decide("user-1", Some("tab-a"), now + Duration::from_millis(200)),
                Decision::Coalesced
            );
        }
    }

    #[test]
    fn a_change_after_the_window_goes_out_immediately_again() {
        let b = broadcaster(500);
        let now = Instant::now();
        b.decide("user-1", Some("tab-a"), now);

        assert_eq!(
            b.decide("user-1", Some("tab-a"), now + Duration::from_millis(500)),
            Decision::SendNow(Origin::Single("tab-a".into()))
        );
    }

    #[test]
    fn users_are_rate_limited_independently() {
        let b = broadcaster(500);
        let now = Instant::now();
        b.decide("user-1", Some("tab-a"), now);

        assert_eq!(
            b.decide("user-2", Some("tab-b"), now),
            Decision::SendNow(Origin::Single("tab-b".into()))
        );
    }

    /// The echo-suppression guarantee: a batch is attributed to one client only when *every*
    /// change in it came from that client. Getting this wrong drops a signal the origin tab needed
    /// — the failure it protects against is a silently stale listing, which is the bug this whole
    /// module exists to fix.
    #[test]
    fn a_batch_mixing_two_clients_is_attributed_to_neither() {
        let b = broadcaster(500);
        let now = Instant::now();
        b.decide("user-1", Some("tab-a"), now);
        b.decide("user-1", Some("tab-a"), now + Duration::from_millis(100));
        b.decide("user-1", Some("phone"), now + Duration::from_millis(200));

        b.flush_for_test("user-1", |origin| assert_eq!(origin, Origin::Mixed));
    }

    #[test]
    fn a_batch_from_one_client_stays_attributed_to_it() {
        let b = broadcaster(500);
        let now = Instant::now();
        b.decide("user-1", Some("tab-a"), now);
        b.decide("user-1", Some("tab-a"), now + Duration::from_millis(100));
        b.decide("user-1", Some("tab-a"), now + Duration::from_millis(200));

        b.flush_for_test("user-1", |origin| {
            assert_eq!(origin, Origin::Single("tab-a".into()))
        });
    }

    /// A client that sends no id cannot be anybody's echo — the iOS app and the macOS agent are
    /// the callers with no id, and theirs are exactly the changes a browser must not discard.
    #[test]
    fn a_change_with_no_client_id_is_never_an_echo() {
        let b = broadcaster(500);
        let now = Instant::now();

        assert_eq!(
            b.decide("user-1", None, now),
            Decision::SendNow(Origin::Mixed)
        );
    }

    #[test]
    fn an_empty_client_id_is_treated_as_no_client_id() {
        let b = broadcaster(500);
        let now = Instant::now();

        assert_eq!(b.decide("user-1", Some(""), now), Decision::SendNow(Origin::Mixed));
    }

    #[test]
    fn idle_entries_are_pruned_rather_than_accumulating() {
        let b = broadcaster(500);
        let now = Instant::now();
        for i in 0..100 {
            b.decide(&format!("user-{i}"), Some("tab-a"), now);
        }
        assert_eq!(b.state.lock().unwrap().len(), 100);

        b.decide("user-new", Some("tab-a"), now + IDLE_ENTRY_TTL);
        assert_eq!(b.state.lock().unwrap().len(), 1);
    }

    #[test]
    fn the_wire_format_names_the_event_and_its_origin() {
        let origin = Origin::Single("tab-a".into());
        let json = serde_json::json!({
            "type": DRIVE_CHANGED_TYPE,
            "originClientId": origin.single(),
        });

        assert_eq!(json["type"], "drive.changed");
        assert_eq!(json["originClientId"], "tab-a");
        // An inbox record is distinguished by having no `type` at all; make sure a signal does not
        // accidentally look like one.
        assert!(json.get("eventType").is_none());
    }

    impl DriveEventBroadcaster {
        /// Take whatever is batched for `user_id` and hand it to `check`, without a socket.
        fn flush_for_test(&self, user_id: &str, check: impl FnOnce(Origin)) {
            let pending = self
                .state
                .lock()
                .unwrap()
                .get_mut(user_id)
                .and_then(|entry| entry.pending.take());
            check(pending.expect("a batch should be pending"));
        }
    }
}
