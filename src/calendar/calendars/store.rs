//! The calendar lookups that event writes and sync need. Each takes a connection, so the events
//! service can make them inside the transaction that writes the event.

use crate::calendar::calendars::model::{CalendarRecord, NewCalendarRecord, CONNECTION, LOCAL};
use crate::schema::calendars;
use crate::shared::ApiError;
use chrono::NaiveDateTime;
use diesel::prelude::*;
use uuid::Uuid;

pub const DEFAULT_NAME: &str = "Calendar";
pub const DEFAULT_COLOR: &str = "#3b82f6";

/// The name and colour a provider's calendar starts with; the migration uses the same.
fn provider_look(provider: &str) -> (&'static str, &'static str) {
    match provider {
        "google" => ("Google Calendar", "#16a34a"),
        "outlook" => ("Outlook Calendar", "#0ea5e9"),
        _ => ("Apple Calendar", "#f97316"),
    }
}

/// `user_id`'s calendar `id`. Another user's is not found, as with events.
pub fn find(
    conn: &mut SqliteConnection,
    id: &str,
    user_id: &str,
) -> Result<CalendarRecord, ApiError> {
    calendars::table
        .filter(calendars::id.eq(id).and(calendars::user_id.eq(user_id)))
        .select(CalendarRecord::as_select())
        .first(conn)
        .optional()?
        .ok_or_else(|| ApiError::not_found("Calendar not found"))
}

pub fn list(conn: &mut SqliteConnection, user_id: &str) -> Result<Vec<CalendarRecord>, ApiError> {
    Ok(calendars::table
        .filter(calendars::user_id.eq(user_id))
        .order(calendars::created_at.asc())
        .select(CalendarRecord::as_select())
        .load(conn)?)
}

/// `user_id`'s default calendar, made if they have none yet: a user added since the migration
/// gets theirs the first time anything needs it.
pub fn default_calendar(
    conn: &mut SqliteConnection,
    user_id: &str,
    now: NaiveDateTime,
) -> Result<CalendarRecord, ApiError> {
    let find_default = |conn: &mut SqliteConnection| {
        calendars::table
            .filter(calendars::user_id.eq(user_id))
            .filter(calendars::is_default.eq(true))
            .select(CalendarRecord::as_select())
            .first(conn)
            .optional()
    };
    if let Some(found) = find_default(conn)? {
        return Ok(found);
    }
    // Or-ignore: a request racing this one may have just made it, and the unique index on the
    // default keeps there being one.
    diesel::insert_or_ignore_into(calendars::table)
        .values(NewCalendarRecord {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            name: DEFAULT_NAME.to_string(),
            color: DEFAULT_COLOR.to_string(),
            visible: true,
            read_only: false,
            kind: LOCAL.to_string(),
            is_default: true,
            source: None,
            country: None,
            region: None,
            include_observances: false,
            created_at: now,
            updated_at: now,
        })
        .execute(conn)?;
    find_default(conn)?.ok_or_else(|| ApiError::internal("Default calendar missing"))
}

/// The calendar `provider`'s synced events land in, made on the first sync.
pub fn provider_calendar(
    conn: &mut SqliteConnection,
    user_id: &str,
    provider: &str,
    now: NaiveDateTime,
) -> Result<CalendarRecord, ApiError> {
    let find_it = |conn: &mut SqliteConnection| {
        calendars::table
            .filter(calendars::user_id.eq(user_id))
            .filter(calendars::kind.eq(CONNECTION))
            .filter(calendars::source.eq(provider))
            .select(CalendarRecord::as_select())
            .first(conn)
            .optional()
    };
    if let Some(found) = find_it(conn)? {
        return Ok(found);
    }
    let (name, color) = provider_look(provider);
    diesel::insert_or_ignore_into(calendars::table)
        .values(NewCalendarRecord {
            id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            name: name.to_string(),
            color: color.to_string(),
            visible: true,
            read_only: false,
            kind: CONNECTION.to_string(),
            is_default: false,
            source: Some(provider.to_string()),
            country: None,
            region: None,
            include_observances: false,
            created_at: now,
            updated_at: now,
        })
        .execute(conn)?;
    find_it(conn)?.ok_or_else(|| ApiError::internal("Provider calendar missing"))
}

/// Refuses a write to an event in a read-only calendar. An event with no calendar is one deleted
/// with its calendar, which the caller has already not found.
pub fn ensure_writable(
    conn: &mut SqliteConnection,
    user_id: &str,
    calendar_id: Option<&str>,
) -> Result<(), ApiError> {
    let Some(id) = calendar_id else {
        return Ok(());
    };
    let calendar = calendars::table
        .filter(calendars::id.eq(id).and(calendars::user_id.eq(user_id)))
        .select(CalendarRecord::as_select())
        .first(conn)
        .optional()?;
    match calendar {
        Some(c) if c.read_only => Err(read_only()),
        _ => Ok(()),
    }
}

/// The calendar a new event goes in: the one asked for, which must be the user's and writable,
/// or else the default.
pub fn for_new_event(
    conn: &mut SqliteConnection,
    user_id: &str,
    requested: Option<&str>,
    now: NaiveDateTime,
) -> Result<String, ApiError> {
    match requested.filter(|id| !id.is_empty()) {
        Some(id) => writable_target(conn, user_id, id),
        None => Ok(default_calendar(conn, user_id, now)?.id),
    }
}

/// `id`, which an event is being put in: the user's, and not read-only.
pub fn writable_target(
    conn: &mut SqliteConnection,
    user_id: &str,
    id: &str,
) -> Result<String, ApiError> {
    let calendar = find(conn, id, user_id)?;
    if calendar.read_only {
        return Err(read_only());
    }
    Ok(calendar.id)
}

pub fn read_only() -> ApiError {
    ApiError::forbidden("This calendar is read-only")
}
