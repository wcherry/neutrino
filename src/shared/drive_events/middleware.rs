use std::sync::Arc;

use actix_web::body::MessageBody;
use actix_web::dev::{ServiceRequest, ServiceResponse};
use actix_web::http::header::AUTHORIZATION;
use actix_web::middleware::Next;
use actix_web::{web, Error};

use crate::shared::drive_events::broadcaster::DriveEventBroadcaster;
use crate::shared::TokenService;

/// Identifies the browser tab (or native client) that made a request, so the signal its own write
/// provokes can be recognised as an echo and skipped. Optional: a client that sends none simply
/// never has its changes attributed to it, which is the safe direction.
pub const CLIENT_ID_HEADER: &str = "x-neutrino-client-id";

/// Whether a successful request at `path` could have changed what a Drive listing shows.
///
/// The polarity is "fire unless known irrelevant", so a Drive route added later is covered without
/// anyone editing this function — a redundant signal costs one cached listing refetch in whatever
/// tab is open, while a missed one is the stale folder this module exists to prevent.
///
/// The two areas are the two that write `files`/`folders` rows: everything under `/drive`, and the
/// Photos routes, which register a Drive file for every photo and so change My Drive as well as
/// the photo grid. Each exclusion below carries its own reason; none of them is "probably fine".
pub fn changes_drive_listing(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("/api/v1/") else {
        return false;
    };

    if let Some(drive) = rest.strip_prefix("drive/") {
        // The notification inbox (including the read receipts every open tab writes) and comment
        // threads change nothing any listing renders. Excluded because they are frequent, not
        // because correctness depends on it.
        if drive.starts_with("notifications") || drive.starts_with("comments") {
            return false;
        }
        // Autosave is the one write on a *timer* — the sheets editor fires one every 3 s for as
        // long as a document is dirty — and it is also the one write that cannot change which
        // files are in a folder: it rewrites an existing file's bytes. Signalling it would have a
        // Drive tab left open beside an editor refetch its listing twenty times a minute to track
        // a modified timestamp. What an open *editor* needs in order to see somebody else's edit
        // is `shared::file_events`, the per-file relay, and that is unaffected by this.
        return !drive.ends_with("/autosave");
    }

    matches_area(rest, "photos") || matches_area(rest, "albums")
}

/// True when `rest` is exactly `area` or a path beneath it — so `photos` and `photos/{id}` match
/// while a future `photosomething` does not.
fn matches_area(rest: &str, area: &str) -> bool {
    rest.strip_prefix(area)
        .is_some_and(|tail| tail.is_empty() || tail.starts_with('/'))
}

/// Whether the method is one that can write. A `GET` listing must never signal a change, or every
/// tab reading a folder would tell every other tab to read it again.
fn is_mutating(method: &actix_web::http::Method) -> bool {
    use actix_web::http::Method;
    matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    )
}

fn header(req: &ServiceRequest, name: &str) -> Option<String> {
    req.headers()
        .get(name)?
        .to_str()
        .ok()
        .map(|s| s.trim().to_string())
}

/// Signals a user's other clients after any request of theirs that changed their drive.
///
/// Sits on the whole `/api/v1` scope rather than on each handler: there are around thirty routes
/// that move a file or folder row across `drive::storage`, `drive::filesystem`, `drive::tags`,
/// `drive::teams` and `photos`, and a rule applied in one place cannot be forgotten by the
/// thirty-first. It runs after the handler and only on success, so a rejected upload signals
/// nothing.
///
/// The user is resolved by validating the bearer token here rather than by reading an extractor's
/// output, because middleware runs outside the handler's extractor phase. That is an HMAC verify
/// of a token this request has already been authorised with — no database work — and it is skipped
/// entirely for reads, for failures, and for the public share routes that carry no token at all.
pub async fn broadcast_drive_changes(
    req: ServiceRequest,
    next: Next<impl MessageBody>,
) -> Result<ServiceResponse<impl MessageBody>, Error> {
    let relevant = is_mutating(req.method()) && changes_drive_listing(req.path());

    // Everything needed after the call is taken before it: `next.call` consumes the request.
    let context = relevant.then(|| {
        (
            req.app_data::<web::Data<Arc<DriveEventBroadcaster>>>()
                .map(|d| Arc::clone(d.get_ref())),
            req.app_data::<web::Data<Arc<TokenService>>>()
                .map(|d| Arc::clone(d.get_ref())),
            header(&req, AUTHORIZATION.as_str()),
            header(&req, CLIENT_ID_HEADER),
        )
    });

    let res = next.call(req).await?;

    if let Some((Some(broadcaster), Some(tokens), Some(authorization), client_id)) = context {
        if res.status().is_success() {
            if let Some(token) = authorization.strip_prefix("Bearer ") {
                if let Ok(claims) = tokens.validate_access_token(token.trim()) {
                    broadcaster.notify(&claims.sub, client_id.as_deref());
                }
            }
        }
    }

    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::http::Method;

    /// End-to-end through a real actix service.
    ///
    /// The unit tests below pin the path and method rules; these pin the wiring around them, which
    /// is where this can fail without any of them noticing — app data looked up under the wrong
    /// type, the bearer token read before `next.call` consumes the request, the status checked on
    /// the wrong side of the handler. Each asserts on what actually reaches a subscribed client.
    mod through_a_real_request {
        use super::*;
        use crate::drive::notifications::hub::NotificationHub;
        use crate::shared::drive_events::broadcaster::DRIVE_CHANGED_TYPE;
        // `actix_web::test` exports an attribute macro as well as the module, so importing it in a
        // module that also holds plain `#[test]` functions shadows the built-in one and every one
        // of them is rejected for not being `async`. Confined here, where every test is an
        // `#[actix_web::test]` anyway.
        use actix_web::middleware::from_fn;
        use actix_web::{test, web, App, HttpResponse};

        const SECRET: &str = "test-secret";
        const USER: &str = "user-1";

        struct Harness {
            hub: Arc<NotificationHub>,
            broadcaster: Arc<DriveEventBroadcaster>,
            tokens: Arc<TokenService>,
        }

        fn harness() -> Harness {
            let hub = Arc::new(NotificationHub::new());
            Harness {
                broadcaster: Arc::new(DriveEventBroadcaster::new(hub.clone())),
                hub,
                tokens: Arc::new(TokenService::new(SECRET.to_string())),
            }
        }

        /// A service shaped like the real one: the middleware wrapped around `/api/v1`, with
        /// handlers that answer whatever status the test asks for.
        macro_rules! service {
            ($h:expr) => {
                test::init_service(
                    App::new()
                        .app_data(web::Data::new($h.broadcaster.clone()))
                        .app_data(web::Data::new($h.tokens.clone()))
                        .service(
                            web::scope("/api/v1")
                                .wrap(from_fn(broadcast_drive_changes))
                                .route(
                                    "/drive/files/upload",
                                    web::post().to(|| async { HttpResponse::Created().finish() }),
                                )
                                .route(
                                    "/drive/files/{id}",
                                    web::get().to(|| async { HttpResponse::Ok().finish() }),
                                )
                                .route(
                                    "/drive/files/rejected",
                                    web::post()
                                        .to(|| async { HttpResponse::PayloadTooLarge().finish() }),
                                )
                                .route(
                                    "/calendar/events",
                                    web::post().to(|| async { HttpResponse::Created().finish() }),
                                ),
                        ),
                )
                .await
            };
        }

        fn token(h: &Harness) -> String {
            h.tokens
                .generate_access_token(USER, "user-1@example.com")
                .expect("token")
        }

        /// What a subscribed client received, if anything. The first change in a quiet period goes
        /// out on the leading edge, so nothing here has to wait on the coalescing window.
        fn received(rx: &mut tokio::sync::mpsc::UnboundedReceiver<String>) -> Option<String> {
            rx.try_recv().ok()
        }

        #[actix_web::test]
        async fn a_successful_upload_signals_the_users_other_clients() {
            let h = harness();
            let (mut rx, _slot) = h.hub.subscribe(USER);
            let app = service!(h);

            let req = test::TestRequest::post()
                .uri("/api/v1/drive/files/upload")
                .insert_header(("Authorization", format!("Bearer {}", token(&h))))
                .to_request();
            let res = test::call_service(&app, req).await;
            assert!(res.status().is_success());

            let signal = received(&mut rx).expect("the upload should have signalled");
            let parsed: serde_json::Value = serde_json::from_str(&signal).expect("valid json");
            assert_eq!(parsed["type"], DRIVE_CHANGED_TYPE);
            assert!(parsed["originClientId"].is_null());
        }

        /// The echo path: the tab that made the change is named on the signal, so it can skip a
        /// refetch it has already done.
        #[actix_web::test]
        async fn the_calling_clients_id_travels_back_out_on_the_signal() {
            let h = harness();
            let (mut rx, _slot) = h.hub.subscribe(USER);
            let app = service!(h);

            let req = test::TestRequest::post()
                .uri("/api/v1/drive/files/upload")
                .insert_header(("Authorization", format!("Bearer {}", token(&h))))
                .insert_header((CLIENT_ID_HEADER, "tab-a"))
                .to_request();
            test::call_service(&app, req).await;

            let signal = received(&mut rx).expect("the upload should have signalled");
            let parsed: serde_json::Value = serde_json::from_str(&signal).expect("valid json");
            assert_eq!(parsed["originClientId"], "tab-a");
        }

        /// A folder listing is a `GET`, and every open tab issues them. Signalling on a read would
        /// have each tab's refresh provoke the next one's.
        #[actix_web::test]
        async fn a_read_signals_nothing() {
            let h = harness();
            let (mut rx, _slot) = h.hub.subscribe(USER);
            let app = service!(h);

            let req = test::TestRequest::get()
                .uri("/api/v1/drive/files/abc")
                .insert_header(("Authorization", format!("Bearer {}", token(&h))))
                .to_request();
            test::call_service(&app, req).await;

            assert!(received(&mut rx).is_none());
        }

        /// A rejected upload changed nothing, so there is nothing for anyone to re-read.
        #[actix_web::test]
        async fn a_failed_write_signals_nothing() {
            let h = harness();
            let (mut rx, _slot) = h.hub.subscribe(USER);
            let app = service!(h);

            let req = test::TestRequest::post()
                .uri("/api/v1/drive/files/rejected")
                .insert_header(("Authorization", format!("Bearer {}", token(&h))))
                .to_request();
            let res = test::call_service(&app, req).await;
            assert!(res.status().is_client_error());

            assert!(received(&mut rx).is_none());
        }

        #[actix_web::test]
        async fn a_write_outside_the_drive_and_photo_areas_signals_nothing() {
            let h = harness();
            let (mut rx, _slot) = h.hub.subscribe(USER);
            let app = service!(h);

            let req = test::TestRequest::post()
                .uri("/api/v1/calendar/events")
                .insert_header(("Authorization", format!("Bearer {}", token(&h))))
                .to_request();
            test::call_service(&app, req).await;

            assert!(received(&mut rx).is_none());
        }

        /// The public share routes carry no token. There is no user to signal, and the middleware
        /// must let the request through rather than treating the absence as an error.
        #[actix_web::test]
        async fn an_unauthenticated_write_passes_through_without_signalling() {
            let h = harness();
            let (mut rx, _slot) = h.hub.subscribe(USER);
            let app = service!(h);

            let req = test::TestRequest::post()
                .uri("/api/v1/drive/files/upload")
                .to_request();
            let res = test::call_service(&app, req).await;
            assert!(res.status().is_success());

            assert!(received(&mut rx).is_none());
        }

        #[actix_web::test]
        async fn a_write_bearing_an_invalid_token_signals_nothing() {
            let h = harness();
            let (mut rx, _slot) = h.hub.subscribe(USER);
            let app = service!(h);

            let req = test::TestRequest::post()
                .uri("/api/v1/drive/files/upload")
                .insert_header(("Authorization", "Bearer not-a-real-token"))
                .to_request();
            test::call_service(&app, req).await;

            assert!(received(&mut rx).is_none());
        }

        /// The signal is addressed to the user who owns the drive, not broadcast to everyone.
        #[actix_web::test]
        async fn another_user_is_not_signalled() {
            let h = harness();
            let (mut rx, _slot) = h.hub.subscribe("someone-else");
            let app = service!(h);

            let req = test::TestRequest::post()
                .uri("/api/v1/drive/files/upload")
                .insert_header(("Authorization", format!("Bearer {}", token(&h))))
                .to_request();
            test::call_service(&app, req).await;

            assert!(received(&mut rx).is_none());
        }

        /// Every tab and device the user has open gets the signal — that is the whole point, and
        /// the hub keeps one sender per connection to make it possible.
        #[actix_web::test]
        async fn every_connection_the_user_has_open_is_signalled() {
            let h = harness();
            let (mut first, _s1) = h.hub.subscribe(USER);
            let (mut second, _s2) = h.hub.subscribe(USER);
            let app = service!(h);

            let req = test::TestRequest::post()
                .uri("/api/v1/drive/files/upload")
                .insert_header(("Authorization", format!("Bearer {}", token(&h))))
                .to_request();
            test::call_service(&app, req).await;

            assert!(received(&mut first).is_some());
            assert!(received(&mut second).is_some());
        }

        /// A burst collapses rather than pushing a message per write: a Takeout import writes
        /// thousands of files, and one signal per file would have every other open tab refetch a
        /// folder listing thousands of times.
        #[actix_web::test]
        async fn a_burst_of_writes_collapses_to_one_signal() {
            let h = harness();
            let (mut rx, _slot) = h.hub.subscribe(USER);
            let app = service!(h);

            for _ in 0..50 {
                let req = test::TestRequest::post()
                    .uri("/api/v1/drive/files/upload")
                    .insert_header(("Authorization", format!("Bearer {}", token(&h))))
                    .to_request();
                test::call_service(&app, req).await;
            }

            assert!(received(&mut rx).is_some(), "the first write signals immediately");
            assert!(
                received(&mut rx).is_none(),
                "the remaining 49 should be waiting on the coalescing window, not on the wire"
            );
        }
    }

    #[test]
    fn drive_writes_signal() {
        for path in [
            "/api/v1/drive/files/upload",
            "/api/v1/drive/files",
            "/api/v1/drive/folders",
            "/api/v1/drive/folders/abc",
            "/api/v1/drive/bulk/move",
            "/api/v1/drive/bulk/trash",
            "/api/v1/drive/trash",
            "/api/v1/drive/trash/files/abc/restore",
            "/api/v1/drive/shortcuts",
            "/api/v1/drive/tags/abc/files",
            "/api/v1/drive/teams/abc/files",
        ] {
            assert!(changes_drive_listing(path), "{path} should signal");
        }
    }

    /// A photo is a Drive file, so registering one changes My Drive as well as the photo grid —
    /// and an upload from the iOS app is the exact case this feature was reported for.
    #[test]
    fn photo_writes_signal() {
        for path in [
            "/api/v1/photos",
            "/api/v1/photos/abc",
            "/api/v1/photos/abc/metadata",
            "/api/v1/photos/trash",
            "/api/v1/albums",
            "/api/v1/albums/abc/items",
        ] {
            assert!(changes_drive_listing(path), "{path} should signal");
        }
    }

    #[test]
    fn the_notification_inbox_and_comments_do_not_signal() {
        for path in [
            "/api/v1/drive/notifications/abc/read",
            "/api/v1/drive/notifications/read-all",
            "/api/v1/drive/comments",
            "/api/v1/drive/comments/abc",
        ] {
            assert!(!changes_drive_listing(path), "{path} should not signal");
        }
    }

    /// The one write on a timer, and the one that cannot change a folder's membership. A tab left
    /// open on Drive beside a spreadsheet would otherwise refetch its listing every three seconds
    /// for as long as somebody was typing.
    #[test]
    fn autosave_does_not_signal() {
        assert!(!changes_drive_listing("/api/v1/drive/files/abc/autosave"));
    }

    /// The exclusion is the autosave route itself, not anything whose id merely contains the word
    /// — and an explicit "save a version" is a deliberate act, not a cadence, so it still signals.
    #[test]
    fn only_the_autosave_route_is_excluded() {
        assert!(changes_drive_listing("/api/v1/drive/files/autosave-notes/versions"));
        assert!(changes_drive_listing("/api/v1/drive/files/abc/versions"));
    }

    #[test]
    fn unrelated_areas_do_not_signal() {
        for path in [
            "/api/v1/calendar/events",
            "/api/v1/ai/complete",
            "/api/v1/auth/profile",
            "/api/v1/sheets/named-ranges",
            "/api/v1/links",
            "/api/v1/admin/fonts",
            "/health",
            "/",
        ] {
            assert!(!changes_drive_listing(path), "{path} should not signal");
        }
    }

    /// The area match is on a path segment, not a string prefix, so a future top-level route whose
    /// name merely starts with an area's name is not swept in.
    #[test]
    fn an_area_match_respects_segment_boundaries() {
        assert!(!changes_drive_listing("/api/v1/photoshop"));
        assert!(!changes_drive_listing("/api/v1/albumsomething"));
        assert!(!changes_drive_listing("/api/v1/driveby/files"));
    }

    #[test]
    fn reads_never_signal() {
        assert!(!is_mutating(&Method::GET));
        assert!(!is_mutating(&Method::HEAD));
        assert!(!is_mutating(&Method::OPTIONS));
    }

    #[test]
    fn every_write_method_signals() {
        for method in [Method::POST, Method::PUT, Method::PATCH, Method::DELETE] {
            assert!(is_mutating(&method), "{method} should be treated as a write");
        }
    }
}
