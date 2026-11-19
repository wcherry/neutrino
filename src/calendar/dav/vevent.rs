//! A series ↔ one iCalendar object.
//!
//! One CalDAV object is one **series**: the master row and its live exceptions. It is written
//! as the master `VEVENT` (with `RRULE`, and an `EXDATE` for each cancelled occurrence) plus a
//! `VEVENT` per edited occurrence carrying `RECURRENCE-ID`, which is exactly the shape of
//! Neutrino's model (`agent_docs/recurrence-exceptions.md`).
//!
//! What the model has no column for, a client's alarms, `SEQUENCE`, `X-APPLE-*` and
//! attendee parameters, is kept per `VEVENT` (`Extras`) and written back, so a phone's alert
//! doesn't vanish on the next sync and get put back, forever.

use std::collections::BTreeMap;

use chrono::{Datelike, Duration, NaiveDateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};

use super::ical::{self, Component, TimeForm};
use super::store::Series;
use crate::calendar::events::availability::Availability;
use crate::calendar::events::model::EventRecord;

/// The properties the model holds. Everything else is an extra.
const MODELED: &[&str] = &[
    "UID",
    "DTSTAMP",
    "CREATED",
    "LAST-MODIFIED",
    "DTSTART",
    "DTEND",
    "DURATION",
    "SUMMARY",
    "DESCRIPTION",
    "LOCATION",
    "RRULE",
    "EXDATE",
    "RECURRENCE-ID",
    // Availability; see `events/availability.rs`.
    "TRANSP",
    "X-MICROSOFT-CDO-BUSYSTATUS",
];

pub const PRODID: &str = "-//Neutrino//CalDAV//EN";

/// The unmodelled part of each `VEVENT` of a series, by `RECURRENCE-ID` (UTC, `""` for the
/// master), as iCalendar text. Stored as JSON in `dav_objects.extra`.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct Extras {
    pub by_occurrence: BTreeMap<String, String>,
}

impl Extras {
    pub fn from_json(json: Option<&str>) -> Extras {
        json.and_then(|j| serde_json::from_str(j).ok()).unwrap_or_default()
    }

    pub fn to_json(&self) -> Option<String> {
        if self.by_occurrence.is_empty() {
            None
        } else {
            serde_json::to_string(self).ok()
        }
    }

    fn for_key(&self, key: &str) -> Option<Component> {
        self.by_occurrence.get(key).and_then(|text| parse_fragment(text))
    }
}

fn occurrence_key(at: Option<NaiveDateTime>) -> String {
    at.map(ical::utc_stamp).unwrap_or_default()
}

/// The unmodelled lines and sub-components of a `VEVENT`/`VTODO` as text.
pub fn fragment(c: &Component, keep: impl Fn(&str) -> bool) -> Option<String> {
    let mut out = Component::new(&c.name);
    out.props = c.props.iter().filter(|p| keep(&p.name)).cloned().collect();
    out.children = c.children.clone();
    if out.props.is_empty() && out.children.is_empty() {
        return None;
    }
    Some(out.to_ics())
}

pub fn parse_fragment(text: &str) -> Option<Component> {
    ical::parse(&format!("BEGIN:VCALENDAR\r\n{text}END:VCALENDAR\r\n"))
        .ok()?
        .children
        .into_iter()
        .next()
}

// ── Writing ───────────────────────────────────────────────────────────────────

/// How a series' times are written: a date for all-day, its zone when it has one, else UTC.
fn form_of(e: &EventRecord) -> TimeForm {
    if e.all_day {
        return TimeForm::Date;
    }
    match e.timezone.as_deref().filter(|z| !z.is_empty()).and_then(ical::zone) {
        Some(tz) => TimeForm::Zoned(tz),
        None => TimeForm::Utc,
    }
}

pub fn render(series: &Series, uid: &str, extra_json: Option<&str>) -> String {
    let extras = Extras::from_json(extra_json);
    let master = &series.master;
    let form = form_of(master);
    let mut cal = Component::new("VCALENDAR");
    cal.push("VERSION", &[], "2.0");
    cal.push("PRODID", &[], PRODID);
    cal.push("CALSCALE", &[], "GREGORIAN");
    if let TimeForm::Zoned(tz) = form {
        let first = master.start_time.year();
        let last = if master.is_recurring() {
            first.max(Utc::now().year()) + 2
        } else {
            series
                .exceptions
                .iter()
                .map(|e| e.start_time.year())
                .chain(std::iter::once(master.end_time.year()))
                .max()
                .unwrap_or(first)
        };
        cal.children.push(ical::vtimezone(tz, first, last.min(first + 30)));
    }

    let mut ev = vevent(master, uid, form, series.attendees.get(&master.id), extras.for_key(""));
    if let Some(rule) = master.recurrence_rule.as_deref().filter(|r| !r.is_empty()) {
        ev.push("RRULE", &[], rule);
        for cancelled in series.exceptions.iter().filter(|e| e.cancelled) {
            if let Some(original) = cancelled.original_start_time {
                ical::push_time(&mut ev, "EXDATE", original, form);
            }
        }
    }
    cal.children.push(ev);

    if master.is_recurring() {
        for exception in series.exceptions.iter().filter(|e| !e.cancelled) {
            let Some(original) = exception.original_start_time else {
                continue;
            };
            let mut ex = vevent(
                exception,
                uid,
                form_of(exception),
                series.attendees.get(&exception.id),
                extras.for_key(&occurrence_key(Some(original))),
            );
            // RECURRENCE-ID is in the series' form: it names an occurrence of the master.
            ical::push_time(&mut ex, "RECURRENCE-ID", original, form);
            cal.children.push(ex);
        }
    }
    cal.to_ics()
}

fn vevent(
    e: &EventRecord,
    uid: &str,
    form: TimeForm,
    attendees: Option<&Vec<String>>,
    extra: Option<Component>,
) -> Component {
    let mut ev = Component::new("VEVENT");
    ev.push_text("UID", uid);
    ev.push("DTSTAMP", &[], &ical::utc_stamp(e.updated_at));
    ev.push("CREATED", &[], &ical::utc_stamp(e.created_at));
    ev.push("LAST-MODIFIED", &[], &ical::utc_stamp(e.updated_at));
    ev.push_text("SUMMARY", &e.title);
    if let Some(d) = e.description.as_deref().filter(|d| !d.is_empty()) {
        ev.push_text("DESCRIPTION", d);
    }
    if let Some(l) = e.location.as_deref().filter(|l| !l.is_empty()) {
        ev.push_text("LOCATION", l);
    }
    let (transp, busy_status) = Availability::from_stored(&e.availability).to_ical();
    ev.push("TRANSP", &[], transp);
    if let Some(status) = busy_status {
        ev.push("X-MICROSOFT-CDO-BUSYSTATUS", &[], status);
    }
    if e.all_day {
        // Stored as the first day's 00:00 to the last day's 23:59:59; iCalendar's DTEND is the
        // day after the last.
        ical::push_time(&mut ev, "DTSTART", e.start_time, TimeForm::Date);
        let end_day = e.end_time.date().max(e.start_time.date()) + Duration::days(1);
        ical::push_time(&mut ev, "DTEND", end_day.and_time(NaiveTime::MIN), TimeForm::Date);
    } else {
        ical::push_time(&mut ev, "DTSTART", e.start_time, form);
        ical::push_time(&mut ev, "DTEND", e.end_time.max(e.start_time), form);
    }

    // Attendees: the client's own lines (with CN and PARTSTAT) for the addresses still on the
    // event, then a plain line for each address added in Neutrino.
    let emails: Vec<String> = attendees.cloned().unwrap_or_default();
    let mut written: Vec<String> = Vec::new();
    if let Some(extra) = &extra {
        for p in extra.props_named("ATTENDEE") {
            if let Some(email) = mailto(&p.value) {
                if emails.iter().any(|a| a.eq_ignore_ascii_case(&email)) {
                    ev.props.push(p.clone());
                    written.push(email.to_lowercase());
                }
            }
        }
    }
    for email in &emails {
        if !written.contains(&email.to_lowercase()) {
            ev.push("ATTENDEE", &[], &format!("mailto:{email}"));
        }
    }
    if let Some(extra) = extra {
        // Modelled names are dropped too: extras kept before a property was modelled still
        // hold it, and it has just been written from the row.
        ev.props.extend(
            extra
                .props
                .into_iter()
                .filter(|p| p.name != "ATTENDEE" && !MODELED.contains(&p.name.as_str())),
        );
        ev.children.extend(extra.children);
    }
    ev
}

fn mailto(value: &str) -> Option<String> {
    let v = value.trim();
    let email = v
        .strip_prefix("mailto:")
        .or_else(|| v.strip_prefix("MAILTO:"))
        .unwrap_or(v);
    email.contains('@').then(|| email.to_string())
}

// ── Reading ───────────────────────────────────────────────────────────────────

/// One `VEVENT`'s modelled fields.
#[derive(Debug, Clone, PartialEq)]
pub struct EventFields {
    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start: NaiveDateTime,
    pub end: NaiveDateTime,
    pub all_day: bool,
    pub timezone: Option<String>,
    pub attendees: Vec<String>,
    pub availability: Availability,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedSeries {
    pub uid: String,
    pub master: EventFields,
    pub rrule: Option<String>,
    /// Occurrences deleted: EXDATEs, and exceptions sent as `STATUS:CANCELLED`.
    pub exdates: Vec<NaiveDateTime>,
    /// Edited occurrences, by original start.
    pub overrides: Vec<(NaiveDateTime, EventFields)>,
    pub extras: Extras,
}

#[derive(Debug, PartialEq)]
pub struct Invalid(pub String);

pub fn parse_series(text: &str) -> Result<ParsedSeries, Invalid> {
    let cal = ical::parse(text).map_err(|e| Invalid(e.0))?;
    let vevents: Vec<&Component> = cal.children_named("VEVENT").collect();
    if vevents.is_empty() {
        return Err(Invalid("No VEVENT".into()));
    }
    if cal.children_named("VTODO").next().is_some() {
        return Err(Invalid("A calendar object holds one kind of component".into()));
    }
    let uid = vevents[0]
        .text("UID")
        .filter(|u| !u.trim().is_empty())
        .ok_or_else(|| Invalid("VEVENT without a UID".into()))?;
    if vevents.iter().any(|v| v.text("UID").as_deref() != Some(uid.as_str())) {
        return Err(Invalid("Every VEVENT in an object must share its UID".into()));
    }
    let master = vevents
        .iter()
        .find(|v| v.prop("RECURRENCE-ID").is_none())
        .ok_or_else(|| Invalid("Only overrides were sent, without the event they change".into()))?;
    let master_fields = fields(master)?;
    let tz = master_fields.timezone.as_deref().and_then(ical::zone);
    let rrule = master
        .prop("RRULE")
        .map(|p| p.value.trim().to_string())
        .filter(|r| !r.is_empty())
        .map(|r| ical::normalize_rrule(&r, tz));

    let mut extras = Extras::default();
    if let Some(f) = fragment(master, |n| !MODELED.contains(&n)) {
        extras.by_occurrence.insert(String::new(), f);
    }

    let mut exdates: Vec<NaiveDateTime> = master
        .props_named("EXDATE")
        .flat_map(|p| {
            let tzid = p.param("TZID").map(str::to_string);
            let value_type = p.param("VALUE").map(str::to_string);
            p.value
                .split(',')
                .filter_map(|v| ical::read_time_value(v.trim(), tzid.as_deref(), value_type.as_deref()).map(|(t, _)| t))
                .collect::<Vec<_>>()
        })
        .collect();
    let mut overrides = Vec::new();
    for v in vevents.iter().filter(|v| v.prop("RECURRENCE-ID").is_some()) {
        let (original, _) = ical::read_time(v.prop("RECURRENCE-ID").unwrap())
            .ok_or_else(|| Invalid("Unreadable RECURRENCE-ID".into()))?;
        if v.text("STATUS").is_some_and(|s| s.eq_ignore_ascii_case("CANCELLED")) {
            exdates.push(original);
            continue;
        }
        if let Some(f) = fragment(v, |n| !MODELED.contains(&n)) {
            extras.by_occurrence.insert(occurrence_key(Some(original)), f);
        }
        overrides.push((original, fields(v)?));
    }
    exdates.sort();
    exdates.dedup();
    Ok(ParsedSeries {
        uid,
        master: master_fields,
        rrule,
        exdates,
        overrides,
        extras,
    })
}

fn fields(v: &Component) -> Result<EventFields, Invalid> {
    let start_prop = v.prop("DTSTART").ok_or_else(|| Invalid("VEVENT without DTSTART".into()))?;
    let (start, all_day) = ical::read_time(start_prop).ok_or_else(|| Invalid("Unreadable DTSTART".into()))?;
    let timezone = start_prop
        .param("TZID")
        .and_then(ical::zone)
        .map(|tz| tz.name().to_string());
    let end_exclusive = match v.prop("DTEND").and_then(ical::read_time) {
        Some((end, _)) => end,
        None => match v.prop("DURATION").and_then(|p| parse_duration(p.value.trim())) {
            Some(d) => start + d,
            // RFC 5545 §3.6.1: a dated event with neither lasts the day; a timed one is an instant.
            None if all_day => start + Duration::days(1),
            None => start,
        },
    };
    let (start, end) = if all_day {
        // The model's all-day event ends on its last day at 23:59:59.
        let last_day = (end_exclusive.date() - Duration::days(1)).max(start.date());
        (start, last_day.and_hms_opt(23, 59, 59).unwrap())
    } else {
        (start, end_exclusive.max(start))
    };
    let attendees = v
        .props_named("ATTENDEE")
        .filter_map(|p| mailto(&p.value))
        .collect();
    Ok(EventFields {
        title: v.text("SUMMARY").unwrap_or_default(),
        description: v.text("DESCRIPTION").filter(|d| !d.is_empty()),
        location: v.text("LOCATION").filter(|l| !l.is_empty()),
        start,
        end,
        all_day,
        timezone: if all_day { None } else { timezone },
        attendees,
        availability: Availability::from_ical(
            v.text("TRANSP").as_deref(),
            v.text("X-MICROSOFT-CDO-BUSYSTATUS").as_deref(),
        ),
    })
}

/// An RFC 5545 DURATION: `P1D`, `PT1H30M`, `P2W`, `-PT15M`.
pub fn parse_duration(s: &str) -> Option<Duration> {
    let (sign, rest) = match s.strip_prefix('-') {
        Some(r) => (-1, r),
        None => (1, s.strip_prefix('+').unwrap_or(s)),
    };
    let rest = rest.strip_prefix('P')?;
    let mut total = Duration::zero();
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
                    ('W', false) => Duration::weeks(n),
                    ('D', false) => Duration::days(n),
                    ('H', true) => Duration::hours(n),
                    ('M', true) => Duration::minutes(n),
                    ('S', true) => Duration::seconds(n),
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

pub fn iso(t: NaiveDateTime) -> String {
    t.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use std::collections::HashMap;

    fn t(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap()
    }

    fn record(id: &str, start: &str, end: &str) -> EventRecord {
        EventRecord {
            id: id.into(),
            user_id: "u1".into(),
            title: "Standup".into(),
            description: None,
            start_time: t(start),
            end_time: t(end),
            all_day: false,
            location: None,
            recurrence_rule: None,
            external_id: None,
            source: "local".into(),
            created_at: t("2026-01-01 00:00:00"),
            updated_at: t("2026-01-02 00:00:00"),
            timezone: None,
            deleted_at: None,
            recurring_event_id: None,
            original_start_time: None,
            cancelled: false,
            calendar_id: Some("cal".into()),
            availability: "busy".into(),
        }
    }

    #[test]
    fn a_timed_one_off_round_trips_in_utc() {
        let mut e = record("e1", "2026-11-23 19:00:00", "2026-11-23 20:00:00");
        e.title = "Visit, Sutter Health".into();
        e.location = Some("Modesto; CA".into());
        let s = Series { master: e, exceptions: vec![], attendees: HashMap::new() };
        let ics = render(&s, "e1", None);
        assert!(ics.contains("DTSTART:20261123T190000Z\r\n"));
        assert!(ics.contains("SUMMARY:Visit\\, Sutter Health\r\n"));
        let back = parse_series(&ics).unwrap();
        assert_eq!(back.uid, "e1");
        assert_eq!(back.master.title, "Visit, Sutter Health");
        assert_eq!(back.master.location.as_deref(), Some("Modesto; CA"));
        assert_eq!(back.master.start, t("2026-11-23 19:00:00"));
        assert_eq!(back.master.end, t("2026-11-23 20:00:00"));
        assert!(back.extras.by_occurrence.is_empty());
    }

    #[test]
    fn all_day_end_is_exclusive_in_ical_and_inclusive_in_the_model() {
        let mut e = record("e1", "2026-11-23 00:00:00", "2026-11-24 23:59:59");
        e.all_day = true;
        let s = Series { master: e, exceptions: vec![], attendees: HashMap::new() };
        let ics = render(&s, "e1", None);
        assert!(ics.contains("DTSTART;VALUE=DATE:20261123\r\n"));
        assert!(ics.contains("DTEND;VALUE=DATE:20261125\r\n"));
        let back = parse_series(&ics).unwrap();
        assert!(back.master.all_day);
        assert_eq!(back.master.start, t("2026-11-23 00:00:00"));
        assert_eq!(back.master.end, t("2026-11-24 23:59:59"));
        // A one-day event, as Apple writes it.
        let one = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART;VALUE=DATE:20261123\r\nDTEND;VALUE=DATE:20261124\r\nSUMMARY:Day\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let one = parse_series(one).unwrap();
        assert_eq!(one.master.end, t("2026-11-23 23:59:59"));
    }

    #[test]
    fn a_series_with_an_edited_and_a_cancelled_occurrence() {
        let mut m = record("m", "2026-11-02 17:00:00", "2026-11-02 17:15:00");
        m.recurrence_rule = Some("FREQ=WEEKLY;BYDAY=MO".into());
        m.timezone = Some("America/Los_Angeles".into());
        let mut moved = record("x1", "2026-11-09 18:00:00", "2026-11-09 18:15:00");
        moved.recurring_event_id = Some("m".into());
        moved.original_start_time = Some(t("2026-11-09 17:00:00"));
        moved.title = "Standup (late)".into();
        let mut gone = record("x2", "2026-11-16 17:00:00", "2026-11-16 17:15:00");
        gone.recurring_event_id = Some("m".into());
        gone.original_start_time = Some(t("2026-11-16 17:00:00"));
        gone.cancelled = true;
        let s = Series { master: m, exceptions: vec![moved, gone], attendees: HashMap::new() };
        let ics = render(&s, "series-uid", None);
        assert!(ics.contains("BEGIN:VTIMEZONE\r\n"));
        assert!(ics.contains("DTSTART;TZID=America/Los_Angeles:20261102T090000\r\n"));
        assert!(ics.contains("EXDATE;TZID=America/Los_Angeles:20261116T090000\r\n"));
        assert!(ics.contains("RECURRENCE-ID;TZID=America/Los_Angeles:20261109T090000\r\n"));
        let back = parse_series(&ics).unwrap();
        assert_eq!(back.rrule.as_deref(), Some("FREQ=WEEKLY;BYDAY=MO"));
        assert_eq!(back.master.timezone.as_deref(), Some("America/Los_Angeles"));
        assert_eq!(back.exdates, vec![t("2026-11-16 17:00:00")]);
        assert_eq!(back.overrides.len(), 1);
        assert_eq!(back.overrides[0].0, t("2026-11-09 17:00:00"));
        assert_eq!(back.overrides[0].1.title, "Standup (late)");
    }

    #[test]
    fn a_cancelled_override_reads_as_an_exdate() {
        let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:s\r\nDTSTART:20261102T170000Z\r\nDTEND:20261102T171500Z\r\nRRULE:FREQ=DAILY\r\nSUMMARY:S\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:s\r\nRECURRENCE-ID:20261103T170000Z\r\nDTSTART:20261103T170000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:S\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let back = parse_series(ics).unwrap();
        assert_eq!(back.exdates, vec![t("2026-11-03 17:00:00")]);
        assert!(back.overrides.is_empty());
    }

    #[test]
    fn alarms_and_unknown_properties_survive_a_round_trip() {
        let sent = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261123T190000Z\r\nDTEND:20261123T200000Z\r\nSUMMARY:Visit\r\nSEQUENCE:2\r\nX-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC\r\nATTENDEE;CN=Jane;PARTSTAT=ACCEPTED:mailto:jane@example.com\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let parsed = parse_series(sent).unwrap();
        assert_eq!(parsed.master.attendees, vec!["jane@example.com"]);
        let mut e = record("e1", "2026-11-23 19:00:00", "2026-11-23 20:00:00");
        e.title = "Visit".into();
        let mut attendees = HashMap::new();
        attendees.insert("e1".to_string(), vec!["jane@example.com".to_string(), "bob@example.com".to_string()]);
        let s = Series { master: e, exceptions: vec![], attendees };
        let ics = render(&s, "a", parsed.extras.to_json().as_deref());
        assert!(ics.contains("SEQUENCE:2\r\n"));
        assert!(ics.contains("X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC\r\n"));
        assert!(ics.contains("TRIGGER:-PT15M\r\n"));
        assert!(ics.contains("ATTENDEE;CN=Jane;PARTSTAT=ACCEPTED:mailto:jane@example.com\r\n"));
        assert!(ics.contains("ATTENDEE:mailto:bob@example.com\r\n"));
        // Written once each.
        assert_eq!(ics.matches("jane@example.com").count(), 1);
    }

    #[test]
    fn availability_is_written_as_transp_and_busy_status_and_read_back() {
        let mut e = record("e1", "2026-11-23 19:00:00", "2026-11-23 20:00:00");
        e.availability = "tentative".into();
        let s = Series { master: e, exceptions: vec![], attendees: HashMap::new() };
        let ics = render(&s, "e1", None);
        assert!(ics.contains("TRANSP:OPAQUE\r\n"));
        assert!(ics.contains("X-MICROSOFT-CDO-BUSYSTATUS:TENTATIVE\r\n"));
        let back = parse_series(&ics).unwrap();
        assert_eq!(back.master.availability, Availability::Tentative);
        assert!(back.extras.by_occurrence.is_empty(), "both are modelled, not extras");
    }

    #[test]
    fn a_transp_kept_as_an_extra_before_it_was_modelled_is_not_written_twice() {
        // What a PUT from Apple Calendar stored before TRANSP was modelled.
        let mut stored = Component::new("VEVENT");
        stored.push("TRANSP", &[], "TRANSPARENT");
        stored.push("SEQUENCE", &[], "3");
        let mut extras = Extras::default();
        extras.by_occurrence.insert(String::new(), fragment(&stored, |_| true).unwrap());
        let old_extras = extras.to_json().unwrap();
        let mut e = record("e1", "2026-11-23 19:00:00", "2026-11-23 20:00:00");
        e.availability = "busy".into();
        let s = Series { master: e, exceptions: vec![], attendees: HashMap::new() };
        let ics = render(&s, "e1", Some(&old_extras));
        assert!(ics.contains("SEQUENCE:3\r\n"), "the other extras are still written: {ics}");
        assert_eq!(ics.matches("TRANSP:").count(), 1, "{ics}");
        assert!(ics.contains("TRANSP:OPAQUE\r\n"), "the row wins");
    }

    #[test]
    fn duration_instead_of_dtend() {
        let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:d\r\nDTSTART:20261123T190000Z\r\nDURATION:PT1H30M\r\nSUMMARY:D\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        assert_eq!(parse_series(ics).unwrap().master.end, t("2026-11-23 20:30:00"));
    }

    #[test]
    fn objects_without_a_master_or_with_mixed_uids_are_refused() {
        let only_override = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:s\r\nRECURRENCE-ID:20261103T170000Z\r\nDTSTART:20261103T170000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        assert!(parse_series(only_override).is_err());
        let mixed = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261103T170000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:b\r\nDTSTART:20261103T170000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        assert!(parse_series(mixed).is_err());
        let date = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        let _ = date;
    }
}
