//! Repeating events and their exceptions: "this event", "this and following" and "all events".
//! The design, and the reasons for each rule here, are in `agent_docs/recurrence-exceptions.md`.
//!
//! Everything that writes takes a connection so the service can run it inside one transaction:
//! a split that failed halfway would leave a series cut short with nothing after it.

use crate::calendar::events::attendees::NewAttendeeRecord;
use crate::calendar::events::model::{EventRecord, NewEventRecord, UpdateEventRecord};
use crate::schema::{event_attendees, events};
use crate::shared::ApiError;
use chrono::{Datelike, Duration, NaiveDateTime, NaiveTime, TimeZone};
use chrono_tz::Tz;
use diesel::prelude::*;
use uuid::Uuid;

/// How far apart an exception's original start and an occurrence may be and still be the same
/// occurrence. Clients expand in the viewer's zone, so two viewers whose zones change for DST on
/// different dates put one occurrence up to an hour apart; occurrences are at least a day apart,
/// so this can't reach the wrong one.
pub const MATCH_WINDOW: Duration = Duration::hours(2);

// ── Rules ────────────────────────────────────────────────────────────────────

/// `rule` ended before the occurrence starting at `at`: its COUNT and UNTIL replaced by an UNTIL
/// at the end of the day before `at`'s. The end of a day, not the second before `at`, because
/// that is what an end date in either client's form reads back and writes again: a form that
/// showed the end as `at`'s own day would, on saving, bring that occurrence back.
///
/// An all-day event's day is its UTC date, written `T235959Z` as its end time is; a timed
/// event's is the day in its own zone (UTC when it has none).
pub fn ending_before(rule: &str, at: NaiveDateTime, all_day: bool, tz: Tz) -> String {
    let until = if all_day {
        (at.date() - Duration::days(1))
            .and_hms_opt(23, 59, 59)
            .unwrap()
    } else {
        let local_day = tz.from_utc_datetime(&at).date_naive();
        local_midnight(local_day, tz) - Duration::seconds(1)
    };
    let mut parts: Vec<String> = rule
        .split(';')
        .filter(|p| !p.is_empty())
        .filter(|p| !matches!(key(p).as_str(), "COUNT" | "UNTIL"))
        .map(str::to_string)
        .collect();
    parts.push(format!("UNTIL={}", until.format("%Y%m%dT%H%M%SZ")));
    parts.join(";")
}

/// The instant `day` begins in `tz`. A midnight skipped by DST begins at the first instant after
/// the gap.
fn local_midnight(day: chrono::NaiveDate, tz: Tz) -> NaiveDateTime {
    let midnight = day.and_time(NaiveTime::MIN);
    tz.from_local_datetime(&midnight)
        .earliest()
        .or_else(|| {
            tz.from_local_datetime(&(midnight + Duration::hours(1)))
                .earliest()
        })
        .map(|t| t.naive_utc())
        .unwrap_or(midnight)
}

/// What a rule repeats on, without when it stops: COUNT and UNTIL dropped, keys upper-cased.
/// Two rules with the same pattern put their occurrences on the same dates, so exceptions keyed
/// by those dates still mean something.
pub fn pattern(rule: Option<&str>) -> Option<String> {
    let rule = rule.filter(|r| !r.is_empty())?;
    let parts: Vec<String> = rule
        .split(';')
        .filter(|p| !p.is_empty())
        .filter(|p| !matches!(key(p).as_str(), "COUNT" | "UNTIL"))
        .map(|p| match p.split_once('=') {
            Some((k, v)) => format!("{}={}", k.to_ascii_uppercase(), v.to_ascii_uppercase()),
            None => p.to_ascii_uppercase(),
        })
        .collect();
    Some(parts.join(";"))
}

fn key(part: &str) -> String {
    part.split('=')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase()
}

fn has_by_day(rule: Option<&str>) -> bool {
    rule.is_some_and(|r| r.split(';').any(|p| key(p) == "BYDAY"))
}

pub fn zone(name: Option<&str>) -> Tz {
    name.and_then(|n| n.parse::<Tz>().ok()).unwrap_or(Tz::UTC)
}

// ── Series shape ─────────────────────────────────────────────────────────────

/// What a series' exceptions are reconciled against when it changes.
#[derive(Debug, Clone)]
pub struct Shape {
    pub start: NaiveDateTime,
    pub end: NaiveDateTime,
    pub all_day: bool,
    pub rule: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub timezone: Option<String>,
    pub attendees: Vec<String>,
}

impl Shape {
    pub fn of(record: &EventRecord, attendees: Vec<String>) -> Shape {
        Shape {
            start: record.start_time,
            end: record.end_time,
            all_day: record.all_day,
            rule: record.recurrence_rule.clone(),
            title: record.title.clone(),
            description: record.description.clone(),
            location: record.location.clone(),
            timezone: record.timezone.clone(),
            attendees,
        }
    }

    fn length(&self) -> Duration {
        self.end - self.start
    }
}

/// Whether a change from `old` to `new` leaves the exceptions' original starts naming nothing:
/// a new pattern, a switch to or from all-day, or, for a rule with BYDAY, a move to another
/// weekday, which BYDAY doesn't follow.
pub fn orphans_exceptions(old: &Shape, new: &Shape) -> bool {
    if pattern(old.rule.as_deref()) != pattern(new.rule.as_deref()) || old.all_day != new.all_day {
        return true;
    }
    if new.start != old.start && has_by_day(new.rule.as_deref()) {
        let tz = zone(new.timezone.as_deref());
        let weekday = |t: NaiveDateTime| tz.from_utc_datetime(&t).weekday();
        return weekday(old.start) != weekday(new.start);
    }
    false
}

// ── Reading ──────────────────────────────────────────────────────────────────

pub fn find_live(
    conn: &mut SqliteConnection,
    id: &str,
    user_id: &str,
) -> Result<EventRecord, ApiError> {
    events::table
        .filter(events::id.eq(id).and(events::user_id.eq(user_id)))
        .filter(events::deleted_at.is_null())
        .select(EventRecord::as_select())
        .first(conn)
        .optional()?
        .ok_or_else(|| ApiError::not_found("Event not found"))
}

/// A series' live exceptions, cancelled ones included, by original start.
pub fn exceptions_of(
    conn: &mut SqliteConnection,
    series_id: &str,
) -> Result<Vec<EventRecord>, ApiError> {
    Ok(events::table
        .filter(events::recurring_event_id.eq(series_id))
        .filter(events::deleted_at.is_null())
        .order(events::original_start_time.asc())
        .select(EventRecord::as_select())
        .load(conn)?)
}

pub fn attendees_of(conn: &mut SqliteConnection, event_id: &str) -> Result<Vec<String>, ApiError> {
    Ok(event_attendees::table
        .filter(event_attendees::event_id.eq(event_id))
        .select(event_attendees::email)
        .load(conn)?)
}

// ── Writing ──────────────────────────────────────────────────────────────────

pub fn insert(
    conn: &mut SqliteConnection,
    record: NewEventRecord,
) -> Result<EventRecord, ApiError> {
    let id = record.id.clone();
    diesel::insert_into(events::table)
        .values(&record)
        .execute(conn)?;
    Ok(events::table
        .filter(events::id.eq(&id))
        .select(EventRecord::as_select())
        .first(conn)?)
}

pub fn update(
    conn: &mut SqliteConnection,
    id: &str,
    changes: &UpdateEventRecord,
) -> Result<EventRecord, ApiError> {
    diesel::update(events::table.filter(events::id.eq(id)))
        .set(changes)
        .execute(conn)?;
    Ok(events::table
        .filter(events::id.eq(id))
        .select(EventRecord::as_select())
        .first(conn)?)
}

pub fn replace_attendees(
    conn: &mut SqliteConnection,
    event_id: &str,
    emails: &[String],
) -> Result<(), ApiError> {
    diesel::delete(event_attendees::table.filter(event_attendees::event_id.eq(event_id)))
        .execute(conn)?;
    let records: Vec<NewAttendeeRecord> = emails
        .iter()
        .map(|email| NewAttendeeRecord {
            id: Uuid::new_v4().to_string(),
            event_id: event_id.to_string(),
            email: email.clone(),
        })
        .collect();
    if !records.is_empty() {
        diesel::insert_into(event_attendees::table)
            .values(&records)
            .execute(conn)?;
    }
    Ok(())
}

/// Soft-deletes a series' exceptions whose original start is at or after `from` (all of them
/// when `from` is `None`), so the changes feed reports them.
pub fn delete_exceptions(
    conn: &mut SqliteConnection,
    series_id: &str,
    from: Option<NaiveDateTime>,
    now: NaiveDateTime,
) -> Result<(), ApiError> {
    let mut query = diesel::update(events::table)
        .filter(events::recurring_event_id.eq(series_id))
        .filter(events::deleted_at.is_null())
        .into_boxed();
    if let Some(from) = from {
        query = query.filter(events::original_start_time.ge(from));
    }
    query
        .set((events::deleted_at.eq(Some(now)), events::updated_at.eq(now)))
        .execute(conn)?;
    Ok(())
}

/// The live exception standing in for the occurrence of `series` that started at `original`,
/// made from the series if there is none yet: its fields, its attendees, and the occurrence's
/// times.
pub fn exception_for(
    conn: &mut SqliteConnection,
    series: &EventRecord,
    original: NaiveDateTime,
    now: NaiveDateTime,
) -> Result<EventRecord, ApiError> {
    let existing = events::table
        .filter(events::recurring_event_id.eq(&series.id))
        .filter(events::original_start_time.eq(original))
        .filter(events::deleted_at.is_null())
        .select(EventRecord::as_select())
        .first(conn)
        .optional()?;
    if let Some(existing) = existing {
        return Ok(existing);
    }
    let id = Uuid::new_v4().to_string();
    let created = insert(
        conn,
        NewEventRecord {
            id: id.clone(),
            user_id: series.user_id.clone(),
            title: series.title.clone(),
            description: series.description.clone(),
            start_time: original,
            end_time: original + (series.end_time - series.start_time),
            all_day: series.all_day,
            location: series.location.clone(),
            recurrence_rule: None,
            external_id: None,
            source: series.source.clone(),
            created_at: now,
            updated_at: now,
            timezone: series.timezone.clone(),
            recurring_event_id: Some(series.id.clone()),
            original_start_time: Some(original),
            cancelled: false,
        },
    )?;
    let attendees = attendees_of(conn, &series.id)?;
    replace_attendees(conn, &id, &attendees)?;
    Ok(created)
}

/// Brings a series' exceptions along with a change to the series, from `old` to `new`:
///
/// - A field still holding the series' old value takes the new one; one changed on the
///   exception keeps its own.
/// - A move of the series moves each exception's original start by as much, and its times too
///   unless it had moved them itself; a new length changes the end of those that hadn't.
/// - A change that leaves the original starts naming nothing (`orphans_exceptions`) deletes them.
pub fn reconcile(
    conn: &mut SqliteConnection,
    series_id: &str,
    old: &Shape,
    new: &Shape,
    now: NaiveDateTime,
) -> Result<(), ApiError> {
    let mut exceptions = exceptions_of(conn, series_id)?;
    if exceptions.is_empty() {
        return Ok(());
    }
    if orphans_exceptions(old, new) {
        return delete_exceptions(conn, series_id, None, now);
    }
    let delta = new.start - old.start;
    let retimed = delta != Duration::zero() || new.length() != old.length();
    // Moved one at a time, furthest first, so a move by exactly the gap between two exceptions
    // never puts one on the other's key, even for a moment.
    if delta > Duration::zero() {
        exceptions.reverse();
    }
    for exception in exceptions {
        let mut changes = UpdateEventRecord {
            updated_at: now,
            ..Default::default()
        };
        let mut changed = false;
        if exception.title == old.title && new.title != old.title {
            changes.title = Some(new.title.clone());
            changed = true;
        }
        if exception.description == old.description && new.description != old.description {
            changes.description = Some(new.description.clone());
            changed = true;
        }
        if exception.location == old.location && new.location != old.location {
            changes.location = Some(new.location.clone());
            changed = true;
        }
        if exception.timezone == old.timezone && new.timezone != old.timezone {
            changes.timezone = Some(new.timezone.clone());
            changed = true;
        }
        if retimed {
            if let Some(original) = exception.original_start_time {
                let moved = original + delta;
                let kept_own_time = exception.start_time == original
                    && exception.end_time - exception.start_time == old.length();
                if kept_own_time {
                    changes.start_time = Some(moved);
                    changes.end_time = Some(moved + new.length());
                }
                if delta != Duration::zero() {
                    changes.original_start_time = Some(Some(moved));
                }
                changed |= kept_own_time || delta != Duration::zero();
            }
        }
        if new.attendees != old.attendees && attendees_of(conn, &exception.id)? == old.attendees {
            replace_attendees(conn, &exception.id, &new.attendees)?;
            changed = true;
        }
        if changed {
            update(conn, &exception.id, &changes)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn at(s: &str) -> NaiveDateTime {
        s.parse::<chrono::DateTime<Utc>>().unwrap().naive_utc()
    }

    #[test]
    fn a_timed_series_ends_on_the_last_second_of_the_day_before_in_its_own_zone() {
        let ny: Tz = "America/New_York".parse().unwrap();
        // 09:00 in New York on 6 October is 13:00 UTC; the day before ends at 04:00 UTC on the 6th.
        assert_eq!(
            ending_before(
                "FREQ=WEEKLY;COUNT=10;BYDAY=TU",
                at("2026-10-06T13:00:00Z"),
                false,
                ny
            ),
            "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261006T035959Z"
        );
    }

    #[test]
    fn an_all_day_series_ends_the_way_its_end_time_is_written() {
        assert_eq!(
            ending_before(
                "FREQ=DAILY;UNTIL=20261231T235959Z",
                at("2026-10-06T00:00:00Z"),
                true,
                Tz::UTC
            ),
            "FREQ=DAILY;UNTIL=20261005T235959Z"
        );
    }

    #[test]
    fn a_pattern_ignores_when_the_rule_stops_and_how_it_is_cased() {
        assert_eq!(
            pattern(Some("FREQ=WEEKLY;COUNT=3;byday=mo")),
            pattern(Some("freq=weekly;BYDAY=MO;UNTIL=20261231T000000Z"))
        );
        assert_ne!(pattern(Some("FREQ=WEEKLY")), pattern(Some("FREQ=DAILY")));
        assert_eq!(pattern(Some("")), None);
    }

    fn shape(start: &str, rule: &str) -> Shape {
        Shape {
            start: at(start),
            end: at(start) + Duration::hours(1),
            all_day: false,
            rule: Some(rule.into()),
            title: "Standup".into(),
            description: None,
            location: None,
            timezone: None,
            attendees: vec![],
        }
    }

    #[test]
    fn exceptions_survive_a_new_time_or_end_but_not_a_new_pattern() {
        let old = shape("2026-10-05T09:00:00Z", "FREQ=WEEKLY;BYDAY=MO");
        assert!(!orphans_exceptions(
            &old,
            &shape("2026-10-05T10:00:00Z", "FREQ=WEEKLY;BYDAY=MO;COUNT=4")
        ));
        assert!(orphans_exceptions(
            &old,
            &shape("2026-10-05T09:00:00Z", "FREQ=DAILY")
        ));
        assert!(
            orphans_exceptions(&old, &shape("2026-10-06T09:00:00Z", "FREQ=WEEKLY;BYDAY=MO")),
            "BYDAY doesn't follow the series to Tuesday"
        );
        assert!(
            !orphans_exceptions(
                &shape("2026-10-05T09:00:00Z", "FREQ=WEEKLY"),
                &shape("2026-10-06T09:00:00Z", "FREQ=WEEKLY")
            ),
            "without BYDAY every occurrence moves a day with it"
        );
    }
}
