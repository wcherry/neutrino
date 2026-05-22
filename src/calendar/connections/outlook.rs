//! Microsoft Graph / Outlook Calendar OAuth2 and API client.
use crate::shared::ApiError;
use crate::config::OAuthConfig;
use chrono::{NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use url::Url;

// ── OAuth2 ────────────────────────────────────────────────────────────────────

const AUTH_URL: &str =
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL: &str =
    "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const SCOPES: &str =
    "offline_access Calendars.ReadWrite User.Read";

pub fn build_auth_url(cfg: &OAuthConfig, state: &str) -> Result<String, ApiError> {
    let client_id = cfg
        .outlook_client_id
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("Outlook OAuth not configured (OUTLOOK_CLIENT_ID missing)"))?;

    let mut url = Url::parse(AUTH_URL).unwrap();
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", &cfg.outlook_redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("response_mode", "query")
        .append_pair("state", state);

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
    scope: &'a str,
}

#[derive(Debug, Serialize)]
struct RefreshRequest<'a> {
    client_id: &'a str,
    client_secret: &'a str,
    refresh_token: &'a str,
    grant_type: &'a str,
    scope: &'a str,
}

pub async fn exchange_code(
    cfg: &OAuthConfig,
    http: &reqwest::Client,
    code: &str,
) -> Result<TokenResponse, ApiError> {
    let client_id = cfg
        .outlook_client_id
        .as_deref()
        .ok_or_else(|| ApiError::internal("Outlook OAuth not configured"))?;
    let client_secret = cfg
        .outlook_client_secret
        .as_deref()
        .ok_or_else(|| ApiError::internal("Outlook OAuth not configured"))?;

    let body = TokenRequest {
        client_id,
        client_secret,
        code,
        grant_type: "authorization_code",
        redirect_uri: &cfg.outlook_redirect_uri,
        scope: SCOPES,
    };

    let resp = http
        .post(TOKEN_URL)
        .form(&body)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Outlook token exchange error: {:?}", e);
            ApiError::internal("Failed to exchange Outlook OAuth code")
        })?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("Outlook token exchange failed: {}", text);
        return Err(ApiError::bad_request("Outlook OAuth code exchange failed"));
    }

    resp.json::<TokenResponse>().await.map_err(|e| {
        tracing::error!("Outlook token parse error: {:?}", e);
        ApiError::internal("Failed to parse Outlook token response")
    })
}

pub async fn refresh_token(
    cfg: &OAuthConfig,
    http: &reqwest::Client,
    refresh: &str,
) -> Result<TokenResponse, ApiError> {
    let client_id = cfg
        .outlook_client_id
        .as_deref()
        .ok_or_else(|| ApiError::internal("Outlook OAuth not configured"))?;
    let client_secret = cfg
        .outlook_client_secret
        .as_deref()
        .ok_or_else(|| ApiError::internal("Outlook OAuth not configured"))?;

    let body = RefreshRequest {
        client_id,
        client_secret,
        refresh_token: refresh,
        grant_type: "refresh_token",
        scope: SCOPES,
    };

    let resp = http
        .post(TOKEN_URL)
        .form(&body)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Outlook token refresh error: {:?}", e);
            ApiError::internal("Failed to refresh Outlook token")
        })?;

    resp.json::<TokenResponse>().await.map_err(|e| {
        tracing::error!("Outlook token refresh parse error: {:?}", e);
        ApiError::internal("Failed to parse Outlook token response")
    })
}

/// Returns (access_token, new_expiry, new_refresh_token).
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
        .ok_or_else(|| ApiError::internal("Outlook token expired and no refresh token available"))?;

    let tok = refresh_token(cfg, http, refresh).await?;
    let new_expiry = tok
        .expires_in
        .map(|secs| Utc::now().naive_utc() + chrono::Duration::seconds(secs));
    Ok((tok.access_token, new_expiry, tok.refresh_token))
}

// ── Events API ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlookDateTimeValue {
    pub date_time: String,
    pub time_zone: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlookLocation {
    pub display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlookEvent {
    pub id: String,
    pub subject: Option<String>,
    pub body_preview: Option<String>,
    pub location: Option<OutlookLocation>,
    pub start: OutlookDateTimeValue,
    pub end: OutlookDateTimeValue,
    pub is_all_day: Option<bool>,
    #[serde(rename = "@removed")]
    pub removed: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct DeltaResponse {
    value: Vec<OutlookEvent>,
    #[serde(rename = "@odata.nextLink")]
    next_link: Option<String>,
    #[serde(rename = "@odata.deltaLink")]
    delta_link: Option<String>,
}

/// Fetch events from Microsoft Graph using delta query for incremental sync.
/// Returns (events, next_delta_link).
pub async fn fetch_events(
    http: &reqwest::Client,
    access_token: &str,
    sync_cursor: Option<&str>,
) -> Result<(Vec<OutlookEvent>, Option<String>), ApiError> {
    let initial_url = if let Some(cursor) = sync_cursor {
        cursor.to_string()
    } else {
        let start = (Utc::now() - chrono::Duration::days(365))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string();
        let end = (Utc::now() + chrono::Duration::days(730))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string();
        format!(
            "https://graph.microsoft.com/v1.0/me/calendarView/delta?startDateTime={}&endDateTime={}",
            start, end
        )
    };

    let mut all_events = Vec::new();
    let mut delta_link = None;
    let mut current_url = initial_url;

    loop {
        let resp = http
            .get(&current_url)
            .bearer_auth(access_token)
            .header("Prefer", "odata.maxpagesize=250")
            .send()
            .await
            .map_err(|e| {
                tracing::error!("Outlook events fetch error: {:?}", e);
                ApiError::internal("Failed to fetch Outlook Calendar events")
            })?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            tracing::error!("Outlook events fetch failed: {}", text);
            return Err(ApiError::internal("Failed to fetch Outlook Calendar events"));
        }

        let body: DeltaResponse = resp.json().await.map_err(|e| {
            tracing::error!("Outlook events parse error: {:?}", e);
            ApiError::internal("Failed to parse Outlook Calendar events")
        })?;

        all_events.extend(body.value);
        delta_link = body.delta_link;

        match body.next_link {
            Some(link) => current_url = link,
            None => break,
        }
    }

    Ok((all_events, delta_link))
}

/// Fetch the authenticated user's email from Microsoft Graph.
pub async fn fetch_user_email(
    http: &reqwest::Client,
    access_token: &str,
) -> Option<String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Me {
        mail: Option<String>,
        user_principal_name: Option<String>,
    }

    let resp = http
        .get("https://graph.microsoft.com/v1.0/me")
        .bearer_auth(access_token)
        .send()
        .await
        .ok()?;

    let me: Me = resp.json().await.ok()?;
    me.mail.or(me.user_principal_name)
}

/// Parse an Outlook dateTime string (which may lack a timezone suffix) to NaiveDateTime.
pub fn parse_outlook_dt(odt: &OutlookDateTimeValue) -> Option<NaiveDateTime> {
    // Graph returns "2026-04-01T10:00:00.0000000" style without Z/offset
    odt.date_time
        .trim_end_matches('0')
        .trim_end_matches('.')
        .parse::<chrono::NaiveDateTime>()
        .ok()
        .or_else(|| {
            odt.date_time
                .parse::<chrono::DateTime<Utc>>()
                .ok()
                .map(|d| d.naive_utc())
        })
}

pub fn is_removed(ev: &OutlookEvent) -> bool {
    ev.removed.is_some()
}
