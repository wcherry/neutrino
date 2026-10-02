use crate::calendar::calendars::{
    dto::{CalendarResponse, CreateCalendarRequest, ListCalendarsResponse, UpdateCalendarRequest},
    model::{CalendarRecord, NewCalendarRecord, UpdateCalendarRecord, CONNECTION, HOLIDAYS, LOCAL},
    store,
};
use crate::calendar::events::repository::DbPool;
use crate::schema::{calendar_connections, calendars, events};
use crate::shared::{ApiError, AuthenticatedUser};
use chrono::{NaiveDateTime, Utc};
use diesel::prelude::*;
use uuid::Uuid;

const HOLIDAYS_COLOR: &str = "#8b5cf6";
const MAX_NAME_LEN: usize = 100;

pub struct CalendarsService {
    pool: DbPool,
}

impl CalendarsService {
    pub fn new(pool: DbPool) -> Self {
        CalendarsService { pool }
    }

    fn transaction<T>(
        &self,
        f: impl FnOnce(&mut SqliteConnection) -> Result<T, ApiError>,
    ) -> Result<T, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })?;
        let conn: &mut SqliteConnection = &mut conn;
        conn.transaction(f)
    }

    /// The user's calendars: the default first, then their own, their providers', and holidays,
    /// each in the order they were added. Makes the default if they have none yet.
    pub fn list(&self, user: &AuthenticatedUser) -> Result<ListCalendarsResponse, ApiError> {
        let now = Utc::now().naive_utc();
        let mut records = self.transaction(|conn| {
            store::default_calendar(conn, &user.user_id, now)?;
            store::list(conn, &user.user_id)
        })?;
        let rank = |c: &CalendarRecord| match (c.is_default, c.kind.as_str()) {
            (true, _) => 0,
            (_, LOCAL) => 1,
            (_, CONNECTION) => 2,
            _ => 3,
        };
        // Stable: within a rank, the order they were added.
        records.sort_by_key(rank);
        Ok(ListCalendarsResponse {
            calendars: records.into_iter().map(to_response).collect(),
        })
    }

    /// A local calendar, or a country's holidays. One holiday calendar per country.
    pub fn create(
        &self,
        user: &AuthenticatedUser,
        req: CreateCalendarRequest,
    ) -> Result<CalendarResponse, ApiError> {
        let now = Utc::now().naive_utc();
        let kind = req.kind.as_deref().unwrap_or(LOCAL);
        let record = match kind {
            LOCAL => {
                let name = valid_name(req.name.as_deref().unwrap_or(""))?;
                new_record(
                    user,
                    name,
                    colour_or(req.color, store::DEFAULT_COLOR)?,
                    LOCAL,
                    now,
                )
            }
            HOLIDAYS => {
                let country = valid_country(req.country.as_deref().unwrap_or(""))?;
                let name = match req.name.as_deref().map(str::trim) {
                    Some(n) if !n.is_empty() => valid_name(n)?,
                    _ => country.clone(),
                };
                NewCalendarRecord {
                    read_only: true,
                    country: Some(country),
                    region: valid_region(req.region.as_deref())?,
                    include_observances: req.include_observances,
                    ..new_record(
                        user,
                        name,
                        colour_or(req.color, HOLIDAYS_COLOR)?,
                        HOLIDAYS,
                        now,
                    )
                }
            }
            CONNECTION => {
                return Err(ApiError::bad_request(
                    "A provider's calendar is made by connecting the account",
                ))
            }
            other => {
                return Err(ApiError::bad_request(format!(
                    "Unknown calendar kind: {other}"
                )))
            }
        };
        let id = record.id.clone();
        let saved = self.transaction(|conn| {
            if let Some(country) = &record.country {
                let taken = calendars::table
                    .filter(calendars::user_id.eq(&user.user_id))
                    .filter(calendars::kind.eq(HOLIDAYS))
                    .filter(calendars::country.eq(country))
                    .count()
                    .get_result::<i64>(conn)?;
                if taken > 0 {
                    return Err(ApiError::conflict(
                        "That country's holidays are already added",
                    ));
                }
            }
            diesel::insert_into(calendars::table)
                .values(&record)
                .execute(conn)?;
            store::find(conn, &id, &user.user_id)
        })?;
        Ok(to_response(saved))
    }

    /// Renames, recolours, shows or hides a calendar; for holidays, also its region and whether
    /// observances are included. These are settings, so a read-only calendar takes them too.
    pub fn update(
        &self,
        user: &AuthenticatedUser,
        id: &str,
        req: UpdateCalendarRequest,
    ) -> Result<CalendarResponse, ApiError> {
        let now = Utc::now().naive_utc();
        let changes = UpdateCalendarRecord {
            name: req.name.as_deref().map(valid_name).transpose()?,
            color: req.color.as_deref().map(valid_colour).transpose()?,
            visible: req.visible,
            region: match req.region.as_deref() {
                None => None,
                Some(r) => Some(valid_region(Some(r))?),
            },
            include_observances: req.include_observances,
            updated_at: now,
        };
        let updated = self.transaction(|conn| {
            let calendar = store::find(conn, id, &user.user_id)?;
            if calendar.kind != HOLIDAYS
                && (changes.region.is_some() || changes.include_observances.is_some())
            {
                return Err(ApiError::bad_request(
                    "Only a holiday calendar has a region and observances",
                ));
            }
            diesel::update(calendars::table.filter(calendars::id.eq(id)))
                .set(&changes)
                .execute(conn)?;
            store::find(conn, id, &user.user_id)
        })?;
        Ok(to_response(updated))
    }

    /// Deletes a calendar and its events (soft-deleted, so the changes feed reports them). The
    /// default can't go, nor can a provider's while its account is connected: the next sync would
    /// only bring it back.
    pub fn delete(&self, user: &AuthenticatedUser, id: &str) -> Result<(), ApiError> {
        let now = Utc::now().naive_utc();
        self.transaction(|conn| {
            let calendar = store::find(conn, id, &user.user_id)?;
            if calendar.is_default {
                return Err(ApiError::bad_request(
                    "The default calendar can't be deleted",
                ));
            }
            if let Some(provider) = calendar
                .source
                .as_deref()
                .filter(|_| calendar.kind == CONNECTION)
            {
                let connected = calendar_connections::table
                    .filter(calendar_connections::user_id.eq(&user.user_id))
                    .filter(calendar_connections::provider.eq(provider))
                    .count()
                    .get_result::<i64>(conn)?;
                if connected > 0 {
                    return Err(ApiError::conflict(
                        "Disconnect the account before deleting its calendar",
                    ));
                }
            }
            diesel::update(
                events::table
                    .filter(events::calendar_id.eq(id))
                    .filter(events::user_id.eq(&user.user_id))
                    .filter(events::deleted_at.is_null()),
            )
            .set((events::deleted_at.eq(Some(now)), events::updated_at.eq(now)))
            .execute(conn)?;
            diesel::delete(calendars::table.filter(calendars::id.eq(id))).execute(conn)?;
            Ok(())
        })
    }
}

fn new_record(
    user: &AuthenticatedUser,
    name: String,
    color: String,
    kind: &str,
    now: NaiveDateTime,
) -> NewCalendarRecord {
    NewCalendarRecord {
        id: Uuid::new_v4().to_string(),
        user_id: user.user_id.clone(),
        name,
        color,
        visible: true,
        read_only: false,
        kind: kind.to_string(),
        is_default: false,
        source: None,
        country: None,
        region: None,
        include_observances: false,
        created_at: now,
        updated_at: now,
    }
}

fn valid_name(name: &str) -> Result<String, ApiError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ApiError::bad_request("A calendar needs a name"));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(ApiError::bad_request("Calendar name is too long"));
    }
    Ok(name.to_string())
}

/// `#rrggbb`, lower-cased.
fn valid_colour(color: &str) -> Result<String, ApiError> {
    let hex = color.strip_prefix('#').unwrap_or("");
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ApiError::bad_request("Colour must be #rrggbb"));
    }
    Ok(color.to_ascii_lowercase())
}

fn colour_or(color: Option<String>, fallback: &str) -> Result<String, ApiError> {
    color
        .as_deref()
        .map(valid_colour)
        .transpose()
        .map(|c| c.unwrap_or_else(|| fallback.into()))
}

/// ISO 3166-1 alpha-2, upper-cased.
fn valid_country(country: &str) -> Result<String, ApiError> {
    let country = country.trim().to_ascii_uppercase();
    if country.len() != 2 || !country.chars().all(|c| c.is_ascii_uppercase()) {
        return Err(ApiError::bad_request(
            "Country must be a two-letter ISO 3166 code",
        ));
    }
    Ok(country)
}

/// A region code as `date-holidays` names them: letters and digits, upper-cased. Empty is none.
fn valid_region(region: Option<&str>) -> Result<Option<String>, ApiError> {
    let Some(region) = region.map(str::trim).filter(|r| !r.is_empty()) else {
        return Ok(None);
    };
    let region = region.to_ascii_uppercase();
    if region.len() > 10
        || !region
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(ApiError::bad_request("Invalid region"));
    }
    Ok(Some(region))
}

pub fn to_response(r: CalendarRecord) -> CalendarResponse {
    CalendarResponse {
        id: r.id,
        name: r.name,
        color: r.color,
        visible: r.visible,
        read_only: r.read_only,
        kind: r.kind,
        is_default: r.is_default,
        source: r.source,
        country: r.country,
        region: r.region,
        include_observances: r.include_observances,
        created_at: r.created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        updated_at: r.updated_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel_migrations::MigrationHarness;

    fn service() -> (CalendarsService, DbPool) {
        // One connection, so the `:memory:` database persists across calls.
        let pool = Pool::builder()
            .max_size(1)
            .build(ConnectionManager::<SqliteConnection>::new(":memory:"))
            .expect("pool");
        pool.get()
            .unwrap()
            .run_pending_migrations(crate::MIGRATIONS)
            .expect("migrations");
        (CalendarsService::new(pool.clone()), pool)
    }

    fn user(id: &str) -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: id.into(),
            email: format!("{id}@example.com"),
            token: String::new(),
            is_admin: false,
        }
    }

    fn local(svc: &CalendarsService, who: &AuthenticatedUser, name: &str) -> CalendarResponse {
        svc.create(
            who,
            CreateCalendarRequest {
                name: Some(name.into()),
                ..Default::default()
            },
        )
        .expect("create calendar")
    }

    fn holidays(
        svc: &CalendarsService,
        who: &AuthenticatedUser,
        country: &str,
    ) -> Result<CalendarResponse, ApiError> {
        svc.create(
            who,
            CreateCalendarRequest {
                kind: Some(HOLIDAYS.into()),
                country: Some(country.into()),
                name: Some("United States".into()),
                ..Default::default()
            },
        )
    }

    #[test]
    fn listing_makes_one_default_calendar() {
        let (svc, _) = service();
        let alice = user("alice");
        let first = svc.list(&alice).unwrap().calendars;
        let again = svc.list(&alice).unwrap().calendars;
        assert_eq!(first.len(), 1);
        assert!(first[0].is_default);
        assert_eq!(first[0].kind, LOCAL);
        assert_eq!(again.len(), 1);
        assert_eq!(again[0].id, first[0].id);
    }

    #[test]
    fn lists_the_default_first_and_holidays_last() {
        let (svc, _) = service();
        let alice = user("alice");
        holidays(&svc, &alice, "us").unwrap();
        local(&svc, &alice, "Work");
        let kinds: Vec<_> = svc
            .list(&alice)
            .unwrap()
            .calendars
            .into_iter()
            .map(|c| (c.name, c.is_default))
            .collect();
        assert_eq!(
            kinds,
            vec![
                ("Calendar".into(), true),
                ("Work".into(), false),
                ("United States".into(), false)
            ]
        );
    }

    #[test]
    fn a_local_calendar_needs_a_name_and_a_valid_colour() {
        let (svc, _) = service();
        let alice = user("alice");
        let blank = svc.create(
            &alice,
            CreateCalendarRequest {
                name: Some("  ".into()),
                ..Default::default()
            },
        );
        assert_eq!(blank.unwrap_err().status, 400);
        let bad_colour = svc.create(
            &alice,
            CreateCalendarRequest {
                name: Some("Work".into()),
                color: Some("red".into()),
                ..Default::default()
            },
        );
        assert_eq!(bad_colour.unwrap_err().status, 400);
        let made = svc
            .create(
                &alice,
                CreateCalendarRequest {
                    name: Some(" Work ".into()),
                    color: Some("#AABBCC".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(made.name, "Work");
        assert_eq!(made.color, "#aabbcc");
        assert!(!made.read_only);
    }

    #[test]
    fn a_holiday_calendar_is_read_only_and_one_per_country() {
        let (svc, _) = service();
        let alice = user("alice");
        let us = holidays(&svc, &alice, "us").unwrap();
        assert!(us.read_only);
        assert_eq!(us.kind, HOLIDAYS);
        assert_eq!(us.country.as_deref(), Some("US"));
        assert!(
            !us.include_observances,
            "observances are off unless asked for"
        );
        assert_eq!(holidays(&svc, &alice, "US").unwrap_err().status, 409);
        assert_eq!(holidays(&svc, &alice, "USA").unwrap_err().status, 400);
        // Another user picks their own countries.
        assert!(holidays(&svc, &user("bob"), "US").is_ok());
    }

    #[test]
    fn a_connection_calendar_cant_be_made_by_hand() {
        let (svc, _) = service();
        let made = svc.create(
            &user("alice"),
            CreateCalendarRequest {
                kind: Some(CONNECTION.into()),
                ..Default::default()
            },
        );
        assert_eq!(made.unwrap_err().status, 400);
    }

    #[test]
    fn updates_settings_even_on_a_read_only_calendar() {
        let (svc, _) = service();
        let alice = user("alice");
        let us = holidays(&svc, &alice, "US").unwrap();
        let changed = svc
            .update(
                &alice,
                &us.id,
                UpdateCalendarRequest {
                    visible: Some(false),
                    color: Some("#112233".into()),
                    region: Some("ca".into()),
                    include_observances: Some(true),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(!changed.visible);
        assert_eq!(changed.color, "#112233");
        assert_eq!(changed.region.as_deref(), Some("CA"));
        assert!(changed.include_observances);
        let cleared = svc
            .update(
                &alice,
                &us.id,
                UpdateCalendarRequest {
                    region: Some(String::new()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(cleared.region, None);
    }

    #[test]
    fn only_a_holiday_calendar_has_a_region() {
        let (svc, _) = service();
        let alice = user("alice");
        let work = local(&svc, &alice, "Work");
        let changed = svc.update(
            &alice,
            &work.id,
            UpdateCalendarRequest {
                region: Some("CA".into()),
                ..Default::default()
            },
        );
        assert_eq!(changed.unwrap_err().status, 400);
    }

    #[test]
    fn another_users_calendar_is_not_found() {
        let (svc, _) = service();
        let work = local(&svc, &user("alice"), "Work");
        let bob = user("bob");
        let hide = UpdateCalendarRequest {
            visible: Some(false),
            ..Default::default()
        };
        assert_eq!(svc.update(&bob, &work.id, hide).unwrap_err().status, 404);
        assert_eq!(svc.delete(&bob, &work.id).unwrap_err().status, 404);
    }

    #[test]
    fn the_default_calendar_cant_be_deleted() {
        let (svc, _) = service();
        let alice = user("alice");
        let default = svc.list(&alice).unwrap().calendars.remove(0);
        assert_eq!(svc.delete(&alice, &default.id).unwrap_err().status, 400);
    }

    #[test]
    fn a_connected_providers_calendar_cant_be_deleted() {
        let (svc, pool) = service();
        let alice = user("alice");
        let now = Utc::now().naive_utc();
        let mut conn = pool.get().unwrap();
        let google = store::provider_calendar(&mut conn, "alice", "google", now).unwrap();
        diesel::sql_query(
            "INSERT INTO calendar_connections (id, user_id, provider, access_token, created_at, updated_at) \
             VALUES ('c1', 'alice', 'google', 't', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        )
        .execute(&mut conn)
        .unwrap();
        drop(conn);
        assert_eq!(svc.delete(&alice, &google.id).unwrap_err().status, 409);

        diesel::sql_query("DELETE FROM calendar_connections")
            .execute(&mut pool.get().unwrap())
            .unwrap();
        assert!(svc.delete(&alice, &google.id).is_ok());
    }

    #[test]
    fn deleting_a_calendar_deletes_its_events_and_no_others() {
        let (svc, pool) = service();
        let alice = user("alice");
        let work = local(&svc, &alice, "Work");
        let default = svc.list(&alice).unwrap().calendars.remove(0);
        let mut conn = pool.get().unwrap();
        for (id, calendar) in [("in-work", &work.id), ("in-default", &default.id)] {
            diesel::sql_query(format!(
                "INSERT INTO events (id, user_id, title, start_time, end_time, calendar_id) \
                 VALUES ('{id}', 'alice', 't', '2026-10-01 09:00:00', '2026-10-01 10:00:00', '{calendar}')"
            ))
            .execute(&mut conn)
            .unwrap();
        }
        drop(conn);

        svc.delete(&alice, &work.id).unwrap();

        let mut conn = pool.get().unwrap();
        let live: Vec<String> = events::table
            .filter(events::deleted_at.is_null())
            .select(events::id)
            .load(&mut conn)
            .unwrap();
        assert_eq!(live, vec!["in-default".to_string()]);
        let gone: i64 = calendars::table
            .filter(calendars::id.eq(&work.id))
            .count()
            .get_result(&mut conn)
            .unwrap();
        assert_eq!(gone, 0);
    }
}
