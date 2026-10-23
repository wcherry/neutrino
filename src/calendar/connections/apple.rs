//! Apple iCloud CalDAV client.
//!
//! Uses HTTP Basic auth against iCloud's CalDAV server.
//! Stores the base64-encoded "username:password" in the connection's access_token field.
use crate::shared::ApiError;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use chrono::{NaiveDateTime, TimeZone, Utc};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use url::Url;

pub const DEFAULT_CALDAV_URL: &str = "https://caldav.icloud.com";

/// Encode credentials into the token stored in `access_token`.
pub fn encode_credentials(username: &str, password: &str) -> String {
    B64.encode(format!("{}:{}", username, password))
}

/// Decode stored credentials back to (username, password).
#[allow(dead_code)]
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
        .request(
            reqwest::Method::from_bytes(b"PROPFIND").unwrap(),
            caldav_url,
        )
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
        return Err(ApiError::bad_request(
            "CalDAV authentication failed – check username and password",
        ));
    }

    if !resp.status().is_success() {
        return Err(ApiError::bad_request(format!(
            "CalDAV server returned an error (HTTP {})",
            resp.status().as_u16()
        )));
    }

    // Try to extract email / display name from the response
    let body = resp.text().await.unwrap_or_default();
    let email = parse_xml(&body)
        .and_then(|doc| doc.descendant("displayname").map(|e| e.text.trim().to_string()))
        .filter(|s| !s.is_empty());

    Ok(email)
}

// ── Event fetching ────────────────────────────────────────────────────────────

pub struct CalDavEvent {
    pub uid: String,
    pub summary: Option<String>,
    pub description: Option<String>,
    pub location: Option<String>,
    /// UTC, or the wall-clock time of a floating event.
    pub start: NaiveDateTime,
    pub end: NaiveDateTime,
    pub all_day: bool,
    pub rrule: Option<String>,
    pub cancelled: bool,
    /// The IANA zone the event was written in, when it named one.
    pub timezone: Option<String>,
    /// Set on one edited occurrence of a series, which shares the series' UID: the start the
    /// occurrence had in the series.
    pub recurrence_id: Option<NaiveDateTime>,
    /// The starts of the series' deleted occurrences.
    pub exdates: Vec<NaiveDateTime>,
}

const PRINCIPAL_PROPFIND: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>"#;

const HOME_PROPFIND: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set/>
  </d:prop>
</d:propfind>"#;

const CALENDARS_PROPFIND: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <c:supported-calendar-component-set/>
  </d:prop>
</d:propfind>"#;

/// Every event in the account's event calendars, a year back and two ahead.
///
/// CalDAV is a walk, not one request: the server root names the user's principal, the principal
/// names the calendar home (on iCloud, a different host), and the home lists the calendars. Events
/// are asked of each calendar in turn — the home itself is not a calendar, and iCloud answers a
/// REPORT on it with 403. A server that leaves out a step is taken at its word that the URL in
/// hand is already the next one, so a URL pointing straight at a principal or home still works.
pub async fn fetch_events(
    http: &reqwest::Client,
    caldav_url: &str,
    access_token: &str,
) -> Result<Vec<CalDavEvent>, ApiError> {
    let base = Url::parse(caldav_url).map_err(|_| ApiError::bad_request("Invalid CalDAV URL"))?;

    let root = propfind(http, &base, "0", PRINCIPAL_PROPFIND, access_token).await?;
    let principal = linked_url(&root, "current-user-principal", &base).unwrap_or(base);

    let found = propfind(http, &principal, "0", HOME_PROPFIND, access_token).await?;
    let home = linked_url(&found, "calendar-home-set", &principal).unwrap_or(principal);

    let listing = propfind(http, &home, "1", CALENDARS_PROPFIND, access_token).await?;
    let calendars = event_calendars(&listing, &home);
    tracing::info!("CalDAV: {} event calendars under {}", calendars.len(), home.path());

    // One calendar failing (a subscription whose source is down) doesn't lose the others; all of
    // them failing is a failed sync.
    let mut events = Vec::new();
    let mut failure = None;
    let mut fetched = 0usize;
    for calendar in &calendars {
        match report_events(http, calendar, access_token).await {
            Ok(blocks) => {
                fetched += 1;
                events.extend(parse_ical_blocks(&blocks));
            }
            Err(e) => {
                tracing::warn!("CalDAV REPORT on {} failed: {}", calendar.path(), e.message);
                failure = Some(e);
            }
        }
    }
    match failure {
        Some(e) if fetched == 0 => Err(e),
        _ => Ok(events),
    }
}

async fn propfind(
    http: &reqwest::Client,
    url: &Url,
    depth: &str,
    body: &'static str,
    access_token: &str,
) -> Result<Element, ApiError> {
    let resp = http
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), url.clone())
        .header("Content-Type", "application/xml; charset=utf-8")
        .header("Depth", depth)
        .header("Authorization", format!("Basic {}", access_token))
        .body(body)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("CalDAV PROPFIND {} error: {:?}", url.path(), e);
            caldav_error("The calendar server could not be reached")
        })?;
    read_multistatus(resp, "PROPFIND", url).await
}

/// REPORT to fetch VCALENDAR data for the events in one calendar.
async fn report_events(
    http: &reqwest::Client,
    calendar_url: &Url,
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
        .request(
            reqwest::Method::from_bytes(b"REPORT").unwrap(),
            calendar_url.clone(),
        )
        .header("Content-Type", "application/xml; charset=utf-8")
        .header("Depth", "1")
        .header("Authorization", format!("Basic {}", access_token))
        .body(xml)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("CalDAV REPORT {} error: {:?}", calendar_url.path(), e);
            caldav_error("The calendar server could not be reached")
        })?;
    let doc = read_multistatus(resp, "REPORT", calendar_url).await?;
    Ok(calendar_data(&doc))
}

/// The parsed body of a successful WebDAV response; anything else is an error naming the status,
/// since an empty body is all iCloud sends with a refusal.
async fn read_multistatus(
    resp: reqwest::Response,
    method: &str,
    url: &Url,
) -> Result<Element, ApiError> {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        tracing::error!(
            "CalDAV {} {} failed: HTTP {} {}",
            method,
            url.path(),
            status.as_u16(),
            body.chars().take(500).collect::<String>()
        );
        return Err(match status.as_u16() {
            401 => caldav_error(
                "The calendar server no longer accepts the saved password; reconnect the account",
            ),
            code => caldav_error(format!("The calendar server refused the request (HTTP {code})")),
        });
    }
    parse_xml(&body).ok_or_else(|| {
        tracing::error!("CalDAV {} {}: unreadable XML", method, url.path());
        caldav_error("The calendar server sent a response that could not be read")
    })
}

fn caldav_error(message: impl Into<String>) -> ApiError {
    ApiError::new(502, "CALDAV_ERROR", message)
}

// ── WebDAV responses ──────────────────────────────────────────────────────────

/// The URL in `<prop><{property}><href>`, resolved against the URL that was asked.
fn linked_url(doc: &Element, property: &str, asked: &Url) -> Option<Url> {
    let href = doc.descendant(property)?.descendant("href")?.text.trim();
    if href.is_empty() {
        return None;
    }
    asked.join(href).ok()
}

/// The calendars in a Depth 1 listing of the calendar home that hold events. A calendar that
/// doesn't say which components it takes is assumed to take them all, as RFC 4791 says.
fn event_calendars(listing: &Element, home: &Url) -> Vec<Url> {
    listing
        .children_named("response")
        .filter(|r| {
            let is_calendar = r
                .descendant("resourcetype")
                .is_some_and(|t| t.child("calendar").is_some());
            let takes_events = r.descendant("supported-calendar-component-set").map_or(true, |set| {
                set.children_named("comp")
                    .any(|c| c.attr("name").is_some_and(|n| n.eq_ignore_ascii_case("VEVENT")))
            });
            is_calendar && takes_events
        })
        .filter_map(|r| home.join(r.child("href")?.text.trim()).ok())
        .collect()
}

/// The iCalendar text of each event in a REPORT response.
fn calendar_data(doc: &Element) -> Vec<String> {
    doc.children_named("response")
        .filter_map(|r| r.descendant("calendar-data"))
        .map(|d| d.text.clone())
        .filter(|t| !t.trim().is_empty())
        .collect()
}

/// An XML element, named without its namespace prefix: servers spell the DAV: and CalDAV
/// namespaces with whatever prefix they like (iCloud uses none), so names are matched bare.
#[derive(Debug, Default)]
struct Element {
    name: String,
    attrs: Vec<(String, String)>,
    text: String,
    children: Vec<Element>,
}

impl Element {
    fn child(&self, name: &str) -> Option<&Element> {
        self.children.iter().find(|c| c.name == name)
    }

    fn children_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Element> {
        self.children.iter().filter(move |c| c.name == name)
    }

    /// The first element called `name` at any depth below this one.
    fn descendant(&self, name: &str) -> Option<&Element> {
        self.children
            .iter()
            .find_map(|c| if c.name == name { Some(c) } else { c.descendant(name) })
    }

    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
}

/// The document element of `xml`, or `None` if it isn't well-formed.
fn parse_xml(xml: &str) -> Option<Element> {
    fn open(e: &BytesStart) -> Element {
        Element {
            name: String::from_utf8_lossy(e.local_name().as_ref()).into_owned(),
            attrs: e
                .attributes()
                .flatten()
                .map(|a| {
                    (
                        String::from_utf8_lossy(a.key.local_name().as_ref()).into_owned(),
                        a.unescape_value().map(|v| v.into_owned()).unwrap_or_default(),
                    )
                })
                .collect(),
            ..Default::default()
        }
    }

    let mut reader = Reader::from_str(xml);
    // The stack's floor is a stand-in parent for the document element.
    let mut stack = vec![Element::default()];
    loop {
        match reader.read_event().ok()? {
            Event::Start(e) => stack.push(open(&e)),
            Event::Empty(e) => {
                let element = open(&e);
                stack.last_mut()?.children.push(element);
            }
            Event::End(_) => {
                let element = stack.pop()?;
                stack.last_mut()?.children.push(element);
            }
            Event::Text(t) => stack.last_mut()?.text.push_str(&t.unescape().ok()?),
            Event::CData(c) => stack
                .last_mut()?
                .text
                .push_str(std::str::from_utf8(&c.into_inner()).ok()?),
            Event::Eof => break,
            _ => {}
        }
    }
    let mut floor = stack.pop()?;
    if !stack.is_empty() {
        return None;
    }
    floor.children.pop()
}

// ── iCal parsing ──────────────────────────────────────────────────────────────

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
    let find = |name: &str| ev.properties.iter().find(|p| p.name == name);
    let prop = |name: &str| -> Option<String> { find(name).and_then(|p| p.value.clone()) };
    let tzid_of = |p: &ical::property::Property| -> Option<String> {
        p.params
            .as_ref()?
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("TZID"))?
            .1
            .first()
            .cloned()
    };
    let tzid = |name: &str| find(name).and_then(tzid_of);

    let uid = prop("UID")?;
    let summary = prop("SUMMARY");
    let description = prop("DESCRIPTION");
    let location = prop("LOCATION");
    let rrule = prop("RRULE");
    let status = prop("STATUS");
    let cancelled = status.as_deref() == Some("CANCELLED");

    let start_tzid = tzid("DTSTART");
    let (start, all_day) = parse_ical_dt(&prop("DTSTART")?, start_tzid.as_deref())?;
    let end = prop("DTEND")
        .and_then(|v| parse_ical_dt(&v, tzid("DTEND").as_deref()))
        .map(|(end, _)| end)
        .or_else(|| prop("DURATION").and_then(|d| parse_duration(&d)).map(|d| start + d))
        // RFC 5545: with neither, a dated event lasts the day and a timed one is an instant.
        .unwrap_or(if all_day {
            start + chrono::Duration::days(1)
        } else {
            start
        });

    // Kept so a repeating event stays at its wall-clock time across a DST change.
    let timezone = start_tzid.filter(|z| z.parse::<chrono_tz::Tz>().is_ok());

    let recurrence_id = prop("RECURRENCE-ID")
        .and_then(|v| parse_ical_dt(&v, tzid("RECURRENCE-ID").as_deref()))
        .map(|(at, _)| at);
    // EXDATE may repeat, and each may list several times.
    let exdates = ev
        .properties
        .iter()
        .filter(|p| p.name == "EXDATE")
        .flat_map(|p| {
            let zone = tzid_of(p);
            p.value
                .as_deref()
                .unwrap_or_default()
                .split(',')
                .filter_map(move |v| parse_ical_dt(v.trim(), zone.as_deref()).map(|(at, _)| at))
                .collect::<Vec<_>>()
        })
        .collect();

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
        timezone,
        recurrence_id,
        exdates,
    })
}

/// A DTSTART/DTEND value as a UTC time, and whether it is a date only. A local time with a TZID
/// is converted out of that zone; one with no zone at all is floating and kept as written, as is
/// one in a zone that isn't an IANA name.
fn parse_ical_dt(s: &str, tzid: Option<&str>) -> Option<(NaiveDateTime, bool)> {
    // Date-only: 20260101
    if s.len() == 8 && !s.contains('T') {
        let date = chrono::NaiveDate::parse_from_str(s, "%Y%m%d").ok()?;
        return Some((date.and_hms_opt(0, 0, 0)?, true));
    }
    // DateTime UTC: 20260101T100000Z
    if s.ends_with('Z') {
        let dt =
            chrono::NaiveDateTime::parse_from_str(s.trim_end_matches('Z'), "%Y%m%dT%H%M%S").ok()?;
        return Some((dt, false));
    }
    // DateTime local: 20260101T100000, in its TZID if it has one
    let local = chrono::NaiveDateTime::parse_from_str(s, "%Y%m%dT%H%M%S").ok()?;
    let Some(tz) = tzid.and_then(|z| z.parse::<chrono_tz::Tz>().ok()) else {
        return Some((local, false));
    };
    // In the hour a clock goes back the earlier instant is meant; in the hour it skips, the time
    // doesn't exist and is read as the moment after the gap.
    let utc = match tz.from_local_datetime(&local) {
        chrono::LocalResult::Single(t) | chrono::LocalResult::Ambiguous(t, _) => t.naive_utc(),
        chrono::LocalResult::None => tz
            .from_local_datetime(&(local + chrono::Duration::hours(1)))
            .earliest()?
            .naive_utc(),
    };
    Some((utc, false))
}

/// An RFC 5545 DURATION: `P1D`, `PT1H30M`, `P2W`, `-PT15M`.
fn parse_duration(s: &str) -> Option<chrono::Duration> {
    let (sign, rest) = match s.strip_prefix('-') {
        Some(r) => (-1, r),
        None => (1, s.strip_prefix('+').unwrap_or(s)),
    };
    let rest = rest.strip_prefix('P')?;
    let mut total = chrono::Duration::zero();
    let mut number = String::new();
    let mut in_time = false;
    for c in rest.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' => number.push(c),
            unit => {
                let n: i64 = number.parse().ok()?;
                number.clear();
                total += match (unit, in_time) {
                    ('W', false) => chrono::Duration::weeks(n),
                    ('D', false) => chrono::Duration::days(n),
                    ('H', true) => chrono::Duration::hours(n),
                    ('M', true) => chrono::Duration::minutes(n),
                    ('S', true) => chrono::Duration::seconds(n),
                    _ => return None,
                };
            }
        }
    }
    if !number.is_empty() {
        return None;
    }
    Some(total * sign)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Shaped as iCloud answers, with the account number and partition host made up: unprefixed
    // DAV: elements, the response's own href first, and the home on another host.
    const ROOT: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:"><response><href>/</href><propstat><prop>
<current-user-principal xmlns="DAV:"><href xmlns="DAV:">/1234567/principal/</href></current-user-principal>
</prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>"#;

    const PRINCIPAL: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:"><response><href>/1234567/principal/</href><propstat><prop>
<calendar-home-set xmlns="urn:ietf:params:xml:ns:caldav"><href xmlns="DAV:">https://p99-caldav.icloud.com:443/1234567/calendars/</href></calendar-home-set>
</prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>"#;

    const HOME: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:">
<response><href>/1234567/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype><displayname>Someone</displayname></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/1234567/calendars/home/</href><propstat><prop><resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>Home</displayname><supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name='VEVENT' xmlns='urn:ietf:params:xml:ns:caldav'/></supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/1234567/calendars/tasks/</href><propstat><prop><resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>Reminders &#x26a0;&#xfe0f;</displayname><supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name='VTODO' xmlns='urn:ietf:params:xml:ns:caldav'/></supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/1234567/calendars/inbox/</href><propstat><prop><resourcetype><collection/><schedule-inbox xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/1234567/calendars/work/</href><propstat><prop><resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>Work</displayname></prop><status>HTTP/1.1 200 OK</status></propstat></response>
</multistatus>"#;

    const REPORT: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:"><response><href>/1234567/calendars/home/a.ics</href><propstat><prop><getetag>"x"</getetag>
<calendar-data xmlns="urn:ietf:params:xml:ns:caldav">BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:a
SUMMARY:Dinner &amp; drinks
DTSTART;TZID=America/Los_Angeles:20261021T180000
DTEND;TZID=America/Los_Angeles:20261021T200000
END:VEVENT
END:VCALENDAR
</calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>"#;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn the_walk_follows_the_principal_then_the_home_not_the_responses_own_href() {
        let base = url("https://caldav.icloud.com");
        let principal = linked_url(&parse_xml(ROOT).unwrap(), "current-user-principal", &base);
        assert_eq!(principal.as_ref().map(Url::as_str), Some("https://caldav.icloud.com/1234567/principal/"));

        let home = linked_url(&parse_xml(PRINCIPAL).unwrap(), "calendar-home-set", &principal.unwrap());
        assert_eq!(home.as_ref().map(Url::path), Some("/1234567/calendars/"));
        assert_eq!(home.unwrap().host_str(), Some("p99-caldav.icloud.com"));
    }

    #[test]
    fn only_calendars_that_hold_events_are_asked_for_them() {
        let home = url("https://p99-caldav.icloud.com/1234567/calendars/");
        let paths: Vec<String> = event_calendars(&parse_xml(HOME).unwrap(), &home)
            .iter()
            .map(|u| u.path().to_string())
            .collect();
        // Not the home, the inbox, or the tasks-only Reminders; Work says nothing and is assumed to.
        assert_eq!(paths, ["/1234567/calendars/home/", "/1234567/calendars/work/"]);
    }

    #[test]
    fn a_reports_events_are_read_unescaped_and_converted_out_of_their_zone() {
        let events = parse_ical_blocks(&calendar_data(&parse_xml(REPORT).unwrap()));
        assert_eq!(events.len(), 1);
        let ev = &events[0];
        assert_eq!(ev.summary.as_deref(), Some("Dinner & drinks"));
        // 18:00 in Los Angeles in October (PDT, UTC−7) is 01:00 UTC the next day.
        assert_eq!(ev.start.to_string(), "2026-10-22 01:00:00");
        assert_eq!(ev.end.to_string(), "2026-10-22 03:00:00");
        assert_eq!(ev.timezone.as_deref(), Some("America/Los_Angeles"));
        assert!(!ev.all_day);
    }

    #[test]
    fn times_without_a_known_zone_are_kept_as_written() {
        let (utc, _) = parse_ical_dt("20261021T180000Z", None).unwrap();
        assert_eq!(utc.to_string(), "2026-10-21 18:00:00");
        let (floating, _) = parse_ical_dt("20261021T180000", None).unwrap();
        assert_eq!(floating.to_string(), "2026-10-21 18:00:00");
        let (windows, _) = parse_ical_dt("20261021T180000", Some("Pacific Standard Time")).unwrap();
        assert_eq!(windows.to_string(), "2026-10-21 18:00:00");
        let (day, all_day) = parse_ical_dt("20261021", None).unwrap();
        assert_eq!((day.to_string().as_str(), all_day), ("2026-10-21 00:00:00", true));
    }

    #[test]
    fn a_time_in_the_skipped_hour_is_read_as_the_moment_after() {
        // Clocks in Los Angeles jump from 02:00 to 03:00 PDT (10:00 UTC) on 2026-03-08.
        let (utc, _) = parse_ical_dt("20260308T023000", Some("America/Los_Angeles")).unwrap();
        assert_eq!(utc.to_string(), "2026-03-08 10:30:00");
    }

    #[test]
    fn durations() {
        assert_eq!(parse_duration("PT1H30M"), Some(chrono::Duration::minutes(90)));
        assert_eq!(parse_duration("P1D"), Some(chrono::Duration::days(1)));
        assert_eq!(parse_duration("P2W"), Some(chrono::Duration::weeks(2)));
        assert_eq!(parse_duration("-PT15M"), Some(chrono::Duration::minutes(-15)));
        assert_eq!(parse_duration("P1DT2H"), Some(chrono::Duration::hours(26)));
        assert_eq!(parse_duration("PT"), Some(chrono::Duration::zero()));
        assert_eq!(parse_duration("1H"), None);
        assert_eq!(parse_duration("PT5"), None);
    }

    #[test]
    fn an_event_with_a_duration_ends_after_it() {
        let block = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:d\nDTSTART:20261021T180000Z\nDURATION:PT45M\nEND:VEVENT\nEND:VCALENDAR\n";
        let events = parse_ical_blocks(&[block.to_string()]);
        assert_eq!(events[0].end.to_string(), "2026-10-21 18:45:00");
    }

    #[test]
    fn an_edited_occurrence_and_deleted_ones_are_read_against_their_series() {
        let block = "BEGIN:VCALENDAR
BEGIN:VEVENT
UID:s
DTSTART;TZID=America/Los_Angeles:20261006T120000
DTEND;TZID=America/Los_Angeles:20261006T130000
RRULE:FREQ=WEEKLY
EXDATE;TZID=America/Los_Angeles:20261013T120000,20261020T120000
EXDATE;TZID=America/Los_Angeles:20261103T120000
END:VEVENT
BEGIN:VEVENT
UID:s
RECURRENCE-ID;TZID=America/Los_Angeles:20261027T120000
DTSTART;TZID=America/Los_Angeles:20261027T150000
DTEND;TZID=America/Los_Angeles:20261027T160000
SUMMARY:Moved
END:VEVENT
END:VCALENDAR
";
        let events = parse_ical_blocks(&[block.to_string()]);
        assert_eq!(events.len(), 2);
        let series = &events[0];
        assert!(series.recurrence_id.is_none());
        let exdates: Vec<String> = series.exdates.iter().map(|d| d.to_string()).collect();
        // Noon in Los Angeles is 19:00 UTC before the clocks go back on 1 November, 20:00 after.
        assert_eq!(exdates, ["2026-10-13 19:00:00", "2026-10-20 19:00:00", "2026-11-03 20:00:00"]);
        let moved = &events[1];
        assert_eq!(moved.recurrence_id.map(|d| d.to_string()).as_deref(), Some("2026-10-27 19:00:00"));
        assert_eq!(moved.start.to_string(), "2026-10-27 22:00:00");
    }

    #[test]
    fn malformed_xml_is_none() {
        assert!(parse_xml("<a><b></a>").is_none());
        assert!(parse_xml("<a>").is_none());
    }
}
