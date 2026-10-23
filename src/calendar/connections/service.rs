use crate::calendar::connections::dto::{
    ConnectAppleRequest, ConnectionResponse, ListConnectionsResponse, OAuthInitResponse,
    TriggerSyncRequest,
};
use crate::calendar::connections::model::{ConnectionRecord, NewConnectionRecord};
use crate::calendar::connections::repository::ConnectionsRepository;
use crate::calendar::connections::{apple, google, outlook};
use crate::calendar::events::model::NewEventRecord;
use crate::calendar::events::repository::EventsRepository;
use crate::config::OAuthConfig;
use crate::shared::{ApiError, AuthenticatedUser};
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

pub struct ConnectionsService {
    repo: Arc<ConnectionsRepository>,
    events_repo: Arc<EventsRepository>,
    oauth: OAuthConfig,
    http: reqwest::Client,
}

impl ConnectionsService {
    pub fn new(
        repo: Arc<ConnectionsRepository>,
        events_repo: Arc<EventsRepository>,
        oauth: OAuthConfig,
    ) -> Self {
        ConnectionsService {
            repo,
            events_repo,
            oauth,
            http: reqwest::Client::new(),
        }
    }

    // ── List ─────────────────────────────────────────────────────────────────

    pub fn list_connections(
        &self,
        user: &AuthenticatedUser,
    ) -> Result<ListConnectionsResponse, ApiError> {
        let records = self.repo.find_by_user(&user.user_id)?;
        let connections = records.into_iter().map(conn_to_response).collect();
        Ok(ListConnectionsResponse { connections })
    }

    // ── Google OAuth ──────────────────────────────────────────────────────────

    /// `origin` is the origin the browser reached us on; it decides the redirect
    /// URI when the deployment has not pinned one. `connect_google` must be
    /// called with the same origin, or the code exchange will not match.
    pub fn initiate_google(
        &self,
        user_id: &str,
        origin: Option<&str>,
    ) -> Result<OAuthInitResponse, ApiError> {
        let state = format!("{}:{}", user_id, Uuid::new_v4());
        let redirect_uri = self.oauth.google_redirect_uri(origin);
        let auth_url = google::build_auth_url(&self.oauth, &redirect_uri, &state)?;
        Ok(OAuthInitResponse { auth_url })
    }

    pub async fn connect_google(
        &self,
        user: &AuthenticatedUser,
        origin: Option<&str>,
        code: &str,
    ) -> Result<ConnectionResponse, ApiError> {
        let redirect_uri = self.oauth.google_redirect_uri(origin);
        let tokens = google::exchange_code(&self.oauth, &self.http, &redirect_uri, code).await?;

        let email = google::fetch_user_email(&self.http, &tokens.access_token).await;
        let expires_at = tokens
            .expires_in
            .map(|secs| Utc::now().naive_utc() + chrono::Duration::seconds(secs));

        let record = NewConnectionRecord {
            id: Uuid::new_v4().to_string(),
            user_id: user.user_id.clone(),
            provider: "google".to_string(),
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at,
            sync_cursor: None,
            created_at: Utc::now().naive_utc(),
            updated_at: Utc::now().naive_utc(),
            email,
            caldav_url: None,
        };

        self.save(record)
    }

    // ── Outlook OAuth ─────────────────────────────────────────────────────────

    /// As [`ConnectionsService::initiate_google`]. The caller's id goes in the
    /// state so the redirect endpoint — which the browser reaches with no JWT —
    /// still knows whose connection this is.
    pub fn initiate_outlook(
        &self,
        user_id: &str,
        origin: Option<&str>,
    ) -> Result<OAuthInitResponse, ApiError> {
        let state = format!("{}:{}", user_id, Uuid::new_v4());
        let redirect_uri = self.oauth.outlook_redirect_uri(origin);
        let auth_url = outlook::build_auth_url(&self.oauth, &redirect_uri, &state)?;
        Ok(OAuthInitResponse { auth_url })
    }

    pub async fn connect_outlook(
        &self,
        user: &AuthenticatedUser,
        origin: Option<&str>,
        code: &str,
    ) -> Result<ConnectionResponse, ApiError> {
        let redirect_uri = self.oauth.outlook_redirect_uri(origin);
        let tokens = outlook::exchange_code(&self.oauth, &self.http, &redirect_uri, code).await?;

        let email = outlook::fetch_user_email(&self.http, &tokens.access_token).await;
        let expires_at = tokens
            .expires_in
            .map(|secs| Utc::now().naive_utc() + chrono::Duration::seconds(secs));

        let record = NewConnectionRecord {
            id: Uuid::new_v4().to_string(),
            user_id: user.user_id.clone(),
            provider: "outlook".to_string(),
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at,
            sync_cursor: None,
            created_at: Utc::now().naive_utc(),
            updated_at: Utc::now().naive_utc(),
            email,
            caldav_url: None,
        };

        self.save(record)
    }

    // ── Apple CalDAV ──────────────────────────────────────────────────────────

    pub async fn connect_apple(
        &self,
        user: &AuthenticatedUser,
        req: ConnectAppleRequest,
    ) -> Result<ConnectionResponse, ApiError> {
        let token = apple::encode_credentials(&req.username, &req.password);

        // Verify connectivity before saving
        let display_name = apple::verify_connection(&self.http, &req.caldav_url, &token).await?;
        let email = display_name.or(Some(req.username.clone()));

        let record = NewConnectionRecord {
            id: Uuid::new_v4().to_string(),
            user_id: user.user_id.clone(),
            provider: "apple".to_string(),
            access_token: token,
            refresh_token: None,
            expires_at: None,
            sync_cursor: None,
            created_at: Utc::now().naive_utc(),
            updated_at: Utc::now().naive_utc(),
            email,
            caldav_url: Some(req.caldav_url),
        };

        self.save(record)
    }

    /// Stores a new connection and makes the calendar its events will sync into. Made now rather
    /// than on the first sync so the account shows up at once, in the calendar list and in
    /// Settings, with a colour the user can change before any event has arrived.
    fn save(&self, record: NewConnectionRecord) -> Result<ConnectionResponse, ApiError> {
        let saved = self.repo.upsert(record)?;
        self.events_repo
            .provider_calendar_id(&saved.user_id, &saved.provider)?;
        Ok(conn_to_response(saved))
    }

    // ── Disconnect ────────────────────────────────────────────────────────────

    pub fn disconnect(
        &self,
        user: &AuthenticatedUser,
        connection_id: &str,
    ) -> Result<(), ApiError> {
        self.repo.delete(connection_id, &user.user_id)
    }

    // ── Sync trigger ──────────────────────────────────────────────────────────

    pub async fn trigger_sync(
        &self,
        user: &AuthenticatedUser,
        req: TriggerSyncRequest,
    ) -> Result<usize, ApiError> {
        let connections = if let Some(id) = req.connection_id {
            vec![self.repo.find_by_id(&id, &user.user_id)?]
        } else {
            self.repo.find_by_user(&user.user_id)?
        };

        // Every connection is tried, but a failure is returned rather than a count: reporting
        // "Synced 0 events" for a sync that never reached the server is how a broken one hid.
        let mut total = 0usize;
        let mut failure = None;
        for conn in connections {
            let provider = conn.provider.clone();
            match self.sync_connection(conn).await {
                Ok(n) => total += n,
                Err(e) => {
                    tracing::error!("{} sync error: {:?}", provider, e);
                    failure = Some(e);
                }
            }
        }

        match failure {
            Some(e) => Err(e),
            None => Ok(total),
        }
    }

    // ── Internal sync ─────────────────────────────────────────────────────────

    async fn sync_connection(&self, conn: ConnectionRecord) -> Result<usize, ApiError> {
        match conn.provider.as_str() {
            "google" => self.sync_google(conn).await,
            "outlook" => self.sync_outlook(conn).await,
            "apple" => self.sync_apple(conn).await,
            other => {
                tracing::warn!("Unknown provider: {}", other);
                Ok(0)
            }
        }
    }

    async fn sync_google(&self, conn: ConnectionRecord) -> Result<usize, ApiError> {
        let (access_token, new_expiry, new_refresh) = google::ensure_valid_token(
            &self.oauth,
            &self.http,
            &conn.access_token,
            conn.refresh_token.as_deref(),
            conn.expires_at,
        )
        .await?;

        if new_expiry.is_some() || new_refresh.is_some() {
            self.repo.update_tokens(
                &conn.id,
                access_token.clone(),
                new_refresh.or(conn.refresh_token),
                new_expiry.or(conn.expires_at),
            )?;
        }

        let (events, next_cursor) = match google::fetch_events(
            &self.http,
            &access_token,
            conn.sync_cursor.as_deref(),
        )
        .await
        {
            Ok(r) => r,
            Err(e) if e.to_string().contains("sync token expired") => {
                // Reset cursor and do full sync
                self.repo.update_sync_cursor(&conn.id, None)?;
                google::fetch_events(&self.http, &access_token, None).await?
            }
            Err(e) => return Err(e),
        };

        tracing::info!(
            "Google sync: {} events for user {}",
            events.len(),
            conn.user_id
        );

        let calendar_id = self
            .events_repo
            .provider_calendar_id(&conn.user_id, "google")?;
        let now = Utc::now().naive_utc();
        let mut count = 0usize;
        for ev in events {
            if ev.status.as_deref() == Some("cancelled") {
                self.events_repo
                    .delete_by_external(&conn.user_id, "google", &ev.id)
                    .ok();
                continue;
            }

            let Some((start, all_day)) = google::parse_google_dt(&ev.start) else {
                continue;
            };
            let Some((end, _)) = google::parse_google_dt(&ev.end) else {
                continue;
            };

            let rrule = ev.recurrence.and_then(|rules| {
                rules
                    .into_iter()
                    .find(|r| r.starts_with("RRULE:"))
                    .map(|r| r["RRULE:".len()..].to_string())
            });

            let record = NewEventRecord {
                id: Uuid::new_v4().to_string(),
                user_id: conn.user_id.clone(),
                title: ev.summary.unwrap_or_else(|| "(No title)".to_string()),
                description: ev.description,
                start_time: start,
                end_time: end,
                all_day,
                location: ev.location,
                recurrence_rule: rrule,
                external_id: Some(ev.id),
                source: "google".to_string(),
                created_at: now,
                updated_at: now,
                timezone: None,
                recurring_event_id: None,
                original_start_time: None,
                cancelled: false,
                calendar_id: Some(calendar_id.clone()),
            };

            self.events_repo
                .upsert_from_sync(&conn.user_id, "google", record)?;
            count += 1;
        }

        if next_cursor.is_some() {
            self.repo.update_sync_cursor(&conn.id, next_cursor)?;
        }

        Ok(count)
    }

    async fn sync_outlook(&self, conn: ConnectionRecord) -> Result<usize, ApiError> {
        let (access_token, new_expiry, new_refresh) = outlook::ensure_valid_token(
            &self.oauth,
            &self.http,
            &conn.access_token,
            conn.refresh_token.as_deref(),
            conn.expires_at,
        )
        .await?;

        if new_expiry.is_some() || new_refresh.is_some() {
            self.repo.update_tokens(
                &conn.id,
                access_token.clone(),
                new_refresh.or(conn.refresh_token),
                new_expiry.or(conn.expires_at),
            )?;
        }

        let (events, next_cursor) =
            outlook::fetch_events(&self.http, &access_token, conn.sync_cursor.as_deref()).await?;

        tracing::info!(
            "Outlook sync: {} events for user {}",
            events.len(),
            conn.user_id
        );

        let calendar_id = self
            .events_repo
            .provider_calendar_id(&conn.user_id, "outlook")?;
        let now = Utc::now().naive_utc();
        let mut count = 0usize;
        for ev in events {
            if outlook::is_removed(&ev) {
                self.events_repo
                    .delete_by_external(&conn.user_id, "outlook", &ev.id)
                    .ok();
                continue;
            }

            let Some(start) = outlook::parse_outlook_dt(&ev.start) else {
                continue;
            };
            let Some(end) = outlook::parse_outlook_dt(&ev.end) else {
                continue;
            };

            let record = NewEventRecord {
                id: Uuid::new_v4().to_string(),
                user_id: conn.user_id.clone(),
                title: ev.subject.unwrap_or_else(|| "(No title)".to_string()),
                description: ev.body_preview,
                start_time: start,
                end_time: end,
                all_day: ev.is_all_day.unwrap_or(false),
                location: ev.location.and_then(|l| l.display_name),
                recurrence_rule: None, // Outlook uses structured recurrence, not RRULE
                external_id: Some(ev.id),
                source: "outlook".to_string(),
                created_at: now,
                updated_at: now,
                timezone: None,
                recurring_event_id: None,
                original_start_time: None,
                cancelled: false,
                calendar_id: Some(calendar_id.clone()),
            };

            self.events_repo
                .upsert_from_sync(&conn.user_id, "outlook", record)?;
            count += 1;
        }

        if next_cursor.is_some() {
            self.repo.update_sync_cursor(&conn.id, next_cursor)?;
        }

        Ok(count)
    }

    async fn sync_apple(&self, conn: ConnectionRecord) -> Result<usize, ApiError> {
        let caldav_url = conn
            .caldav_url
            .as_deref()
            .unwrap_or(apple::DEFAULT_CALDAV_URL);

        let events = apple::fetch_events(&self.http, caldav_url, &conn.access_token).await?;

        tracing::info!(
            "Apple CalDAV sync: {} events for user {}",
            events.len(),
            conn.user_id
        );

        self.store_apple(&conn.user_id, events)
    }

    /// Writes what an iCloud sync fetched: series and one-offs, then their exceptions.
    fn store_apple(
        &self,
        user_id: &str,
        events: Vec<apple::CalDavEvent>,
    ) -> Result<usize, ApiError> {
        let calendar_id = self.events_repo.provider_calendar_id(user_id, "apple")?;
        let now = Utc::now().naive_utc();
        let SyncedSeries { events, exceptions } = apple_records(user_id, &calendar_id, events, now);

        // Series and one-off events first, so their exceptions have a row to point at.
        let mut count = 0usize;
        let mut ids = std::collections::HashMap::new();
        for (uid, record) in events {
            match record {
                Some(record) => {
                    let id = self
                        .events_repo
                        .upsert_from_sync(user_id, "apple", record)?;
                    ids.insert(uid, id);
                    count += 1;
                }
                None => {
                    self.events_repo
                        .delete_by_external(user_id, "apple", &uid)
                        .ok();
                }
            }
        }
        for (uid, mut record) in exceptions {
            // One whose series iCloud didn't send is kept as an event of its own.
            match ids.get(&uid) {
                Some(series) => record.recurring_event_id = Some(series.clone()),
                None => {
                    record.original_start_time = None;
                    if record.cancelled {
                        continue;
                    }
                }
            }
            self.events_repo
                .upsert_from_sync(user_id, "apple", record)?;
        }

        Ok(count)
    }
}

// ── Apple records ─────────────────────────────────────────────────────────────

/// An iCloud account's events as rows: each series or one-off by its UID (`None` for one iCloud
/// reports cancelled), then the series' exceptions. An exception shares its series' UID, as RFC
/// 5545 has it, so it is keyed by the UID and the occurrence it replaces; without that, every
/// edited occurrence overwrote its whole series. Its `recurring_event_id` is left for the caller,
/// who knows the series' row.
struct SyncedSeries {
    events: Vec<(String, Option<NewEventRecord>)>,
    exceptions: Vec<(String, NewEventRecord)>,
}

fn apple_records(
    user_id: &str,
    calendar_id: &str,
    synced: Vec<apple::CalDavEvent>,
    now: chrono::NaiveDateTime,
) -> SyncedSeries {
    let occurrence_key =
        |uid: &str, at: chrono::NaiveDateTime| format!("{}#{}", uid, at.format("%Y%m%dT%H%M%SZ"));
    let record = |ev: &apple::CalDavEvent, external_id: String| NewEventRecord {
        id: Uuid::new_v4().to_string(),
        user_id: user_id.to_string(),
        title: ev.summary.clone().unwrap_or_else(|| "(No title)".to_string()),
        description: ev.description.clone(),
        start_time: ev.start,
        end_time: ev.end,
        all_day: ev.all_day,
        location: ev.location.clone(),
        recurrence_rule: None,
        external_id: Some(external_id),
        source: "apple".to_string(),
        created_at: now,
        updated_at: now,
        timezone: ev.timezone.clone(),
        recurring_event_id: None,
        original_start_time: None,
        cancelled: false,
        calendar_id: Some(calendar_id.to_string()),
    };

    let mut out = SyncedSeries {
        events: Vec::new(),
        exceptions: Vec::new(),
    };
    for ev in &synced {
        if let Some(original) = ev.recurrence_id {
            let mut exception = record(ev, occurrence_key(&ev.uid, original));
            exception.original_start_time = Some(original);
            exception.cancelled = ev.cancelled;
            out.exceptions.push((ev.uid.clone(), exception));
            continue;
        }
        if ev.cancelled {
            out.events.push((ev.uid.clone(), None));
            continue;
        }
        let mut series = record(ev, ev.uid.clone());
        series.recurrence_rule = ev.rrule.clone();
        out.events.push((ev.uid.clone(), Some(series)));

        // A deleted occurrence is a cancelled exception, as the clients' own deletes are; it
        // keeps the series' fields and length, moved to the occurrence.
        if ev.rrule.is_some() {
            let length = ev.end - ev.start;
            for &at in &ev.exdates {
                let mut cancelled = record(ev, occurrence_key(&ev.uid, at));
                cancelled.start_time = at;
                cancelled.end_time = at + length;
                cancelled.original_start_time = Some(at);
                cancelled.cancelled = true;
                out.exceptions.push((ev.uid.clone(), cancelled));
            }
        }
    }
    out
}

// ── Helper ────────────────────────────────────────────────────────────────────

fn conn_to_response(r: ConnectionRecord) -> ConnectionResponse {
    ConnectionResponse {
        id: r.id,
        provider: r.provider,
        email: r.email,
        caldav_url: r.caldav_url,
        expires_at: r
            .expires_at
            .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        sync_cursor: r.sync_cursor,
        created_at: r.created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calendar::calendars::model::{CONNECTION, CalendarRecord};
    use crate::schema::calendars;
    use diesel::prelude::*;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel_migrations::MigrationHarness;

    type TestPool = Pool<ConnectionManager<SqliteConnection>>;

    fn service() -> (ConnectionsService, TestPool) {
        // One connection, so the `:memory:` database persists across calls.
        let pool = Pool::builder()
            .max_size(1)
            .build(ConnectionManager::<SqliteConnection>::new(":memory:"))
            .expect("pool");
        pool.get()
            .unwrap()
            .run_pending_migrations(crate::MIGRATIONS)
            .expect("migrations");
        let oauth = OAuthConfig {
            google_client_id: None,
            google_client_secret: None,
            google_redirect_uri: None,
            outlook_client_id: None,
            outlook_client_secret: None,
            outlook_redirect_uri: None,
            base_url: "http://localhost:8080".into(),
        };
        let svc = ConnectionsService::new(
            Arc::new(ConnectionsRepository::new(pool.clone())),
            Arc::new(EventsRepository::new(pool.clone())),
            oauth,
        );
        (svc, pool)
    }

    fn record(user_id: &str, provider: &str) -> NewConnectionRecord {
        let now = Utc::now().naive_utc();
        NewConnectionRecord {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.into(),
            provider: provider.into(),
            access_token: "token".into(),
            refresh_token: None,
            expires_at: None,
            sync_cursor: None,
            created_at: now,
            updated_at: now,
            email: None,
            caldav_url: None,
        }
    }

    fn provider_calendars(pool: &TestPool, user_id: &str) -> Vec<CalendarRecord> {
        calendars::table
            .filter(calendars::user_id.eq(user_id))
            .filter(calendars::kind.eq(CONNECTION))
            .select(CalendarRecord::as_select())
            .load(&mut pool.get().unwrap())
            .unwrap()
    }

    #[test]
    fn connecting_makes_the_providers_calendar_before_any_sync() {
        let (svc, pool) = service();
        svc.save(record("u1", "apple")).unwrap();
        let made = provider_calendars(&pool, "u1");
        assert_eq!(made.len(), 1);
        assert_eq!(made[0].source.as_deref(), Some("apple"));
        assert_eq!(made[0].name, "Apple Calendar");
    }

    #[test]
    fn reconnecting_keeps_the_calendar_and_its_colour() {
        let (svc, pool) = service();
        svc.save(record("u1", "google")).unwrap();
        let id = provider_calendars(&pool, "u1")[0].id.clone();
        diesel::update(calendars::table.filter(calendars::id.eq(&id)))
            .set(calendars::color.eq("#8b5cf6"))
            .execute(&mut pool.get().unwrap())
            .unwrap();

        svc.save(record("u1", "google")).unwrap();
        let after = provider_calendars(&pool, "u1");
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].id, id);
        assert_eq!(after[0].color, "#8b5cf6");
    }

    fn at(s: &str) -> chrono::NaiveDateTime {
        chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }

    fn caldav(uid: &str, title: &str, start: &str, end: &str) -> apple::CalDavEvent {
        apple::CalDavEvent {
            uid: uid.into(),
            summary: Some(title.into()),
            description: None,
            location: None,
            start: at(start),
            end: at(end),
            all_day: false,
            rrule: None,
            cancelled: false,
            timezone: Some("America/Los_Angeles".into()),
            recurrence_id: None,
            exdates: Vec::new(),
        }
    }

    fn icloud() -> Vec<apple::CalDavEvent> {
        let mut series = caldav("s", "Standup", "2026-10-06 19:00", "2026-10-06 20:00");
        series.rrule = Some("FREQ=WEEKLY".into());
        series.exdates = vec![at("2026-10-13 19:00")];
        let mut moved = caldav("s", "Standup (moved)", "2026-10-20 22:00", "2026-10-20 23:00");
        moved.recurrence_id = Some(at("2026-10-20 19:00"));
        vec![series, moved, caldav("one", "Dentist", "2026-10-22 17:00", "2026-10-22 18:00")]
    }

    #[test]
    fn an_icloud_series_keeps_its_rule_and_its_exceptions_point_at_it() {
        use crate::schema::events;
        let (svc, pool) = service();
        // Twice: a second sync updates the same rows rather than adding more.
        assert_eq!(svc.store_apple("u1", icloud()).unwrap(), 2);
        assert_eq!(svc.store_apple("u1", icloud()).unwrap(), 2);

        type Row = (
            String,
            String,
            Option<String>,
            Option<String>,
            Option<chrono::NaiveDateTime>,
            bool,
        );
        let rows: Vec<Row> = events::table
            .filter(events::user_id.eq("u1"))
            .order(events::start_time.asc())
            .select((
                events::id,
                events::title,
                events::recurrence_rule,
                events::recurring_event_id,
                events::original_start_time,
                events::cancelled,
            ))
            .load(&mut pool.get().unwrap())
            .unwrap();
        assert_eq!(rows.len(), 4, "{rows:?}");
        let series = rows.iter().find(|r| r.2.is_some()).unwrap();
        assert_eq!(series.1, "Standup", "the edited occurrence didn't overwrite its series");

        let deleted = rows.iter().find(|r| r.5).unwrap();
        assert_eq!(deleted.3.as_ref(), Some(&series.0));
        assert_eq!(deleted.4, Some(at("2026-10-13 19:00")));

        let moved = rows.iter().find(|r| r.1 == "Standup (moved)").unwrap();
        assert_eq!(moved.3.as_ref(), Some(&series.0));
        assert_eq!(moved.4, Some(at("2026-10-20 19:00")));
        assert!(moved.2.is_none(), "an exception never repeats");

        let one_off = rows.iter().find(|r| r.1 == "Dentist").unwrap();
        assert!(one_off.3.is_none() && one_off.4.is_none());
    }

    #[test]
    fn the_backfill_gives_an_unsynced_connection_its_calendar_once() {
        let (svc, pool) = service();
        // Connected before calendars were made on connect: a row and no calendar.
        svc.repo.upsert(record("u1", "apple")).unwrap();
        svc.save(record("u2", "google")).unwrap();
        assert!(provider_calendars(&pool, "u1").is_empty());

        let backfill = include_str!(
            "../../../migrations/00144_calendar__2026-10-21-000000_backfill_connection_calendars/up.sql"
        );
        for _ in 0..2 {
            diesel::sql_query(backfill)
                .execute(&mut pool.get().unwrap())
                .unwrap();
        }
        let made = provider_calendars(&pool, "u1");
        assert_eq!(made.len(), 1);
        assert_eq!(made[0].source.as_deref(), Some("apple"));
        assert_eq!(made[0].color, "#f97316");
        assert_eq!(
            provider_calendars(&pool, "u2").len(),
            1,
            "one it already had is left alone"
        );
    }
}
