//! Google Calendar OAuth2 and API client.
use crate::shared::ApiError;
use crate::config::OAuthConfig;
use chrono::{NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use url::Url;

// ── OAuth2 ────────────────────────────────────────────────────────────────────

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const SCOPES: &str = "https://www.googleapis.com/auth/calendar";

pub fn build_auth_url(cfg: &OAuthConfig, state: &str) -> Result<String, ApiError> {
    let client_id = cfg
        .google_client_id
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("Google OAuth not configured (GOOGLE_CLIENT_ID missing)"))?;

    let mut url = Url::parse(AUTH_URL).unwrap();
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", &cfg.google_redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", state);

    tracing::info!("GOOGLE CAL API: {}", &url.to_string());
    
    Ok(url.to_string())
}

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
    pub token_type: String,
}

#[derive(Debug, Serialize)]
struct TokenRequest<'a> {
    client_id: &'a str,
    client_secret: &'a str,
    code: &'a str,
    grant_type: &'a str,
    redirect_uri: &'a str,
}

#[derive(Debug, Serialize)]
struct RefreshRequest<'a> {
    client_id: &'a str,
    client_secret: &'a str,
    refresh_token: &'a str,
    grant_type: &'a str,
}

pub async fn exchange_code(
    cfg: &OAuthConfig,
    http: &reqwest::Client,
    code: &str,
) -> Result<TokenResponse, ApiError> {
    let client_id = cfg
        .google_client_id
        .as_deref()
        .ok_or_else(|| ApiError::internal("Google OAuth not configured"))?;
    let client_secret = cfg
        .google_client_secret
        .as_deref()
        .ok_or_else(|| ApiError::internal("Google OAuth not configured"))?;

    let body = TokenRequest {
        client_id,
        client_secret,
        code,
        grant_type: "authorization_code",
        redirect_uri: &cfg.google_redirect_uri,
    };

    let resp = http
        .post(TOKEN_URL)
        .form(&body)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Google token exchange error: {:?}", e);
            ApiError::internal("Failed to exchange Google OAuth code")
        })?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("Google token exchange failed: {}", text);
        return Err(ApiError::bad_request("Google OAuth code exchange failed"));
    }

    resp.json::<TokenResponse>().await.map_err(|e| {
        tracing::error!("Google token parse error: {:?}", e);
        ApiError::internal("Failed to parse Google token response")
    })
}

pub async fn refresh_token(
    cfg: &OAuthConfig,
    http: &reqwest::Client,
    refresh: &str,
) -> Result<TokenResponse, ApiError> {
    let client_id = cfg
        .google_client_id
        .as_deref()
        .ok_or_else(|| ApiError::internal("Google OAuth not configured"))?;
    let client_secret = cfg
        .google_client_secret
        .as_deref()
        .ok_or_else(|| ApiError::internal("Google OAuth not configured"))?;

    let body = RefreshRequest {
        client_id,
        client_secret,
        refresh_token: refresh,
        grant_type: "refresh_token",
    };

    let resp = http
        .post(TOKEN_URL)
        .form(&body)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Google token refresh error: {:?}", e);
            ApiError::internal("Failed to refresh Google token")
        })?;

    resp.json::<TokenResponse>().await.map_err(|e| {
        tracing::error!("Google token refresh parse error: {:?}", e);
        ApiError::internal("Failed to parse Google token response")
    })
}

/// Returns (access_token, new_expiry) – refreshes if expired.
pub async fn ensure_valid_token(
    cfg: &OAuthConfig,
    http: &reqwest::Client,
    access_token: &str,
    refresh_tok: Option<&str>,
    expires_at: Option<NaiveDateTime>,
) -> Result<(String, Option<NaiveDateTime>, Option<String>), ApiError> {
    let expired = expires_at
        .map(|exp| exp < Utc::now().naive_utc())
        .unwrap_or(false);

    if !expired {
        return Ok((access_token.to_string(), expires_at, None));
    }

    let refresh = refresh_tok
        .ok_or_else(|| ApiError::internal("Google token expired and no refresh token available"))?;

    let tok = refresh_token(cfg, http, refresh).await?;
    let new_expiry = tok
        .expires_in
        .map(|secs| Utc::now().naive_utc() + chrono::Duration::seconds(secs));
    Ok((tok.access_token, new_expiry, tok.refresh_token))
}

// ── Events API ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleDateTime {
    pub date_time: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleEvent {
    pub id: String,
    pub status: Option<String>,
    pub summary: Option<String>,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start: GoogleDateTime,
    pub end: GoogleDateTime,
    pub recurrence: Option<Vec<String>>,
    pub organizer: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventListResponse {
    items: Option<Vec<GoogleEvent>>,
    next_page_token: Option<String>,
    next_sync_token: Option<String>,
}

/// Fetch all events from Google Calendar, using incremental sync when a cursor exists.
/// Returns (events, next_sync_token).
pub async fn fetch_events(
    http: &reqwest::Client,
    access_token: &str,
    sync_cursor: Option<&str>,
) -> Result<(Vec<GoogleEvent>, Option<String>), ApiError> {
    let mut all_events = Vec::new();
    let mut next_sync_token = None;
    let mut page_token: Option<String> = None;

    loop {
        let mut url =
            Url::parse("https://www.googleapis.com/calendar/v3/calendars/primary/events").unwrap();

        {
            let mut q = url.query_pairs_mut();
            q.append_pair("maxResults", "250");
            q.append_pair("singleEvents", "true");
            q.append_pair("orderBy", "startTime");

            if let Some(cursor) = sync_cursor {
                q.append_pair("syncToken", cursor);
            } else {
                // Full sync: look 1 year back and 2 years forward
                let min = (Utc::now() - chrono::Duration::days(365))
                    .format("%Y-%m-%dT%H:%M:%SZ")
                    .to_string();
                let max = (Utc::now() + chrono::Duration::days(730))
                    .format("%Y-%m-%dT%H:%M:%SZ")
                    .to_string();
                q.append_pair("timeMin", &min);
                q.append_pair("timeMax", &max);
            }

            if let Some(pt) = &page_token {
                q.append_pair("pageToken", pt);
            }
        }

        let resp = http
            .get(url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| {
                tracing::error!("Google events fetch error: {:?}", e);
                ApiError::internal("Failed to fetch Google Calendar events")
            })?;

        if resp.status() == reqwest::StatusCode::GONE {
            // Sync token expired – caller should do a full sync
            return Err(ApiError::bad_request("Google sync token expired"));
        }

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            tracing::error!("Google events fetch failed: {}", text);
            return Err(ApiError::internal("Failed to fetch Google Calendar events"));
        }

        let body: EventListResponse = resp.json().await.map_err(|e| {
            tracing::error!("Google events parse error: {:?}", e);
            ApiError::internal("Failed to parse Google Calendar events")
        })?;

        all_events.extend(body.items.unwrap_or_default());
        next_sync_token = body.next_sync_token;

        match body.next_page_token {
            Some(pt) => page_token = Some(pt),
            None => break,
        }
    }

    Ok((all_events, next_sync_token))
}

/// Fetch the authenticated user's profile email.
pub async fn fetch_user_email(
    http: &reqwest::Client,
    access_token: &str,
) -> Option<String> {
    #[derive(Deserialize)]
    struct Profile {
        email: Option<String>,
    }

    let resp = http
        .get("https://www.googleapis.com/oauth2/v1/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .ok()?;

    resp.json::<Profile>().await.ok()?.email
}

/// Convert a Google event datetime string to NaiveDateTime.
pub fn parse_google_dt(gdt: &GoogleDateTime) -> Option<(chrono::NaiveDateTime, bool)> {
    if let Some(dt_str) = &gdt.date_time {
        let dt = dt_str
            .parse::<chrono::DateTime<chrono::FixedOffset>>()
            .ok()
            .map(|d| d.naive_utc())
            .or_else(|| dt_str.parse::<chrono::NaiveDateTime>().ok())?;
        Some((dt, false))
    } else if let Some(d_str) = &gdt.date {
        let date = chrono::NaiveDate::parse_from_str(d_str, "%Y-%m-%d").ok()?;
        Some((date.and_hms_opt(0, 0, 0)?, true))
    } else {
        None
    }
}
