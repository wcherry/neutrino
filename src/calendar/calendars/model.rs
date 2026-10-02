use chrono::NaiveDateTime;
use diesel::prelude::*;

/// The user's own calendar. One of them is the default.
pub const LOCAL: &str = "local";
/// A synced provider's events; `source` names the provider.
pub const CONNECTION: &str = "connection";
/// A country's public holidays, which the clients compute. It holds no events.
pub const HOLIDAYS: &str = "holidays";

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::calendars)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct CalendarRecord {
    pub id: String,
    pub user_id: String,
    pub name: String,
    /// `#rrggbb`.
    pub color: String,
    pub visible: bool,
    /// Its events can't be created, edited or deleted.
    pub read_only: bool,
    pub kind: String,
    /// Where events created without a calendar go. Can't be deleted.
    pub is_default: bool,
    /// For a connection calendar: the provider, as in `events.source`.
    pub source: Option<String>,
    /// For a holiday calendar: ISO 3166-1 alpha-2.
    pub country: Option<String>,
    /// For a holiday calendar: a region of the country, as `date-holidays` names it ("CA", "BY").
    pub region: Option<String>,
    /// For a holiday calendar: observances (Mother's Day, Halloween) as well as public holidays.
    pub include_observances: bool,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::calendars)]
pub struct NewCalendarRecord {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub color: String,
    pub visible: bool,
    pub read_only: bool,
    pub kind: String,
    pub is_default: bool,
    pub source: Option<String>,
    pub country: Option<String>,
    pub region: Option<String>,
    pub include_observances: bool,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Default, AsChangeset)]
#[diesel(table_name = crate::schema::calendars)]
pub struct UpdateCalendarRecord {
    pub name: Option<String>,
    pub color: Option<String>,
    pub visible: Option<bool>,
    pub region: Option<Option<String>>,
    pub include_observances: Option<bool>,
    pub updated_at: NaiveDateTime,
}
