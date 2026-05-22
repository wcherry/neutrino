use crate::shared::{ApiError, AuthenticatedUser};
use crate::config::OAuthConfig;
use crate::calendar::connections::{apple, google, outlook};
use crate::calendar::connections::dto::{
    ConnectAppleRequest, ConnectionResponse, ListConnectionsResponse, OAuthInitResponse,
    TriggerSyncRequest,
};
use crate::calendar::connections::model::{ConnectionRecord, NewConnectionRecord};
use crate::calendar::connections::repository::ConnectionsRepository;
use crate::calendar::events::repository::EventsRepository;
use crate::calendar::events::model::NewEventRecord;
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

    pub fn initiate_google(&self, user_id: &str) -> Result<OAuthInitResponse, ApiError> {
        let state = format!("{}:{}", user_id, Uuid::new_v4());
        let auth_url = google::build_auth_url(&self.oauth, &state)?;
        Ok(OAuthInitResponse { auth_url })
    }

    pub async fn connect_google(
        &self,
        user: &AuthenticatedUser,
        code: &str,
    ) -> Result<ConnectionResponse, ApiError> {
        let tokens = google::exchange_code(&self.oauth, &self.http, code).await?;

        let email = google::fetch_user_email(&self.http, &tokens.access_token).await;
        let expires_at = tokens.expires_in.map(|secs| {
            Utc::now().naive_utc() + chrono::Duration::seconds(secs)
        });

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

        let saved = self.repo.upsert(record)?;
        Ok(conn_to_response(saved))
    }

    // ── Outlook OAuth ─────────────────────────────────────────────────────────

    pub fn initiate_outlook(&self) -> Result<OAuthInitResponse, ApiError> {
        let state = Uuid::new_v4().to_string();
        let auth_url = outlook::build_auth_url(&self.oauth, &state)?;
        Ok(OAuthInitResponse { auth_url })
    }

    pub async fn connect_outlook(
        &self,
        user: &AuthenticatedUser,
        code: &str,
    ) -> Result<ConnectionResponse, ApiError> {
        let tokens = outlook::exchange_code(&self.oauth, &self.http, code).await?;

        let email = outlook::fetch_user_email(&self.http, &tokens.access_token).await;
        let expires_at = tokens.expires_in.map(|secs| {
            Utc::now().naive_utc() + chrono::Duration::seconds(secs)
        });

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

        let saved = self.repo.upsert(record)?;
        Ok(conn_to_response(saved))
    }

    // ── Apple CalDAV ──────────────────────────────────────────────────────────

    pub async fn connect_apple(
        &self,
        user: &AuthenticatedUser,
        req: ConnectAppleRequest,
    ) -> Result<ConnectionResponse, ApiError> {
        let token = apple::encode_credentials(&req.username, &req.password);

        // Verify connectivity before saving
        let display_name =
            apple::verify_connection(&self.http, &req.caldav_url, &token).await?;
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

        let saved = self.repo.upsert(record)?;
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

        let mut total = 0usize;
        for conn in connections {
            match self.sync_connection(conn).await {
                Ok(n) => total += n,
                Err(e) => tracing::error!("Sync error: {:?}", e),
            }
        }

        Ok(total)
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

        let (events, next_cursor) =
            match google::fetch_events(&self.http, &access_token, conn.sync_cursor.as_deref()).await {
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
                rules.into_iter().find(|r| r.starts_with("RRULE:"))
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

        let events =
            apple::fetch_events(&self.http, caldav_url, &conn.access_token).await?;

        tracing::info!(
            "Apple CalDAV sync: {} events for user {}",
            events.len(),
            conn.user_id
        );

        let now = Utc::now().naive_utc();
        let mut count = 0usize;
        for ev in events {
            if ev.cancelled {
                self.events_repo
                    .delete_by_external(&conn.user_id, "apple", &ev.uid)
                    .ok();
                continue;
            }

            let record = NewEventRecord {
                id: Uuid::new_v4().to_string(),
                user_id: conn.user_id.clone(),
                title: ev.summary.unwrap_or_else(|| "(No title)".to_string()),
                description: ev.description,
                start_time: ev.start,
                end_time: ev.end,
                all_day: ev.all_day,
                location: ev.location,
                recurrence_rule: ev.rrule,
                external_id: Some(ev.uid),
                source: "apple".to_string(),
                created_at: now,
                updated_at: now,
                timezone: None,
            };

            self.events_repo
                .upsert_from_sync(&conn.user_id, "apple", record)?;
            count += 1;
        }

        Ok(count)
    }
}

// ── Helper ────────────────────────────────────────────────────────────────────

fn conn_to_response(r: ConnectionRecord) -> ConnectionResponse {
    ConnectionResponse {
        id: r.id,
        provider: r.provider,
        email: r.email,
        caldav_url: r.caldav_url,
        expires_at: r.expires_at.map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        sync_cursor: r.sync_cursor,
        created_at: r.created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    }
}
