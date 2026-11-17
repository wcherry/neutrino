//! A task ↔ a `VTODO`, for Apple Reminders and every other CalDAV task client.
//!
//! | VTODO | Neutrino |
//! |---|---|
//! | `SUMMARY`, `DESCRIPTION`, `LOCATION` | `title`, `notes`, `location` |
//! | `DUE`, `DTSTART` (a date, or a time) | `due_date` + `due_has_time`, `start_date` + `start_has_time` |
//! | `STATUS:COMPLETED` / `COMPLETED` | `done` |
//! | `PRIORITY` 1–9 (Apple: 1, 5, 9) | `priority` 1–3 |
//! | `RRULE` | `recurrence_rule` |
//! | `CATEGORIES` | tags |
//! | an arrival `VALARM` with `X-APPLE-STRUCTURED-LOCATION` | the geofence point and radius |
//!
//! Everything else, timed alarms, `X-APPLE-SORT-ORDER`, subtask links (`RELATED-TO`), a
//! departure alarm, is kept as an extra and written back.

use chrono::NaiveDateTime;

use super::ical::{self, Component, TimeForm};
use super::store::TaskObject;
use super::vevent::{fragment, parse_fragment, Invalid, PRODID};

const MODELED: &[&str] = &[
    "UID",
    "DTSTAMP",
    "CREATED",
    "LAST-MODIFIED",
    "SUMMARY",
    "DESCRIPTION",
    "LOCATION",
    "DUE",
    "DTSTART",
    "STATUS",
    "PERCENT-COMPLETE",
    "PRIORITY",
    "RRULE",
    "CATEGORIES",
];

/// What Neutrino's geofence radius allows.
const MIN_RADIUS: i32 = 100;
const MAX_RADIUS: i32 = 2000;

/// Neutrino's priority (1 high … 3 low) as iCalendar's, in the values Apple writes.
pub fn priority_out(p: Option<i32>) -> Option<u8> {
    match p {
        Some(1) => Some(1),
        Some(2) => Some(5),
        Some(3) => Some(9),
        _ => None,
    }
}

/// iCalendar's priority (0 none, 1 highest … 9 lowest) as Neutrino's.
pub fn priority_in(p: Option<u8>) -> Option<i32> {
    match p {
        Some(1..=4) => Some(1),
        Some(5) => Some(2),
        Some(6..=9) => Some(3),
        _ => None,
    }
}

fn is_arrival_alarm(alarm: &Component) -> bool {
    alarm.name == "VALARM"
        && alarm
            .text("X-APPLE-PROXIMITY")
            .is_some_and(|p| p.eq_ignore_ascii_case("ARRIVE"))
}

pub fn render(object: &TaskObject, uid: &str, extra: Option<&str>) -> String {
    let t = &object.task;
    let extra = extra.and_then(parse_fragment);
    let mut todo = Component::new("VTODO");
    todo.push_text("UID", uid);
    todo.push("DTSTAMP", &[], &ical::utc_stamp(t.updated_at));
    todo.push("CREATED", &[], &ical::utc_stamp(t.created_at));
    todo.push("LAST-MODIFIED", &[], &ical::utc_stamp(t.updated_at));
    todo.push_text("SUMMARY", &t.title);
    if let Some(n) = t.notes.as_deref().filter(|n| !n.is_empty()) {
        todo.push_text("DESCRIPTION", n);
    }
    if let Some(l) = t.location.as_deref().filter(|l| !l.is_empty()) {
        todo.push_text("LOCATION", l);
    }
    let form = |has_time: bool| if has_time { TimeForm::Utc } else { TimeForm::Date };
    if let Some(start) = t.start_date {
        ical::push_time(&mut todo, "DTSTART", start, form(t.start_has_time));
    }
    if let Some(due) = t.due_date {
        ical::push_time(&mut todo, "DUE", due, form(t.due_has_time));
    }
    if t.done {
        todo.push("STATUS", &[], "COMPLETED");
        todo.push("PERCENT-COMPLETE", &[], "100");
        // When it was completed, as the client said; else the last change is the best known.
        let completed = extra
            .as_ref()
            .and_then(|e| e.prop("COMPLETED").cloned())
            .map(|p| p.value)
            .unwrap_or_else(|| ical::utc_stamp(t.updated_at));
        todo.push("COMPLETED", &[], &completed);
    } else {
        todo.push("STATUS", &[], "NEEDS-ACTION");
    }
    if let Some(p) = priority_out(t.priority) {
        todo.push("PRIORITY", &[], &p.to_string());
    }
    if let Some(rule) = t.recurrence_rule.as_deref().filter(|r| !r.is_empty()) {
        todo.push("RRULE", &[], rule);
    }
    if !object.tags.is_empty() {
        let value: Vec<String> = object.tags.iter().map(|t| ical::escape(t)).collect();
        todo.push("CATEGORIES", &[], &value.join(","));
    }

    let stored_arrival = extra
        .as_ref()
        .and_then(|e| e.children.iter().find(|c| is_arrival_alarm(c)).cloned());
    if let Some(extra) = &extra {
        todo.props
            .extend(extra.props.iter().filter(|p| p.name != "COMPLETED").cloned());
        todo.children
            .extend(extra.children.iter().filter(|c| !is_arrival_alarm(c)).cloned());
    }
    match (t.geo_lat, t.geo_lng, t.geo_radius_m) {
        // A point: written from the model, with the title the client gave the place if the
        // point is still the one it sent.
        (Some(lat), Some(lng), radius) => {
            let title = stored_arrival
                .as_ref()
                .filter(|a| arrival_point(a).is_some_and(|(la, ln, _)| close(la, lat) && close(ln, lng)))
                .and_then(|a| a.prop("X-APPLE-STRUCTURED-LOCATION"))
                .and_then(|p| p.param("X-TITLE").map(str::to_string))
                .unwrap_or_else(|| "Location".to_string());
            todo.children.push(arrival_alarm(lat, lng, radius.unwrap_or(MIN_RADIUS), &title));
        }
        // A saved place: its coordinates are encrypted, so only an alarm the client sent can
        // stand for it.
        _ if t.geo_place_id.is_some() => todo.children.extend(stored_arrival),
        _ => {}
    }

    let mut cal = Component::new("VCALENDAR");
    cal.push("VERSION", &[], "2.0");
    cal.push("PRODID", &[], PRODID);
    cal.children.push(todo);
    cal.to_ics()
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-6
}

fn arrival_alarm(lat: f64, lng: f64, radius: i32, title: &str) -> Component {
    let mut a = Component::new("VALARM");
    a.push("ACTION", &[], "DISPLAY");
    a.push_text("DESCRIPTION", "Reminder");
    // The fixed trigger Apple writes on a location alarm.
    a.push("TRIGGER", &[("VALUE", "DATE-TIME")], "19760401T005545Z");
    a.push("X-APPLE-PROXIMITY", &[], "ARRIVE");
    let radius = radius.to_string();
    a.push(
        "X-APPLE-STRUCTURED-LOCATION",
        &[("VALUE", "URI"), ("X-APPLE-RADIUS", &radius), ("X-TITLE", title)],
        &format!("geo:{lat},{lng}"),
    );
    a
}

/// `(lat, lng, radius)` of an arrival alarm.
fn arrival_point(alarm: &Component) -> Option<(f64, f64, Option<i32>)> {
    let loc = alarm.prop("X-APPLE-STRUCTURED-LOCATION")?;
    let geo = loc.value.trim().strip_prefix("geo:")?;
    let (lat, lng) = geo.split_once(',')?;
    let lat: f64 = lat.trim().parse().ok()?;
    let lng: f64 = lng.split(';').next()?.trim().parse().ok()?;
    if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lng) {
        return None;
    }
    let radius = loc
        .param("X-APPLE-RADIUS")
        .and_then(|r| r.parse::<f64>().ok())
        .map(|r| (r.round() as i32).clamp(MIN_RADIUS, MAX_RADIUS));
    Some((lat, lng, radius))
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaskFields {
    pub uid: String,
    pub title: String,
    pub notes: Option<String>,
    pub location: Option<String>,
    pub due: Option<(NaiveDateTime, bool)>,
    pub start: Option<(NaiveDateTime, bool)>,
    pub done: bool,
    pub priority: Option<i32>,
    pub rrule: Option<String>,
    pub tags: Vec<String>,
    /// An arrival alarm's point and radius.
    pub geofence: Option<(f64, f64, i32)>,
    /// The zone the due time was written in, for stepping a repeating task.
    pub timezone: Option<String>,
    pub extra: Option<String>,
}

pub fn parse_task(text: &str) -> Result<TaskFields, Invalid> {
    let cal = ical::parse(text).map_err(|e| Invalid(e.0))?;
    let mut todos = cal.children_named("VTODO");
    let todo = todos.next().ok_or_else(|| Invalid("No VTODO".into()))?;
    if todos.next().is_some() || cal.children_named("VEVENT").next().is_some() {
        return Err(Invalid("A reminder object holds one VTODO".into()));
    }
    let uid = todo
        .text("UID")
        .filter(|u| !u.trim().is_empty())
        .ok_or_else(|| Invalid("VTODO without a UID".into()))?;
    let read = |name: &str| -> Result<Option<(NaiveDateTime, bool)>, Invalid> {
        match todo.prop(name) {
            None => Ok(None),
            Some(p) => ical::read_time(p)
                .map(|(t, is_date)| Some((t, !is_date)))
                .ok_or_else(|| Invalid(format!("Unreadable {name}"))),
        }
    };
    let due = read("DUE")?;
    let start = read("DTSTART")?;
    let timezone = todo
        .prop("DUE")
        .or_else(|| todo.prop("DTSTART"))
        .and_then(|p| p.param("TZID"))
        .and_then(ical::zone)
        .map(|tz| tz.name().to_string());
    let done = todo
        .text("STATUS")
        .is_some_and(|s| s.eq_ignore_ascii_case("COMPLETED"))
        || todo.prop("COMPLETED").is_some();
    let priority = priority_in(todo.prop("PRIORITY").and_then(|p| p.value.trim().parse().ok()));
    let tz = timezone.as_deref().and_then(ical::zone);
    let rrule = todo
        .prop("RRULE")
        .map(|p| p.value.trim().to_string())
        .filter(|r| !r.is_empty())
        .map(|r| ical::normalize_rrule(&r, tz));
    let mut tags: Vec<String> = todo
        .props_named("CATEGORIES")
        .flat_map(|p| split_list(&p.value))
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    tags.dedup();
    let geofence = todo
        .children
        .iter()
        .filter(|c| is_arrival_alarm(c))
        .find_map(arrival_point)
        .map(|(lat, lng, r)| (lat, lng, r.unwrap_or(MIN_RADIUS)));
    let extra = fragment(todo, |n| !MODELED.contains(&n));
    Ok(TaskFields {
        uid,
        title: todo.text("SUMMARY").unwrap_or_default(),
        notes: todo.text("DESCRIPTION").filter(|d| !d.is_empty()),
        location: todo.text("LOCATION").filter(|l| !l.is_empty()),
        due,
        start,
        done,
        priority,
        rrule,
        tags,
        geofence,
        timezone,
        extra,
    })
}

/// A comma-separated text list, unescaped: `a\,b,c` is `["a,b", "c"]`.
fn split_list(value: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                if let Some(n) = chars.next() {
                    current.push('\\');
                    current.push(n);
                }
            }
            ',' => out.push(ical::unescape(&std::mem::take(&mut current))),
            _ => current.push(c),
        }
    }
    out.push(ical::unescape(&current));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calendar::tasks::model::TaskRecord;

    fn t(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap()
    }

    fn task() -> TaskRecord {
        TaskRecord {
            id: "t1".into(),
            user_id: "u1".into(),
            title: "Buy milk".into(),
            notes: None,
            done: false,
            due_date: None,
            position: 0,
            created_at: t("2026-11-01 00:00:00"),
            updated_at: t("2026-11-02 00:00:00"),
            event_id: None,
            due_has_time: false,
            start_date: None,
            start_has_time: false,
            priority: None,
            estimate_minutes: None,
            location: None,
            recurrence_rule: None,
            repeat_after_completion: false,
            geo_place_id: None,
            geo_lat: None,
            geo_lng: None,
            geo_radius_m: None,
        }
    }

    #[test]
    fn priorities_map_both_ways_in_apples_values() {
        assert_eq!([1, 2, 3].map(|p| priority_out(Some(p))), [Some(1), Some(5), Some(9)]);
        assert_eq!(priority_out(None), None);
        for (ical, neutrino) in [(0, None), (1, Some(1)), (4, Some(1)), (5, Some(2)), (6, Some(3)), (9, Some(3))] {
            assert_eq!(priority_in(Some(ical)), neutrino, "{ical}");
        }
    }

    #[test]
    fn a_task_round_trips() {
        let mut tk = task();
        tk.notes = Some("2%, the blue one".into());
        tk.due_date = Some(t("2026-11-17 17:00:00"));
        tk.due_has_time = true;
        tk.start_date = Some(t("2026-11-16 00:00:00"));
        tk.priority = Some(2);
        tk.recurrence_rule = Some("FREQ=WEEKLY".into());
        let obj = TaskObject { task: tk, tags: vec!["errands".into(), "a,b".into()] };
        let ics = render(&obj, "t1", None);
        assert!(ics.contains("DUE:20261117T170000Z\r\n"));
        assert!(ics.contains("DTSTART;VALUE=DATE:20261116\r\n"));
        assert!(ics.contains("PRIORITY:5\r\n"));
        assert!(ics.contains("STATUS:NEEDS-ACTION\r\n"));
        let back = parse_task(&ics).unwrap();
        assert_eq!(back.title, "Buy milk");
        assert_eq!(back.notes.as_deref(), Some("2%, the blue one"));
        assert_eq!(back.due, Some((t("2026-11-17 17:00:00"), true)));
        assert_eq!(back.start, Some((t("2026-11-16 00:00:00"), false)));
        assert_eq!(back.priority, Some(2));
        assert_eq!(back.rrule.as_deref(), Some("FREQ=WEEKLY"));
        assert_eq!(back.tags, vec!["errands", "a,b"]);
        assert!(!back.done);
        assert!(back.extra.is_none());
    }

    #[test]
    fn completion_is_read_from_status_or_completed() {
        let base = |line: &str| format!("BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:x\r\nSUMMARY:X\r\n{line}END:VTODO\r\nEND:VCALENDAR\r\n");
        assert!(parse_task(&base("STATUS:COMPLETED\r\n")).unwrap().done);
        assert!(parse_task(&base("COMPLETED:20261117T170000Z\r\n")).unwrap().done);
        assert!(!parse_task(&base("STATUS:NEEDS-ACTION\r\n")).unwrap().done);
        let mut tk = task();
        tk.done = true;
        let ics = render(&TaskObject { task: tk, tags: vec![] }, "t1", None);
        assert!(ics.contains("STATUS:COMPLETED\r\n"));
        assert!(ics.contains("COMPLETED:20261102T000000Z\r\n"));
    }

    #[test]
    fn the_clients_completion_time_is_kept_and_dropped_when_reopened() {
        let sent = "BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:x\r\nSUMMARY:X\r\nSTATUS:COMPLETED\r\nCOMPLETED:20261110T090000Z\r\nX-APPLE-SORT-ORDER:700000000\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        let parsed = parse_task(sent).unwrap();
        let mut tk = task();
        tk.done = true;
        let ics = render(&TaskObject { task: tk.clone(), tags: vec![] }, "x", parsed.extra.as_deref());
        assert!(ics.contains("COMPLETED:20261110T090000Z\r\n"));
        assert!(ics.contains("X-APPLE-SORT-ORDER:700000000\r\n"));
        tk.done = false;
        let reopened = render(&TaskObject { task: tk, tags: vec![] }, "x", parsed.extra.as_deref());
        assert!(!reopened.contains("COMPLETED:"));
    }

    #[test]
    fn an_arrival_alarm_is_the_geofence_and_keeps_its_title() {
        let sent = "BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:x\r\nSUMMARY:Groceries\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER;VALUE=DATE-TIME:19760401T005545Z\r\nX-APPLE-PROXIMITY:ARRIVE\r\nX-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-APPLE-RADIUS=150.5;X-TITLE=Safeway:geo:37.33,-122.03\r\nEND:VALARM\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        let parsed = parse_task(sent).unwrap();
        assert_eq!(parsed.geofence, Some((37.33, -122.03, 151)));
        let mut tk = task();
        tk.geo_lat = Some(37.33);
        tk.geo_lng = Some(-122.03);
        tk.geo_radius_m = Some(151);
        let ics = render(&TaskObject { task: tk.clone(), tags: vec![] }, "x", parsed.extra.as_deref());
        assert_eq!(ics.matches("BEGIN:VALARM").count(), 1);
        assert!(ics.contains("X-TITLE=Safeway"));
        // Moved in Neutrino: the title no longer describes the point.
        tk.geo_lat = Some(40.0);
        let moved = render(&TaskObject { task: tk.clone(), tags: vec![] }, "x", parsed.extra.as_deref());
        assert!(moved.contains("X-TITLE=Location"));
        // Removed in Neutrino: no alarm.
        tk.geo_lat = None;
        tk.geo_lng = None;
        let gone = render(&TaskObject { task: tk, tags: vec![] }, "x", parsed.extra.as_deref());
        assert!(!gone.contains("BEGIN:VALARM"));
    }

    #[test]
    fn a_timed_alarm_and_a_subtask_link_are_kept() {
        let sent = "BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:x\r\nSUMMARY:X\r\nRELATED-TO;RELTYPE=PARENT:parent-uid\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT10M\r\nEND:VALARM\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        let parsed = parse_task(sent).unwrap();
        assert_eq!(parsed.geofence, None);
        let ics = render(&TaskObject { task: task(), tags: vec![] }, "x", parsed.extra.as_deref());
        assert!(ics.contains("RELATED-TO;RELTYPE=PARENT:parent-uid\r\n"));
        assert!(ics.contains("TRIGGER:-PT10M\r\n"));
    }

    #[test]
    fn a_due_time_in_a_zone_is_read_as_utc() {
        let sent = "BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:x\r\nSUMMARY:X\r\nDUE;TZID=America/New_York:20261117T090000\r\nRRULE:FREQ=DAILY;UNTIL=20261130T090000\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
        let parsed = parse_task(sent).unwrap();
        assert_eq!(parsed.due, Some((t("2026-11-17 14:00:00"), true)));
        assert_eq!(parsed.timezone.as_deref(), Some("America/New_York"));
        assert_eq!(parsed.rrule.as_deref(), Some("FREQ=DAILY;UNTIL=20261130T140000Z"));
    }
}
