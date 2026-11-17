//! `/dav` end to end: the real routes, services and migrations over an in-memory database,
//! driven the way Apple Calendar and Apple Reminders drive a CalDAV account.

use std::sync::Arc;

use actix_web::http::{Method, StatusCode};
use actix_web::{test, web, App};
use base64::Engine;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel_migrations::MigrationHarness;

use super::DavState;
use crate::auth::app_passwords::dto::CreateAppPasswordRequest;
use crate::auth::app_passwords::service::AppPasswordsService;
use crate::auth::signup_guard::client_ip::ClientIpSource;
use crate::calendar::calendars::service::CalendarsService;
use crate::calendar::events::attendees::AttendeesRepository;
use crate::calendar::events::dto::{CreateEventRequest, UpdateEventRequest};
use crate::calendar::events::repository::EventsRepository;
use crate::calendar::events::service::EventsService;
use crate::calendar::tasks::dto::CreateTaskListRequest;
use crate::calendar::tasks::repository::TasksRepository;
use crate::calendar::tasks::service::TasksService;
use crate::shared::{AuthenticatedUser, DbPool};

struct Harness {
    pool: DbPool,
    state: web::Data<DavState>,
    user: AuthenticatedUser,
    auth: String,
}

fn harness() -> Harness {
    let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
    let pool = Pool::builder().max_size(1).build(manager).unwrap();
    pool.get()
        .unwrap()
        .run_pending_migrations(crate::MIGRATIONS)
        .unwrap();
    diesel::sql_query(
        "INSERT INTO users (id, email, name, password_hash, created_at, role) \
         VALUES ('u1', 'ada@example.com', 'Ada', 'x', CURRENT_TIMESTAMP, 'user')",
    )
    .execute(&mut pool.get().unwrap())
    .unwrap();
    let user = AuthenticatedUser {
        user_id: "u1".into(),
        email: "ada@example.com".into(),
        token: String::new(),
        is_admin: false,
    };
    let events = Arc::new(EventsService::new(
        Arc::new(EventsRepository::new(pool.clone())),
        Arc::new(AttendeesRepository::new(pool.clone())),
    ));
    let tasks = Arc::new(TasksService::new(Arc::new(TasksRepository::new(pool.clone())), events.clone()));
    let app_passwords = Arc::new(AppPasswordsService::new(pool.clone()));
    let password = app_passwords
        .create(&user, CreateAppPasswordRequest { name: "iPhone".into() })
        .unwrap()
        .password;
    let auth = format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(format!("ada@example.com:{password}"))
    );
    let state = web::Data::new(DavState {
        pool: pool.clone(),
        events,
        tasks,
        calendars: Arc::new(CalendarsService::new(pool.clone())),
        app_passwords,
        client_ip: ClientIpSource::default(),
    });
    Harness { pool, state, user, auth }
}

macro_rules! app {
    ($h:expr) => {
        test::init_service(App::new().app_data($h.state.clone()).configure(super::configure)).await
    };
}

/// Sends one request: `(status, body, ETag)`.
macro_rules! call {
    ($app:expr, $h:expr, $method:expr, $path:expr, $headers:expr, $body:expr) => {{
        let mut req = test::TestRequest::default()
            .method(Method::from_bytes($method.as_bytes()).unwrap())
            .uri(&$path)
            .insert_header(("Authorization", $h.auth.as_str()))
            .set_payload($body.to_string());
        let headers: &[(&str, &str)] = $headers;
        for (k, v) in headers {
            req = req.insert_header((*k, *v));
        }
        let res = test::call_service($app, req.to_request()).await;
        let status: StatusCode = res.status();
        let etag: Option<String> = res
            .headers()
            .get("ETag")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let body = String::from_utf8(test::read_body(res).await.to_vec()).unwrap();
        (status, body, etag)
    }};
}

fn default_calendar(h: &Harness) -> String {
    let mut conn = h.pool.get().unwrap();
    crate::calendar::calendars::store::default_calendar(&mut conn, "u1", chrono::Utc::now().naive_utc())
        .unwrap()
        .id
}

fn count(h: &Harness, sql: &str) -> i64 {
    #[derive(QueryableByName)]
    struct N {
        #[diesel(sql_type = diesel::sql_types::BigInt)]
        n: i64,
    }
    diesel::sql_query(sql)
        .get_result::<N>(&mut h.pool.get().unwrap())
        .unwrap()
        .n
}

const EVENT: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Apple Inc.//iPhone OS 26//EN\r\nBEGIN:VEVENT\r\nUID:4F2A-SIRI\r\nDTSTAMP:20261116T163700Z\r\nDTSTART;TZID=America/Los_Angeles:20261123T110000\r\nDTEND;TZID=America/Los_Angeles:20261123T120000\r\nSUMMARY:Appointment: Visit at Sutter Health\r\nX-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT30M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

#[actix_web::test]
async fn an_unsigned_request_is_challenged_and_the_well_known_path_redirects() {
    let h = harness();
    let app = app!(h);
    let req = test::TestRequest::default()
        .method(Method::from_bytes(b"PROPFIND").unwrap())
        .uri("/dav/")
        .to_request();
    let res = test::call_service(&app, req).await;
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    assert!(res.headers().get("WWW-Authenticate").is_some());
    let req = test::TestRequest::default()
        .method(Method::from_bytes(b"PROPFIND").unwrap())
        .uri("/.well-known/caldav")
        .to_request();
    let res = test::call_service(&app, req).await;
    assert_eq!(res.status(), StatusCode::MOVED_PERMANENTLY);
    assert_eq!(res.headers().get("Location").unwrap(), "/dav/");
    let options = test::TestRequest::default().method(Method::OPTIONS).uri("/dav/").to_request();
    let res = test::call_service(&app, options).await;
    assert!(res.headers().get("DAV").unwrap().to_str().unwrap().contains("calendar-access"));
}

#[actix_web::test]
async fn discovery_finds_the_principal_the_home_and_both_kinds_of_collection() {
    let h = harness();
    let cal = default_calendar(&h);
    h.state
        .tasks
        .create_task_list(&h.user, CreateTaskListRequest { name: "Groceries".into(), color: Some("#ff9500".into()) })
        .unwrap();
    let app = app!(h);
    let body = r#"<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>"#;
    let (s, xml, _) = call!(&app, &h, "PROPFIND", "/dav/", &[("Depth", "0")], body);
    assert_eq!(s, StatusCode::MULTI_STATUS);
    assert!(xml.contains("<d:href>/dav/principals/u1/</d:href>"));

    let body = r#"<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/><c:calendar-user-address-set/></d:prop></d:propfind>"#;
    let (_, xml, _) = call!(&app, &h, "PROPFIND", "/dav/principals/u1/", &[("Depth", "0")], body);
    assert!(xml.contains("<d:href>/dav/calendars/u1/</d:href>"));
    assert!(xml.contains("mailto:ada@example.com"));

    let body = r#"<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><cs:getctag/><d:sync-token/></d:prop></d:propfind>"#;
    let (_, xml, _) = call!(&app, &h, "PROPFIND", "/dav/calendars/u1/", &[("Depth", "1")], body);
    assert!(xml.contains(&format!("/dav/calendars/u1/cal-{cal}/")));
    assert!(xml.contains("<d:displayname>Groceries</d:displayname>"));
    assert!(xml.contains("<d:displayname>Tasks</d:displayname>"));
    assert!(xml.contains("<c:comp name=\"VEVENT\"/>"));
    assert!(xml.contains("<c:comp name=\"VTODO\"/>"));
    assert!(xml.contains("<c:calendar/>"));
}

#[actix_web::test]
async fn siris_add_lands_in_the_neutrino_calendar_and_reads_back_with_its_alarm() {
    let h = harness();
    let cal = default_calendar(&h);
    let app = app!(h);
    let path = format!("/dav/calendars/u1/cal-{cal}/4F2A-SIRI.ics");
    let (s, _, _) = call!(&app, &h, "PUT", &path, &[("If-None-Match", "*")], EVENT);
    assert_eq!(s, StatusCode::CREATED);
    // In Neutrino, at 11:00 Los Angeles time (19:00 UTC).
    let events = h.state.events.list_events(&h.user, Default::default()).unwrap();
    assert_eq!(events.events.len(), 1);
    assert_eq!(events.events[0].title, "Appointment: Visit at Sutter Health");
    assert_eq!(events.events[0].start_time, "2026-11-23T19:00:00Z");
    assert_eq!(events.events[0].timezone.as_deref(), Some("America/Los_Angeles"));

    let (s, ics, etag) = call!(&app, &h, "GET", &path, &[], "");
    assert_eq!(s, StatusCode::OK);
    assert!(ics.contains("UID:4F2A-SIRI\r\n"));
    assert!(ics.contains("DTSTART;TZID=America/Los_Angeles:20261123T110000\r\n"));
    assert!(ics.contains("TRIGGER:-PT30M\r\n"));
    assert!(ics.contains("X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC\r\n"));

    // Creating it again is refused; replacing it needs the current ETag.
    let (s, _, _) = call!(&app, &h, "PUT", &path, &[("If-None-Match", "*")], EVENT);
    assert_eq!(s, StatusCode::PRECONDITION_FAILED);
    let (s, _, _) = call!(&app, &h, "PUT", &path, &[("If-Match", "\"stale\"")], EVENT);
    assert_eq!(s, StatusCode::PRECONDITION_FAILED);
    let moved = EVENT.replace("T110000", "T140000").replace("T120000", "T150000");
    let (s, _, _) = call!(&app, &h, "PUT", &path, &[("If-Match", etag.as_deref().unwrap())], &moved);
    assert_eq!(s, StatusCode::NO_CONTENT);
    let events = h.state.events.list_events(&h.user, Default::default()).unwrap();
    assert_eq!(events.events.len(), 1);
    assert_eq!(events.events[0].start_time, "2026-11-23T22:00:00Z");

    let (s, _, _) = call!(&app, &h, "DELETE", &path, &[], "");
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert!(h.state.events.list_events(&h.user, Default::default()).unwrap().events.is_empty());
    let (s, _, _) = call!(&app, &h, "GET", &path, &[], "");
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn sync_collection_reports_changes_from_every_path_and_deletions_by_the_clients_name() {
    let h = harness();
    let cal = default_calendar(&h);
    let app = app!(h);
    let coll = format!("/dav/calendars/u1/cal-{cal}/");
    // Made in Neutrino, before the phone ever synced.
    let made = h
        .state
        .events
        .create_event(
            &h.user,
            CreateEventRequest {
                title: "Lunch".into(),
                description: None,
                start_time: "2026-11-20T20:00:00Z".into(),
                end_time: "2026-11-20T21:00:00Z".into(),
                all_day: false,
                location: None,
                recurrence_rule: None,
                attendees: vec![],
                timezone: None,
                calendar_id: None,
            },
        )
        .unwrap();
    let report = |token: &str| {
        format!(
            r#"<d:sync-collection xmlns:d="DAV:"><d:sync-token>{token}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>"#
        )
    };
    let token_of = |xml: &str| {
        let start = xml.find("<d:sync-token>").unwrap() + "<d:sync-token>".len();
        let end = xml[start..].find("</d:sync-token>").unwrap() + start;
        xml[start..end].to_string()
    };
    let (s, xml, _) = call!(&app, &h, "REPORT", &coll, &[], &report(""));
    assert_eq!(s, StatusCode::MULTI_STATUS);
    assert!(xml.contains(&format!("{coll}{}.ics", made.id)));
    let first = token_of(&xml);

    // The phone adds one under its own name; the web renames the other.
    call!(&app, &h, "PUT", &format!("{coll}phone-1.ics"), &[], &EVENT.replace("4F2A-SIRI", "phone-1"));
    h.state
        .events
        .update_event(&h.user, &made.id, UpdateEventRequest { title: Some("Long lunch".into()), ..Default::default() })
        .unwrap();
    let (_, xml, _) = call!(&app, &h, "REPORT", &coll, &[], &report(&first));
    assert!(xml.contains(&format!("{coll}phone-1.ics")));
    assert!(xml.contains(&format!("{coll}{}.ics", made.id)));
    let second = token_of(&xml);

    // Nothing since: an empty answer.
    let (_, xml, _) = call!(&app, &h, "REPORT", &coll, &[], &report(&second));
    assert!(!xml.contains("<d:response>"));

    // Deleted on the web: reported gone under the name the phone gave it.
    let id: String = crate::schema::dav_objects::table
        .filter(crate::schema::dav_objects::name.eq("phone-1.ics"))
        .select(crate::schema::dav_objects::object_id)
        .first(&mut h.pool.get().unwrap())
        .unwrap();
    h.state.events.delete_event(&h.user, &id).unwrap();
    let (_, xml, _) = call!(&app, &h, "REPORT", &coll, &[], &report(&second));
    assert!(xml.contains(&format!("<d:href>{coll}phone-1.ics</d:href><d:status>HTTP/1.1 404 Not Found</d:status>")));

    // A token from nowhere is refused, which makes the client resync.
    let (s, xml, _) = call!(&app, &h, "REPORT", &coll, &[], &report("https://getneutrino.app/ns/sync/999999"));
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert!(xml.contains("valid-sync-token"));
}

#[actix_web::test]
async fn a_series_put_edits_cancels_and_restores_occurrences() {
    let h = harness();
    let cal = default_calendar(&h);
    let app = app!(h);
    let path = format!("/dav/calendars/u1/cal-{cal}/standup.ics");
    let series = |extra: &str, exdate: &str| {
        format!(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:standup\r\nDTSTART:20261102T170000Z\r\nDTEND:20261102T171500Z\r\nRRULE:FREQ=DAILY;COUNT=10\r\n{exdate}SUMMARY:Standup\r\nEND:VEVENT\r\n{extra}END:VCALENDAR\r\n"
        )
    };
    let moved = "BEGIN:VEVENT\r\nUID:standup\r\nRECURRENCE-ID:20261104T170000Z\r\nDTSTART:20261104T180000Z\r\nDTEND:20261104T181500Z\r\nSUMMARY:Standup (late)\r\nEND:VEVENT\r\n";
    let (s, _, _) = call!(&app, &h, "PUT", &path, &[], &series(moved, "EXDATE:20261105T170000Z\r\n"));
    assert_eq!(s, StatusCode::CREATED);
    let live = "SELECT COUNT(*) AS n FROM events WHERE recurring_event_id IS NOT NULL AND deleted_at IS NULL";
    assert_eq!(count(&h, live), 2);
    assert_eq!(count(&h, &format!("{live} AND cancelled = 1")), 1);
    let (_, ics, _) = call!(&app, &h, "GET", &path, &[], "");
    assert!(ics.contains("EXDATE:20261105T170000Z\r\n"));
    assert!(ics.contains("RECURRENCE-ID:20261104T170000Z\r\n"));
    assert!(ics.contains("SUMMARY:Standup (late)\r\n"));

    // The phone puts both occurrences back.
    let (s, _, _) = call!(&app, &h, "PUT", &path, &[], &series("", ""));
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(count(&h, live), 0);
    let (_, ics, _) = call!(&app, &h, "GET", &path, &[], "");
    assert!(!ics.contains("EXDATE"));
    assert!(!ics.contains("RECURRENCE-ID"));
}

const TODO: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:milk\r\nSUMMARY:Buy milk\r\nDUE;VALUE=DATE:20261117\r\nPRIORITY:1\r\nX-APPLE-SORT-ORDER:700000000\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";

#[actix_web::test]
async fn a_reminder_is_a_task_in_its_list_moves_between_lists_and_stays_deleted() {
    let h = harness();
    let list = h
        .state
        .tasks
        .create_task_list(&h.user, CreateTaskListRequest { name: "Groceries".into(), color: None })
        .unwrap();
    let app = app!(h);
    let inbox = "/dav/calendars/u1/list-inbox/";
    let groceries = format!("/dav/calendars/u1/list-{}/", list.id);

    let (s, _, _) = call!(&app, &h, "PUT", &format!("{inbox}milk.ics"), &[("If-None-Match", "*")], TODO);
    assert_eq!(s, StatusCode::CREATED);
    let tasks = h.state.tasks.list_tasks(&h.user, None).unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].title, "Buy milk");
    assert_eq!(tasks[0].priority, Some(1));
    assert_eq!(tasks[0].due_date.as_deref(), Some("2026-11-17T00:00:00Z"));
    assert!(!tasks[0].due_has_time);
    assert_eq!(tasks[0].list_id, None);

    // Reminders moves it to Groceries.
    let dest = format!("https://neutrino.example.com{groceries}milk.ics");
    let (s, _, _) = call!(&app, &h, "MOVE", &format!("{inbox}milk.ics"), &[("Destination", dest.as_str())], "");
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(h.state.tasks.list_tasks(&h.user, Some(&list.id)).unwrap().len(), 1);
    let (s, _, _) = call!(&app, &h, "GET", &format!("{inbox}milk.ics"), &[], "");
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, ics, _) = call!(&app, &h, "GET", &format!("{groceries}milk.ics"), &[], "");
    assert_eq!(s, StatusCode::OK);
    assert!(ics.contains("X-APPLE-SORT-ORDER:700000000\r\n"));
    assert!(ics.contains("PRIORITY:1\r\n"));

    let (s, _, _) = call!(&app, &h, "DELETE", &format!("{groceries}milk.ics"), &[], "");
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert!(h.state.tasks.list_tasks(&h.user, None).unwrap().is_empty());
    let report = r#"<d:sync-collection xmlns:d="DAV:"><d:sync-token>https://getneutrino.app/ns/sync/1</d:sync-token><d:prop><d:getetag/></d:prop></d:sync-collection>"#;
    let (_, xml, _) = call!(&app, &h, "REPORT", &groceries, &[], report);
    assert!(xml.contains(&format!("<d:href>{groceries}milk.ics</d:href><d:status>HTTP/1.1 404 Not Found</d:status>")));
}

#[actix_web::test]
async fn completing_a_repeating_reminder_makes_one_next_task_in_the_same_list() {
    let h = harness();
    let list = h
        .state
        .tasks
        .create_task_list(&h.user, CreateTaskListRequest { name: "Chores".into(), color: None })
        .unwrap();
    let app = app!(h);
    let path = format!("/dav/calendars/u1/list-{}/bins.ics", list.id);
    let open = "BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:bins\r\nSUMMARY:Take out the bins\r\nDUE;VALUE=DATE:20261117\r\nRRULE:FREQ=WEEKLY\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
    call!(&app, &h, "PUT", &path, &[], open);

    // Apple's way: the same reminder, still open, due a week later. Nothing is spawned.
    let advanced = open.replace("20261117", "20261124");
    let (s, _, _) = call!(&app, &h, "PUT", &path, &[], &advanced);
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(h.state.tasks.list_tasks(&h.user, None).unwrap().len(), 1);

    // Completed with its rule: Neutrino's way, which makes the next one, once.
    let done = advanced.replace("RRULE", "STATUS:COMPLETED\r\nRRULE");
    call!(&app, &h, "PUT", &path, &[], &done);
    call!(&app, &h, "PUT", &path, &[], &done);
    let in_list = h.state.tasks.list_tasks(&h.user, Some(&list.id)).unwrap();
    assert_eq!(in_list.len(), 2);
    let next = in_list.iter().find(|t| !t.done).unwrap();
    assert_eq!(next.due_date.as_deref(), Some("2026-12-01T00:00:00Z"));
}

#[actix_web::test]
async fn reminders_lists_are_made_renamed_and_served_where_the_client_put_them() {
    let h = harness();
    let app = app!(h);
    let body = r#"<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/"><d:set><d:prop><d:displayname>Packing</d:displayname><ic:calendar-color>#FF2968FF</ic:calendar-color><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>"#;
    let (s, _, _) = call!(&app, &h, "MKCALENDAR", "/dav/calendars/u1/ABC-123/", &[], body);
    assert_eq!(s, StatusCode::CREATED);
    let lists = h.state.tasks.list_task_lists(&h.user).unwrap().task_lists;
    assert_eq!(lists.len(), 1);
    assert_eq!(lists[0].name, "Packing");
    assert_eq!(lists[0].color.as_deref(), Some("#ff2968"));

    let (s, _, _) = call!(&app, &h, "PUT", "/dav/calendars/u1/ABC-123/socks.ics", &[], &TODO.replace("milk", "socks"));
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(h.state.tasks.list_tasks(&h.user, Some(&lists[0].id)).unwrap().len(), 1);

    let rename = r#"<d:propertyupdate xmlns:d="DAV:"><d:set><d:prop><d:displayname>Packing list</d:displayname></d:prop></d:set></d:propertyupdate>"#;
    let (s, _, _) = call!(&app, &h, "PROPPATCH", "/dav/calendars/u1/ABC-123/", &[], rename);
    assert_eq!(s, StatusCode::MULTI_STATUS);
    assert_eq!(h.state.tasks.list_task_lists(&h.user).unwrap().task_lists[0].name, "Packing list");

    let (_, xml, _) = call!(&app, &h, "PROPFIND", "/dav/calendars/u1/", &[("Depth", "1")], "");
    assert!(xml.contains("/dav/calendars/u1/ABC-123/"));

    // Deleting the list keeps its task, now in no list.
    let (s, _, _) = call!(&app, &h, "DELETE", "/dav/calendars/u1/ABC-123/", &[], "");
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(h.state.tasks.list_tasks(&h.user, None).unwrap().len(), 1);
    let (s, _, _) = call!(&app, &h, "GET", "/dav/calendars/u1/list-inbox/socks.ics", &[], "");
    assert_eq!(s, StatusCode::OK);
}

#[actix_web::test]
async fn a_query_for_open_reminders_leaves_out_completed_ones() {
    let h = harness();
    let app = app!(h);
    call!(&app, &h, "PUT", "/dav/calendars/u1/list-inbox/a.ics", &[], &TODO.replace("milk", "a"));
    let done = TODO.replace("milk", "b").replace("PRIORITY:1", "STATUS:COMPLETED");
    call!(&app, &h, "PUT", "/dav/calendars/u1/list-inbox/b.ics", &[], &done);
    let query = r#"<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"><c:prop-filter name="COMPLETED"><c:is-not-defined/></c:prop-filter></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>"#;
    let (_, xml, _) = call!(&app, &h, "REPORT", "/dav/calendars/u1/list-inbox/", &[], query);
    assert!(xml.contains("/list-inbox/a.ics"));
    assert!(!xml.contains("/list-inbox/b.ics"));
}

#[actix_web::test]
async fn another_users_collections_are_not_found_and_bad_data_is_refused() {
    let h = harness();
    let cal = default_calendar(&h);
    let app = app!(h);
    let (s, _, _) = call!(&app, &h, "PROPFIND", "/dav/calendars/u2/", &[], "");
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, xml, _) = call!(&app, &h, "PUT", &format!("/dav/calendars/u1/cal-{cal}/x.ics"), &[], "not ical");
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(xml.contains("valid-calendar-data"));
    // A reminder can't go into a calendar.
    let (s, _, _) = call!(&app, &h, "PUT", &format!("/dav/calendars/u1/cal-{cal}/t.ics"), &[], TODO);
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[actix_web::test]
async fn a_user_with_no_changes_is_not_told_to_resync_once_the_log_is_trimmed() {
    let h = harness();
    let cal = default_calendar(&h);
    let app = app!(h);
    let coll = format!("/dav/calendars/u1/cal-{cal}/");
    let report = |token: &str| {
        format!(r#"<d:sync-collection xmlns:d="DAV:"><d:sync-token>{token}</d:sync-token><d:prop><d:getetag/></d:prop></d:sync-collection>"#)
    };
    // The first sync of an empty calendar: token 0.
    let (_, xml, _) = call!(&app, &h, "REPORT", coll.clone(), &[], report(""));
    assert!(xml.contains("https://getneutrino.app/ns/sync/0"));
    // Other users' changes, the oldest of them since purged.
    let mut conn = h.pool.get().unwrap();
    diesel::sql_query("INSERT INTO dav_changes (user_id, kind, object_id) VALUES ('u2', 'event', 'x'), ('u2', 'event', 'y')")
        .execute(&mut conn)
        .unwrap();
    diesel::sql_query("DELETE FROM dav_changes WHERE object_id = 'x'").execute(&mut conn).unwrap();
    drop(conn);
    let (s, _, _) = call!(&app, &h, "REPORT", coll.clone(), &[], report("https://getneutrino.app/ns/sync/0"));
    assert_eq!(s, StatusCode::MULTI_STATUS);
}
