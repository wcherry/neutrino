use crate::calendar::events::{
    attendees::AttendeesRepository,
    dto::{
        CreateEventRequest, EventChangesQuery, EventChangesResponse, EventResponse,
        ListEventsQuery, ListEventsResponse, SplitEventRequest, UpdateEventRequest,
    },
    model::{EventRecord, NewEventRecord, UpdateEventRecord},
    repository::EventsRepository,
    series::{self, Shape},
};
use crate::schema::events;
use crate::shared::{ApiError, AuthenticatedUser};
use chrono::{NaiveDateTime, Utc};
use diesel::prelude::*;
use std::sync::Arc;
use uuid::Uuid;

/// How long a deleted event is kept for the changes feed before it is purged. A client whose
/// cursor is older than this is told to reload from scratch.
pub const DELETED_RETENTION_DAYS: i64 = 90;

pub struct EventsService {
    repo: Arc<EventsRepository>,
    attendees_repo: Arc<AttendeesRepository>,
}

impl EventsService {
    pub fn new(repo: Arc<EventsRepository>, attendees_repo: Arc<AttendeesRepository>) -> Self {
        EventsService {
            repo,
            attendees_repo,
        }
    }

    pub fn list_events(
        &self,
        user: &AuthenticatedUser,
        query: ListEventsQuery,
    ) -> Result<ListEventsResponse, ApiError> {
        let from = query.from.as_deref().map(parse_dt).transpose()?;
        let to = query.to.as_deref().map(parse_dt).transpose()?;
        let mut records = self.repo.find_by_user(&user.user_id, from, to)?;
        if query.exceptions {
            let series: Vec<String> = records
                .iter()
                .filter(|r| r.is_recurring())
                .map(|r| r.id.clone())
                .collect();
            records.extend(self.repo.find_exceptions_of(&series)?);
        }
        let events = records.into_iter().map(|r| self.response(r)).collect();
        Ok(ListEventsResponse { events })
    }

    fn response(&self, record: EventRecord) -> EventResponse {
        let attendees = self
            .attendees_repo
            .find_by_event(&record.id)
            .unwrap_or_default();
        event_to_response(record, attendees)
    }

    pub fn create_event(
        &self,
        user: &AuthenticatedUser,
        req: CreateEventRequest,
    ) -> Result<EventResponse, ApiError> {
        let now = Utc::now().naive_utc();
        let id = Uuid::new_v4().to_string();
        let record = NewEventRecord {
            id: id.clone(),
            user_id: user.user_id.clone(),
            title: req.title,
            description: req.description,
            start_time: parse_dt(&req.start_time)?,
            end_time: parse_dt(&req.end_time)?,
            all_day: req.all_day,
            location: req.location,
            recurrence_rule: req.recurrence_rule,
            external_id: None,
            source: "local".to_string(),
            created_at: now,
            updated_at: now,
            timezone: req.timezone,
            recurring_event_id: None,
            original_start_time: None,
            cancelled: false,
        };
        let saved = self.repo.insert(record)?;
        self.attendees_repo.replace_for_event(&id, &req.attendees)?;
        let attendees = self.attendees_repo.find_by_event(&id).unwrap_or_default();
        Ok(event_to_response(saved, attendees))
    }

    pub fn get_event(
        &self,
        user: &AuthenticatedUser,
        event_id: &str,
    ) -> Result<EventResponse, ApiError> {
        let record = self.repo.find_by_id(event_id, &user.user_id)?;
        Ok(self.response(record))
    }

    /// Edits an event. For a series that is "all events": its exceptions are brought along with
    /// the change (`series::reconcile`). An exception is edited as itself, and can't be given a
    /// rule of its own.
    pub fn update_event(
        &self,
        user: &AuthenticatedUser,
        event_id: &str,
        req: UpdateEventRequest,
    ) -> Result<EventResponse, ApiError> {
        let now = Utc::now().naive_utc();
        let changes = changes_from(&req, now)?;
        let updated = self.repo.transaction(|conn| {
            let before = series::find_live(conn, event_id, &user.user_id)?;
            if before.is_exception() && sets_rule(&req) {
                return Err(ApiError::bad_request(
                    "One occurrence of a repeating event can't repeat",
                ));
            }
            let old_attendees = series::attendees_of(conn, event_id)?;
            let after = series::update(conn, event_id, &changes)?;
            if let Some(emails) = &req.attendees {
                series::replace_attendees(conn, event_id, emails)?;
            }
            if !before.is_exception() {
                let new_attendees = series::attendees_of(conn, event_id)?;
                series::reconcile(
                    conn,
                    event_id,
                    &Shape::of(&before, old_attendees),
                    &Shape::of(&after, new_attendees),
                    now,
                )?;
            }
            Ok(after)
        })?;
        Ok(self.response(updated))
    }

    /// Deletes an event, and a series' exceptions with it (soft-deleted, so the changes feed
    /// reports them; the attendees go when the rows are purged).
    ///
    /// With `from_occurrence`, a series instead ends before that occurrence and loses the
    /// exceptions from there on: "this and following". At or before its first occurrence that
    /// is the whole series. An exception is cancelled rather than deleted, since deleting it
    /// would bring back the occurrence it replaced.
    pub fn delete_event(&self, user: &AuthenticatedUser, event_id: &str) -> Result<(), ApiError> {
        self.delete_event_from(user, event_id, None)
    }

    pub fn delete_event_from(
        &self,
        user: &AuthenticatedUser,
        event_id: &str,
        from_occurrence: Option<&str>,
    ) -> Result<(), ApiError> {
        let from = from_occurrence.map(parse_dt).transpose()?;
        let now = Utc::now().naive_utc();
        self.repo.transaction(|conn| {
            let record = series::find_live(conn, event_id, &user.user_id)?;
            if record.is_exception() {
                let cancel = UpdateEventRecord {
                    cancelled: Some(true),
                    updated_at: now,
                    ..Default::default()
                };
                series::update(conn, event_id, &cancel)?;
                return Ok(());
            }
            if let (Some(from), Some(rule)) = (from, record.recurrence_rule.as_deref()) {
                if !rule.is_empty() && from > record.start_time {
                    let ended = UpdateEventRecord {
                        recurrence_rule: Some(Some(series::ending_before(
                            rule,
                            from,
                            record.all_day,
                            series::zone(record.timezone.as_deref()),
                        ))),
                        updated_at: now,
                        ..Default::default()
                    };
                    series::update(conn, event_id, &ended)?;
                    return series::delete_exceptions(
                        conn,
                        event_id,
                        Some(from - series::MATCH_WINDOW),
                        now,
                    );
                }
            }
            let deleted = UpdateEventRecord {
                deleted_at: Some(Some(now)),
                updated_at: now,
                ..Default::default()
            };
            series::update(conn, event_id, &deleted)?;
            series::delete_exceptions(conn, event_id, None, now)
        })
    }

    /// "This event": edits the occurrence of `series_id` that started at `original_start`,
    /// making its exception if it has none. Editing a cancelled occurrence brings it back.
    pub fn edit_occurrence(
        &self,
        user: &AuthenticatedUser,
        series_id: &str,
        original_start: &str,
        req: UpdateEventRequest,
    ) -> Result<EventResponse, ApiError> {
        if sets_rule(&req) {
            return Err(ApiError::bad_request(
                "One occurrence of a repeating event can't repeat",
            ));
        }
        let original = parse_dt(original_start)?;
        let now = Utc::now().naive_utc();
        let mut changes = changes_from(&req, now)?;
        changes.recurrence_rule = None;
        changes.cancelled = Some(false);
        let updated = self.repo.transaction(|conn| {
            let series = self.live_series(conn, series_id, &user.user_id)?;
            let exception = series::exception_for(conn, &series, original, now)?;
            let updated = series::update(conn, &exception.id, &changes)?;
            if let Some(emails) = &req.attendees {
                series::replace_attendees(conn, &exception.id, emails)?;
            }
            Ok(updated)
        })?;
        Ok(self.response(updated))
    }

    /// "Delete this event": cancels the occurrence of `series_id` that started at
    /// `original_start`.
    pub fn cancel_occurrence(
        &self,
        user: &AuthenticatedUser,
        series_id: &str,
        original_start: &str,
    ) -> Result<(), ApiError> {
        let original = parse_dt(original_start)?;
        let now = Utc::now().naive_utc();
        self.repo.transaction(|conn| {
            let series = self.live_series(conn, series_id, &user.user_id)?;
            let exception = series::exception_for(conn, &series, original, now)?;
            let cancel = UpdateEventRecord {
                cancelled: Some(true),
                updated_at: now,
                ..Default::default()
            };
            series::update(conn, &exception.id, &cancel)?;
            Ok(())
        })
    }

    /// "This and following": ends the series before the occurrence that started at
    /// `req.original_start_time` and starts a new one there with the changes, taking the
    /// exceptions from there on with it. Returns the new series, or, at or before the first
    /// occurrence, the whole series edited.
    pub fn split_event(
        &self,
        user: &AuthenticatedUser,
        series_id: &str,
        req: SplitEventRequest,
    ) -> Result<EventResponse, ApiError> {
        let at = parse_dt(&req.original_start_time)?;
        let first = self.repo.find_by_id(series_id, &user.user_id)?;
        if at <= first.start_time {
            return self.update_event(user, series_id, req.changes);
        }
        let now = Utc::now().naive_utc();
        let changes = req.changes;
        let created = self.repo.transaction(|conn| {
            let series = self.live_series(conn, series_id, &user.user_id)?;
            let rule = series.recurrence_rule.clone().unwrap_or_default();
            let length = series.end_time - series.start_time;
            let start = changes
                .start_time
                .as_deref()
                .map(parse_dt)
                .transpose()?
                .unwrap_or(at);
            let end = match changes.end_time.as_deref() {
                Some(end) => parse_dt(end)?,
                None => start + length,
            };
            let series_attendees = series::attendees_of(conn, series_id)?;

            let new_id = Uuid::new_v4().to_string();
            let created = series::insert(
                conn,
                NewEventRecord {
                    id: new_id.clone(),
                    user_id: series.user_id.clone(),
                    title: changes
                        .title
                        .clone()
                        .unwrap_or_else(|| series.title.clone()),
                    description: changes
                        .description
                        .clone()
                        .or_else(|| series.description.clone()),
                    start_time: start,
                    end_time: end,
                    all_day: changes.all_day.unwrap_or(series.all_day),
                    location: changes.location.clone().or_else(|| series.location.clone()),
                    recurrence_rule: match changes.recurrence_rule.as_deref() {
                        None => series.recurrence_rule.clone(),
                        Some("") => None,
                        Some(r) => Some(r.to_string()),
                    },
                    external_id: None,
                    source: series.source.clone(),
                    created_at: now,
                    updated_at: now,
                    timezone: changes.timezone.clone().or_else(|| series.timezone.clone()),
                    recurring_event_id: None,
                    original_start_time: None,
                    cancelled: false,
                },
            )?;
            let attendees = changes
                .attendees
                .clone()
                .unwrap_or_else(|| series_attendees.clone());
            series::replace_attendees(conn, &new_id, &attendees)?;

            let ended = UpdateEventRecord {
                recurrence_rule: Some(Some(series::ending_before(
                    &rule,
                    at,
                    series.all_day,
                    series::zone(series.timezone.as_deref()),
                ))),
                updated_at: now,
                ..Default::default()
            };
            series::update(conn, series_id, &ended)?;

            diesel::update(events::table)
                .filter(events::recurring_event_id.eq(series_id))
                .filter(events::deleted_at.is_null())
                .filter(events::original_start_time.ge(at - series::MATCH_WINDOW))
                .set((
                    events::recurring_event_id.eq(Some(new_id.clone())),
                    events::updated_at.eq(now),
                ))
                .execute(conn)?;
            // The moved exceptions were made against the old series as it was at this
            // occurrence; bring them along with whatever the new series changed.
            let at_occurrence = Shape {
                start: at,
                end: at + length,
                ..Shape::of(&series, series_attendees)
            };
            series::reconcile(
                conn,
                &new_id,
                &at_occurrence,
                &Shape::of(&created, attendees),
                now,
            )?;
            Ok(created)
        })?;
        Ok(self.response(created))
    }

    /// A series an occurrence can be taken from: live, repeating, and not itself an exception.
    fn live_series(
        &self,
        conn: &mut diesel::SqliteConnection,
        series_id: &str,
        user_id: &str,
    ) -> Result<EventRecord, ApiError> {
        let series = series::find_live(conn, series_id, user_id)?;
        if series.is_exception() || !series.is_recurring() {
            return Err(ApiError::bad_request("Not a repeating event"));
        }
        Ok(series)
    }

    /// What changed since `query.since`. The new cursor is taken before the query runs, so a
    /// change committed while it runs is reported next time rather than lost.
    pub fn changes(
        &self,
        user: &AuthenticatedUser,
        query: EventChangesQuery,
    ) -> Result<EventChangesResponse, ApiError> {
        let now = Utc::now().naive_utc();
        let cursor = now.format("%Y-%m-%dT%H:%M:%SZ").to_string();
        let empty = |full_resync_required| EventChangesResponse {
            events: vec![],
            deleted_ids: vec![],
            cursor: cursor.clone(),
            full_resync_required,
        };
        let Some(since) = query.since.as_deref().map(parse_dt).transpose()? else {
            return Ok(empty(false));
        };
        if since < now - chrono::Duration::days(DELETED_RETENTION_DAYS) {
            return Ok(empty(true));
        }
        let mut events = vec![];
        let mut deleted_ids = vec![];
        for record in self.repo.find_changed_since(&user.user_id, since)? {
            if record.deleted_at.is_some() {
                deleted_ids.push(record.id);
            } else if query.exceptions || !record.is_exception() {
                events.push(self.response(record));
            }
        }
        Ok(EventChangesResponse {
            events,
            deleted_ids,
            cursor,
            full_resync_required: false,
        })
    }

    /// Removes events deleted more than `DELETED_RETENTION_DAYS` ago.
    pub fn purge_deleted(&self) -> Result<usize, ApiError> {
        self.repo.purge_deleted_before(
            Utc::now().naive_utc() - chrono::Duration::days(DELETED_RETENTION_DAYS),
        )
    }
}

/// The row changes an update request asks for. An empty string is stored as the value, not as
/// NULL: clients read an empty location, note or rule as none.
fn changes_from(
    req: &UpdateEventRequest,
    now: NaiveDateTime,
) -> Result<UpdateEventRecord, ApiError> {
    Ok(UpdateEventRecord {
        title: req.title.clone(),
        description: req.description.clone().map(Some),
        start_time: req.start_time.as_deref().map(parse_dt).transpose()?,
        end_time: req.end_time.as_deref().map(parse_dt).transpose()?,
        all_day: req.all_day,
        location: req.location.clone().map(Some),
        recurrence_rule: req.recurrence_rule.clone().map(Some),
        updated_at: now,
        timezone: req.timezone.clone().map(Some),
        ..Default::default()
    })
}

fn sets_rule(req: &UpdateEventRequest) -> bool {
    req.recurrence_rule
        .as_deref()
        .is_some_and(|r| !r.is_empty())
}

fn parse_dt(s: &str) -> Result<NaiveDateTime, ApiError> {
    s.parse::<chrono::DateTime<chrono::Utc>>()
        .map(|dt| dt.naive_utc())
        .or_else(|_| s.parse::<NaiveDateTime>())
        .map_err(|_| ApiError::bad_request(&format!("Invalid datetime: {}", s)))
}

fn event_to_response(r: EventRecord, attendees: Vec<String>) -> EventResponse {
    EventResponse {
        id: r.id,
        title: r.title,
        description: r.description,
        start_time: r.start_time.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        end_time: r.end_time.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        all_day: r.all_day,
        location: r.location,
        recurrence_rule: r.recurrence_rule,
        attendees,
        source: r.source,
        created_at: r.created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        updated_at: r.updated_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        timezone: r.timezone,
        recurring_event_id: r.recurring_event_id,
        original_start_time: r
            .original_start_time
            .map(|t| t.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        cancelled: r.cancelled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel::SqliteConnection;
    use diesel_migrations::MigrationHarness;

    fn service() -> (EventsService, Arc<EventsRepository>) {
        // One connection, so the `:memory:` database persists across calls.
        let pool = Pool::builder()
            .max_size(1)
            .build(ConnectionManager::<SqliteConnection>::new(":memory:"))
            .expect("pool");
        pool.get()
            .unwrap()
            .run_pending_migrations(crate::MIGRATIONS)
            .expect("migrations");
        let repo = Arc::new(EventsRepository::new(pool.clone()));
        let attendees = Arc::new(AttendeesRepository::new(pool));
        (EventsService::new(repo.clone(), attendees), repo)
    }

    fn user(id: &str) -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: id.into(),
            email: format!("{id}@example.com"),
            token: String::new(),
            is_admin: false,
        }
    }

    fn create(svc: &EventsService, who: &AuthenticatedUser, title: &str) -> String {
        svc.create_event(
            who,
            CreateEventRequest {
                title: title.into(),
                description: None,
                start_time: "2026-09-30T18:00:00Z".into(),
                end_time: "2026-09-30T19:00:00Z".into(),
                all_day: false,
                location: None,
                recurrence_rule: None,
                attendees: vec!["ada@example.com".into()],
                timezone: None,
            },
        )
        .expect("create")
        .id
    }

    fn since(cursor: &str) -> EventChangesQuery {
        EventChangesQuery {
            since: Some(cursor.into()),
            ..Default::default()
        }
    }

    fn a_minute_ago() -> String {
        (Utc::now() - chrono::Duration::minutes(1))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string()
    }

    #[test]
    fn a_deleted_event_is_gone_from_every_read_and_cannot_be_deleted_or_edited_again() {
        let (svc, _) = service();
        let ada = user("ada");
        let id = create(&svc, &ada, "Review");

        svc.delete_event(&ada, &id).unwrap();

        assert!(svc.get_event(&ada, &id).is_err());
        let listed = svc
            .list_events(
                &ada,
                ListEventsQuery {
                    from: Some("2026-09-01T00:00:00Z".into()),
                    to: Some("2026-10-31T00:00:00Z".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(listed.events.is_empty());
        assert!(
            svc.delete_event(&ada, &id).is_err(),
            "a second delete is a 404"
        );
        let edit = UpdateEventRequest {
            title: Some("Back?".into()),
            ..Default::default()
        };
        assert!(
            svc.update_event(&ada, &id, edit).is_err(),
            "an edit does not revive it"
        );
    }

    #[test]
    fn with_no_cursor_the_feed_hands_out_a_cursor_and_nothing_else() {
        let (svc, _) = service();
        let ada = user("ada");
        create(&svc, &ada, "Review");

        let first = svc.changes(&ada, EventChangesQuery::default()).unwrap();
        assert!(first.events.is_empty() && first.deleted_ids.is_empty());
        assert!(!first.full_resync_required);
        assert!(first.cursor.ends_with('Z'));
    }

    #[test]
    fn the_feed_reports_changes_and_deletions_since_the_cursor_for_this_user_only() {
        let (svc, _) = service();
        let (ada, bob) = (user("ada"), user("bob"));
        let kept = create(&svc, &ada, "Kept");
        let gone = create(&svc, &ada, "Gone");
        create(&svc, &bob, "Bob's");
        svc.delete_event(&ada, &gone).unwrap();

        let feed = svc.changes(&ada, since(&a_minute_ago())).unwrap();
        assert_eq!(
            feed.events
                .iter()
                .map(|e| e.id.as_str())
                .collect::<Vec<_>>(),
            vec![kept.as_str()]
        );
        assert_eq!(feed.events[0].attendees, vec!["ada@example.com"]);
        assert_eq!(feed.deleted_ids, vec![gone]);
        assert!(!feed.full_resync_required);
    }

    /// The cursor is taken before the read and compared inclusively, so a change in the same
    /// second as the read is reported (again) next time rather than missed.
    #[test]
    fn a_change_right_after_a_read_is_in_the_next_read() {
        let (svc, _) = service();
        let ada = user("ada");
        let cursor = svc
            .changes(&ada, EventChangesQuery::default())
            .unwrap()
            .cursor;
        let id = create(&svc, &ada, "New");

        let feed = svc.changes(&ada, since(&cursor)).unwrap();
        assert!(feed.events.iter().any(|e| e.id == id));
    }

    #[test]
    fn a_cursor_older_than_the_tombstones_asks_for_a_full_resync() {
        let (svc, _) = service();
        let ada = user("ada");
        create(&svc, &ada, "Review");
        let stale = (Utc::now() - chrono::Duration::days(DELETED_RETENTION_DAYS + 1))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string();

        let feed = svc.changes(&ada, since(&stale)).unwrap();
        assert!(feed.full_resync_required);
        assert!(feed.events.is_empty() && feed.deleted_ids.is_empty());
    }

    #[test]
    fn a_bad_cursor_is_a_bad_request() {
        let (svc, _) = service();
        assert!(svc.changes(&user("ada"), since("yesterday")).is_err());
    }

    #[test]
    fn the_purge_removes_only_tombstones_past_retention() {
        let (svc, repo) = service();
        let ada = user("ada");
        let old = create(&svc, &ada, "Old");
        let recent = create(&svc, &ada, "Recent");
        let live = create(&svc, &ada, "Live");
        let long_ago = Utc::now().naive_utc() - chrono::Duration::days(DELETED_RETENTION_DAYS + 1);
        repo.delete(&old, "ada", long_ago).unwrap();
        svc.delete_event(&ada, &recent).unwrap();

        assert_eq!(svc.purge_deleted().unwrap(), 1);
        let feed = svc.changes(&ada, since(&a_minute_ago())).unwrap();
        assert_eq!(
            feed.deleted_ids,
            vec![recent],
            "the recent tombstone is still reported"
        );
        assert!(svc.get_event(&ada, &live).is_ok());
    }

    #[test]
    fn a_provider_sync_revives_an_event_deleted_here() {
        let (svc, repo) = service();
        let ada = user("ada");
        let now = Utc::now().naive_utc();
        let record = |title: &str| NewEventRecord {
            id: "g1".into(),
            user_id: "ada".into(),
            title: title.into(),
            description: None,
            start_time: now,
            end_time: now,
            all_day: false,
            location: None,
            recurrence_rule: None,
            external_id: Some("ext-1".into()),
            source: "google".into(),
            created_at: now,
            updated_at: now,
            timezone: None,
            recurring_event_id: None,
            original_start_time: None,
            cancelled: false,
        };
        repo.upsert_from_sync("ada", "google", record("Synced"))
            .unwrap();
        svc.delete_event(&ada, "g1").unwrap();

        repo.upsert_from_sync("ada", "google", record("Synced again"))
            .unwrap();
        assert_eq!(svc.get_event(&ada, "g1").unwrap().title, "Synced again");
    }

    // ── Recurrence exceptions ────────────────────────────────────────────────

    /// A weekly 09:00 UTC standup on Mondays, from Monday 5 October 2026.
    fn standup(svc: &EventsService, who: &AuthenticatedUser, rule: &str) -> String {
        svc.create_event(
            who,
            CreateEventRequest {
                title: "Standup".into(),
                description: None,
                start_time: "2026-10-05T09:00:00Z".into(),
                end_time: "2026-10-05T09:30:00Z".into(),
                all_day: false,
                location: Some("Room 1".into()),
                recurrence_rule: Some(rule.into()),
                attendees: vec!["ada@example.com".into()],
                timezone: None,
            },
        )
        .expect("create")
        .id
    }

    fn october(exceptions: bool) -> ListEventsQuery {
        ListEventsQuery {
            from: Some("2026-10-01T00:00:00Z".into()),
            to: Some("2026-10-31T23:59:59Z".into()),
            exceptions,
        }
    }

    fn retitle(title: &str) -> UpdateEventRequest {
        UpdateEventRequest {
            title: Some(title.into()),
            ..Default::default()
        }
    }

    fn exceptions_of(svc: &EventsService, who: &AuthenticatedUser) -> Vec<EventResponse> {
        svc.list_events(who, october(true))
            .unwrap()
            .events
            .into_iter()
            .filter(|e| e.recurring_event_id.is_some())
            .collect()
    }

    #[test]
    fn editing_one_occurrence_makes_an_exception_listed_only_to_clients_that_ask() {
        let (svc, _) = service();
        let ada = user("ada");
        let series = standup(&svc, &ada, "FREQ=WEEKLY");

        let edited = svc
            .edit_occurrence(&ada, &series, "2026-10-12T09:00:00Z", retitle("Planning"))
            .unwrap();

        assert_eq!(edited.title, "Planning");
        assert_eq!(edited.recurring_event_id.as_deref(), Some(series.as_str()));
        assert_eq!(
            edited.original_start_time.as_deref(),
            Some("2026-10-12T09:00:00Z")
        );
        assert_eq!(edited.start_time, "2026-10-12T09:00:00Z");
        assert_eq!(edited.end_time, "2026-10-12T09:30:00Z");
        assert_eq!(
            edited.location.as_deref(),
            Some("Room 1"),
            "the rest comes from the series"
        );
        assert_eq!(edited.attendees, vec!["ada@example.com"]);
        assert_eq!(edited.recurrence_rule, None);
        assert!(!edited.cancelled);

        let plain = svc.list_events(&ada, october(false)).unwrap().events;
        assert_eq!(
            plain.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            vec![series.as_str()]
        );
        let with = svc.list_events(&ada, october(true)).unwrap().events;
        assert_eq!(with.len(), 2);

        // A second edit of the same occurrence changes the same exception.
        let again = svc
            .edit_occurrence(&ada, &series, "2026-10-12T09:00:00Z", retitle("Planning 2"))
            .unwrap();
        assert_eq!(again.id, edited.id);
    }

    #[test]
    fn deleting_one_occurrence_cancels_it_and_deleting_an_exception_cancels_rather_than_removes() {
        let (svc, _) = service();
        let ada = user("ada");
        let series = standup(&svc, &ada, "FREQ=WEEKLY");

        svc.cancel_occurrence(&ada, &series, "2026-10-12T09:00:00Z")
            .unwrap();
        let moved = svc
            .edit_occurrence(&ada, &series, "2026-10-19T09:00:00Z", retitle("Moved"))
            .unwrap();
        svc.delete_event(&ada, &moved.id).unwrap();

        let exceptions = exceptions_of(&svc, &ada);
        assert_eq!(exceptions.len(), 2);
        assert!(exceptions.iter().all(|e| e.cancelled));

        // Editing a cancelled occurrence brings it back.
        let back = svc
            .edit_occurrence(&ada, &series, "2026-10-12T09:00:00Z", retitle("Back"))
            .unwrap();
        assert!(!back.cancelled);
    }

    #[test]
    fn an_occurrence_can_be_taken_only_from_a_repeating_event_and_cannot_repeat() {
        let (svc, _) = service();
        let ada = user("ada");
        let one_off = create(&svc, &ada, "Once");
        let series = standup(&svc, &ada, "FREQ=WEEKLY");

        assert!(svc
            .edit_occurrence(&ada, &one_off, "2026-09-30T18:00:00Z", retitle("x"))
            .is_err());
        let repeating = UpdateEventRequest {
            recurrence_rule: Some("FREQ=DAILY".into()),
            ..Default::default()
        };
        assert!(svc
            .edit_occurrence(&ada, &series, "2026-10-12T09:00:00Z", repeating.clone())
            .is_err());
        let exception = svc
            .edit_occurrence(&ada, &series, "2026-10-12T09:00:00Z", retitle("x"))
            .unwrap();
        assert!(svc.update_event(&ada, &exception.id, repeating).is_err());
        assert!(
            svc.edit_occurrence(&user("bob"), &series, "2026-10-12T09:00:00Z", retitle("x"))
                .is_err(),
            "someone else's series is not found"
        );
    }

    #[test]
    fn this_and_following_ends_the_series_and_starts_another_with_the_later_exceptions() {
        let (svc, _) = service();
        let ada = user("ada");
        let series = standup(&svc, &ada, "FREQ=WEEKLY;COUNT=8");
        let before = svc
            .edit_occurrence(&ada, &series, "2026-10-12T09:00:00Z", retitle("Early"))
            .unwrap();
        let after = svc
            .edit_occurrence(&ada, &series, "2026-10-26T09:00:00Z", retitle("Late"))
            .unwrap();

        let split = svc
            .split_event(
                &ada,
                &series,
                SplitEventRequest {
                    original_start_time: "2026-10-19T09:00:00Z".into(),
                    changes: UpdateEventRequest {
                        start_time: Some("2026-10-19T10:00:00Z".into()),
                        end_time: Some("2026-10-19T10:30:00Z".into()),
                        location: Some("Room 2".into()),
                        recurrence_rule: Some("FREQ=WEEKLY;COUNT=6".into()),
                        ..Default::default()
                    },
                },
            )
            .unwrap();

        let old = svc.get_event(&ada, &series).unwrap();
        assert_eq!(
            old.recurrence_rule.as_deref(),
            Some("FREQ=WEEKLY;UNTIL=20261018T235959Z")
        );
        assert_eq!(split.start_time, "2026-10-19T10:00:00Z");
        assert_eq!(
            split.recurrence_rule.as_deref(),
            Some("FREQ=WEEKLY;COUNT=6")
        );
        assert_eq!(split.title, "Standup");
        assert_eq!(split.location.as_deref(), Some("Room 2"));
        assert_eq!(split.attendees, vec!["ada@example.com"]);

        let early = svc.get_event(&ada, &before.id).unwrap();
        assert_eq!(
            early.recurring_event_id.as_deref(),
            Some(series.as_str()),
            "stays behind"
        );
        let late = svc.get_event(&ada, &after.id).unwrap();
        assert_eq!(
            late.recurring_event_id.as_deref(),
            Some(split.id.as_str()),
            "moves on"
        );
        assert_eq!(
            late.original_start_time.as_deref(),
            Some("2026-10-26T10:00:00Z"),
            "moved with the new series' time"
        );
        assert_eq!(late.start_time, "2026-10-26T10:00:00Z");
        assert_eq!(
            late.location.as_deref(),
            Some("Room 2"),
            "follows the new series"
        );
        assert_eq!(late.title, "Late", "keeps its own change");
    }

    #[test]
    fn this_and_following_from_the_first_occurrence_edits_the_whole_series() {
        let (svc, _) = service();
        let ada = user("ada");
        let series = standup(&svc, &ada, "FREQ=WEEKLY");

        let edited = svc
            .split_event(
                &ada,
                &series,
                SplitEventRequest {
                    original_start_time: "2026-10-05T09:00:00Z".into(),
                    changes: retitle("Renamed"),
                },
            )
            .unwrap();

        assert_eq!(edited.id, series);
        assert_eq!(edited.title, "Renamed");
        assert_eq!(edited.recurrence_rule.as_deref(), Some("FREQ=WEEKLY"));
    }

    #[test]
    fn deleting_this_and_following_ends_the_series_and_drops_the_later_exceptions() {
        let (svc, _) = service();
        let ada = user("ada");
        let series = standup(&svc, &ada, "FREQ=WEEKLY");
        let kept = svc
            .edit_occurrence(&ada, &series, "2026-10-12T09:00:00Z", retitle("Kept"))
            .unwrap();
        svc.edit_occurrence(&ada, &series, "2026-10-26T09:00:00Z", retitle("Gone"))
            .unwrap();

        svc.delete_event_from(&ada, &series, Some("2026-10-19T09:00:00Z"))
            .unwrap();

        let old = svc.get_event(&ada, &series).unwrap();
        assert_eq!(
            old.recurrence_rule.as_deref(),
            Some("FREQ=WEEKLY;UNTIL=20261018T235959Z")
        );
        let left: Vec<_> = exceptions_of(&svc, &ada)
            .into_iter()
            .map(|e| e.id)
            .collect();
        assert_eq!(left, vec![kept.id]);

        // From the first occurrence, it is the whole series.
        svc.delete_event_from(&ada, &series, Some("2026-10-05T09:00:00Z"))
            .unwrap();
        assert!(svc.get_event(&ada, &series).is_err());
    }

    #[test]
    fn deleting_a_series_deletes_its_exceptions_and_the_feed_says_so() {
        let (svc, _) = service();
        let ada = user("ada");
        let series = standup(&svc, &ada, "FREQ=WEEKLY");
        let exception = svc
            .edit_occurrence(&ada, &series, "2026-10-12T09:00:00Z", retitle("x"))
            .unwrap();

        svc.delete_event(&ada, &series).unwrap();

        assert!(svc.get_event(&ada, &exception.id).is_err());
        let feed = svc.changes(&ada, since(&a_minute_ago())).unwrap();
        assert!(feed.deleted_ids.contains(&series) && feed.deleted_ids.contains(&exception.id));
    }

    #[test]
    fn the_feed_reports_exceptions_only_to_clients_that_ask() {
        let (svc, _) = service();
        let ada = user("ada");
        let series = standup(&svc, &ada, "FREQ=WEEKLY");
        let exception = svc
            .edit_occurrence(&ada, &series, "2026-10-12T09:00:00Z", retitle("x"))
            .unwrap();

        let plain = svc.changes(&ada, since(&a_minute_ago())).unwrap();
        assert!(!plain.events.iter().any(|e| e.id == exception.id));
        let asked = svc
            .changes(
                &ada,
                EventChangesQuery {
                    since: Some(a_minute_ago()),
                    exceptions: true,
                },
            )
            .unwrap();
        assert!(asked.events.iter().any(|e| e.id == exception.id));
    }

    #[test]
    fn editing_all_events_carries_the_exceptions_along() {
        let (svc, _) = service();
        let ada = user("ada");
        let series = standup(&svc, &ada, "FREQ=WEEKLY");
        let untouched = svc
            .edit_occurrence(
                &ada,
                &series,
                "2026-10-12T09:00:00Z",
                UpdateEventRequest {
                    description: Some("Agenda".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        let renamed_and_moved = svc
            .edit_occurrence(
                &ada,
                &series,
                "2026-10-19T09:00:00Z",
                UpdateEventRequest {
                    title: Some("Own title".into()),
                    start_time: Some("2026-10-19T15:00:00Z".into()),
                    end_time: Some("2026-10-19T15:30:00Z".into()),
                    ..Default::default()
                },
            )
            .unwrap();

        // An hour later, renamed, and longer.
        svc.update_event(
            &ada,
            &series,
            UpdateEventRequest {
                title: Some("Daily sync".into()),
                start_time: Some("2026-10-05T10:00:00Z".into()),
                end_time: Some("2026-10-05T11:00:00Z".into()),
                ..Default::default()
            },
        )
        .unwrap();

        let a = svc.get_event(&ada, &untouched.id).unwrap();
        assert_eq!(a.title, "Daily sync");
        assert_eq!(a.description.as_deref(), Some("Agenda"));
        assert_eq!(
            a.original_start_time.as_deref(),
            Some("2026-10-12T10:00:00Z")
        );
        assert_eq!(
            (a.start_time.as_str(), a.end_time.as_str()),
            ("2026-10-12T10:00:00Z", "2026-10-12T11:00:00Z")
        );
        let b = svc.get_event(&ada, &renamed_and_moved.id).unwrap();
        assert_eq!(b.title, "Own title");
        assert_eq!(
            b.original_start_time.as_deref(),
            Some("2026-10-19T10:00:00Z")
        );
        assert_eq!(
            b.start_time, "2026-10-19T15:00:00Z",
            "keeps the time it was moved to"
        );

        // A new pattern leaves nothing for them to stand in for.
        svc.update_event(
            &ada,
            &series,
            UpdateEventRequest {
                recurrence_rule: Some("FREQ=DAILY".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(exceptions_of(&svc, &ada).is_empty());
    }

    #[test]
    fn moving_a_series_by_the_gap_between_two_exceptions_moves_both() {
        let (svc, _) = service();
        let ada = user("ada");
        let series = standup(&svc, &ada, "FREQ=WEEKLY");
        svc.cancel_occurrence(&ada, &series, "2026-10-12T09:00:00Z")
            .unwrap();
        svc.cancel_occurrence(&ada, &series, "2026-10-19T09:00:00Z")
            .unwrap();

        svc.update_event(
            &ada,
            &series,
            UpdateEventRequest {
                start_time: Some("2026-10-12T09:00:00Z".into()),
                end_time: Some("2026-10-12T09:30:00Z".into()),
                ..Default::default()
            },
        )
        .unwrap();

        let originals: Vec<_> = exceptions_of(&svc, &ada)
            .into_iter()
            .filter_map(|e| e.original_start_time)
            .collect();
        assert_eq!(
            originals,
            vec!["2026-10-19T09:00:00Z", "2026-10-26T09:00:00Z"]
        );
    }
}
