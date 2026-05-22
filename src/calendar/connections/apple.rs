//! Apple iCloud CalDAV client.
//!
//! Uses HTTP Basic auth against iCloud's CalDAV server.
//! Stores the base64-encoded "username:password" in the connection's access_token field.
use crate::shared::ApiError;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use chrono::{NaiveDateTime, Utc};

pub const DEFAULT_CALDAV_URL: &str = "https://caldav.icloud.com";

/// Encode credentials into the token stored in `access_token`.
pub fn encode_credentials(username: &str, password: &str) -> String {
    B64.encode(format!("{}:{}", username, password))
}

/// Decode stored credentials back to (username, password).
pub fn decode_credentials(token: &str) -> Option<(String, String)> {
    let decoded = String::from_utf8(B64.decode(token).ok()?).ok()?;
    let (user, pass) = decoded.split_once(':')?;
    Some((user.to_string(), pass.to_string()))
}

/// Verify the CalDAV credentials by issuing a PROPFIND on the principal URL.
pub async fn verify_connection(
    http: &reqwest::Client,
    caldav_url: &str,
    access_token: &str,
) -> Result<Option<String>, ApiError> {
    // Discover the calendar home by PROPFIND on the base URL
    let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>"#;

    let resp = http
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), caldav_url)
        .header("Content-Type", "application/xml; charset=utf-8")
        .header("Depth", "0")
        .header("Authorization", format!("Basic {}", access_token))
        .body(xml)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("CalDAV PROPFIND error: {:?}", e);
            ApiError::bad_request("Failed to connect to CalDAV server")
        })?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(ApiError::bad_request("CalDAV authentication failed – check username and password"));
    }

    if !resp.status().is_success() && resp.status().as_u16() != 207 {
        return Err(ApiError::bad_request("CalDAV server returned an error"));
    }

    // Try to extract email / display name from the response
    let body = resp.text().await.unwrap_or_default();
    let email = extract_tag_content(&body, "displayname")
        .filter(|s| !s.is_empty());

    Ok(email)
}

// ── Event fetching ────────────────────────────────────────────────────────────

pub struct CalDavEvent {
    pub uid: String,
    pub summary: Option<String>,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start: NaiveDateTime,
    pub end: NaiveDateTime,
    pub all_day: bool,
    pub rrule: Option<String>,
    pub cancelled: bool,
}

/// Fetch events from a CalDAV server using REPORT.
pub async fn fetch_events(
    http: &reqwest::Client,
    caldav_url: &str,
    access_token: &str,
) -> Result<Vec<CalDavEvent>, ApiError> {
    let home_url = discover_calendar_home(http, caldav_url, access_token).await?;
    let ical_data = report_events(http, &home_url, access_token).await?;
    let events = parse_ical_blocks(&ical_data);
    Ok(events)
}

/// PROPFIND to find the calendar-home-set URL.
async fn discover_calendar_home(
    http: &reqwest::Client,
    base_url: &str,
    access_token: &str,
) -> Result<String, ApiError> {
    let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set/>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>"#;

    let resp = http
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), base_url)
        .header("Content-Type", "application/xml; charset=utf-8")
        .header("Depth", "0")
        .header("Authorization", format!("Basic {}", access_token))
        .body(xml)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("CalDAV calendar home discovery error: {:?}", e);
            ApiError::internal("CalDAV discovery failed")
        })?;

    let body = resp.text().await.unwrap_or_default();

    // Try to extract calendar-home-set href
    if let Some(href) = extract_tag_content(&body, "href") {
        // Build absolute URL if relative
        if href.starts_with("http") {
            return Ok(href);
        }
        let base = url::Url::parse(base_url)
            .map_err(|_| ApiError::internal("Invalid CalDAV URL"))?;
        let resolved = base
            .join(&href)
            .map_err(|_| ApiError::internal("Invalid CalDAV href"))?;
        return Ok(resolved.to_string());
    }

    // Fallback: use the base URL directly
    Ok(base_url.to_string())
}

/// REPORT to fetch VCALENDAR data for all events.
async fn report_events(
    http: &reqwest::Client,
    calendar_url: &str,
    access_token: &str,
) -> Result<Vec<String>, ApiError> {
    let now = Utc::now();
    let start = (now - chrono::Duration::days(365))
        .format("%Y%m%dT%H%M%SZ")
        .to_string();
    let end = (now + chrono::Duration::days(730))
        .format("%Y%m%dT%H%M%SZ")
        .to_string();

    let xml = format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="{}" end="{}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>"#,
        start, end
    );

    let resp = http
        .request(reqwest::Method::from_bytes(b"REPORT").unwrap(), calendar_url)
        .header("Content-Type", "application/xml; charset=utf-8")
        .header("Depth", "1")
        .header("Authorization", format!("Basic {}", access_token))
        .body(xml)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("CalDAV REPORT error: {:?}", e);
            ApiError::internal("Failed to fetch CalDAV events")
        })?;

    if !resp.status().is_success() && resp.status().as_u16() != 207 {
        let text = resp.text().await.unwrap_or_default();
        tracing::error!("CalDAV REPORT failed: {}", text);
        return Err(ApiError::internal("CalDAV REPORT request failed"));
    }

    let body = resp.text().await.map_err(|_| ApiError::internal("Failed to read CalDAV response"))?;

    // Extract all calendar-data blocks (raw iCal text inside the XML)
    Ok(extract_calendar_data_blocks(&body))
}

// ── iCal parsing ──────────────────────────────────────────────────────────────

fn extract_calendar_data_blocks(xml: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut search = xml;
    while let Some(start) = search.find("BEGIN:VCALENDAR") {
        let rest = &search[start..];
        if let Some(end_offset) = rest.find("END:VCALENDAR") {
            let block = &rest[..end_offset + "END:VCALENDAR".len()];
            blocks.push(xml_decode(block));
            search = &rest[end_offset + "END:VCALENDAR".len()..];
        } else {
            break;
        }
    }
    blocks
}

/// Minimal XML entity decoding for iCal content embedded in XML.
fn xml_decode(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn parse_ical_blocks(blocks: &[String]) -> Vec<CalDavEvent> {
    use std::io::BufReader;

    let mut events = Vec::new();

    for block in blocks {
        let reader = BufReader::new(block.as_bytes());
        let mut parser = ical::IcalParser::new(reader);

        while let Some(Ok(calendar)) = parser.next() {
            for ev in calendar.events {
                if let Some(parsed) = parse_ical_event(ev) {
                    events.push(parsed);
                }
            }
        }
    }

    events
}

fn parse_ical_event(ev: ical::parser::ical::component::IcalEvent) -> Option<CalDavEvent> {
    let prop = |name: &str| -> Option<String> {
        ev.properties
            .iter()
            .find(|p| p.name == name)
            .and_then(|p| p.value.clone())
    };

    let uid = prop("UID")?;
    let summary = prop("SUMMARY");
    let description = prop("DESCRIPTION");
    let location = prop("LOCATION");
    let rrule = prop("RRULE");
    let status = prop("STATUS");
    let cancelled = status.as_deref() == Some("CANCELLED");

    let dtstart_str = prop("DTSTART")?;
    let dtend_str = prop("DTEND").unwrap_or_else(|| prop("DURATION").unwrap_or_default());

    let (start, all_day) = parse_ical_dt(&dtstart_str)?;
    let (end, _) = parse_ical_dt(&dtend_str).or_else(|| {
        // All-day events: end = start + 1 day if missing
        Some((start + chrono::Duration::days(1), all_day))
    })?;

    Some(CalDavEvent {
        uid,
        summary,
        description,
        location,
        start,
        end,
        all_day,
        rrule,
        cancelled,
    })
}

fn parse_ical_dt(s: &str) -> Option<(NaiveDateTime, bool)> {
    // Date-only: 20260101
    if s.len() == 8 && !s.contains('T') {
        let date = chrono::NaiveDate::parse_from_str(s, "%Y%m%d").ok()?;
        return Some((date.and_hms_opt(0, 0, 0)?, true));
    }
    // DateTime UTC: 20260101T100000Z
    if s.ends_with('Z') {
        let dt = chrono::NaiveDateTime::parse_from_str(s.trim_end_matches('Z'), "%Y%m%dT%H%M%S").ok()?;
        return Some((dt, false));
    }
    // DateTime local (no TZ suffix): 20260101T100000
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y%m%dT%H%M%S") {
        return Some((dt, false));
    }
    None
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn extract_tag_content(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)?;
    let after_open = xml[start..].find('>')? + start + 1;
    let end = xml[after_open..].find(&close)? + after_open;
    Some(xml[after_open..end].trim().to_string())
}
