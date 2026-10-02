use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCalendarRequest {
    /// Required for a `local` calendar; a holiday calendar defaults to its country code.
    pub name: Option<String>,
    /// `#rrggbb`. Defaults to a colour chosen by kind.
    pub color: Option<String>,
    /// `local` (the default) or `holidays`. Connection calendars are made by connecting an account.
    pub kind: Option<String>,
    /// For `holidays`: ISO 3166-1 alpha-2, e.g. `US`.
    pub country: Option<String>,
    /// For `holidays`: a region of the country, e.g. `CA` for California.
    pub region: Option<String>,
    /// For `holidays`: observances as well as public holidays. Off by default.
    #[serde(default)]
    pub include_observances: bool,
}

/// Only the fields given change. `region` empty clears it.
#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCalendarRequest {
    pub name: Option<String>,
    pub color: Option<String>,
    pub visible: Option<bool>,
    /// Holiday calendars only.
    pub region: Option<String>,
    /// Holiday calendars only.
    pub include_observances: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarResponse {
    pub id: String,
    pub name: String,
    pub color: String,
    pub visible: bool,
    pub read_only: bool,
    /// `local`, `connection` or `holidays`.
    pub kind: String,
    pub is_default: bool,
    /// Connection calendars: the provider (`google`, `outlook`, `apple`).
    pub source: Option<String>,
    /// Holiday calendars: ISO 3166-1 alpha-2.
    pub country: Option<String>,
    pub region: Option<String>,
    pub include_observances: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListCalendarsResponse {
    pub calendars: Vec<CalendarResponse>,
}
