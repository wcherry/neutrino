use crate::calendar::events::{
    attendees::AttendeesRepository,
    dto::{
        CreateEventRequest, EventChangesQuery, EventChangesResponse, EventResponse,
        ListEventsQuery, ListEventsResponse, UpdateEventRequest,
    },
    model::{NewEventRecord, UpdateEventRecord},
    repository::EventsRepository,
};
use crate::shared::{ApiError, AuthenticatedUser};
use chrono::{NaiveDateTime, Utc};
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
        let records = self.repo.find_by_user(&user.user_id, from, to)?;
        let events = records
            .into_iter()
            .map(|r| {
                let attendees = self.attendees_repo.find_by_event(&r.id).unwrap_or_default();
                event_to_response(r, attendees)
            })
            .collect();
        Ok(ListEventsResponse { events })
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
        let attendees = self
            .attendees_repo
            .find_by_event(event_id)
            .unwrap_or_default();
        Ok(event_to_response(record, attendees))
    }

    pub fn update_event(
        &self,
        user: &AuthenticatedUser,
        event_id: &str,
        req: UpdateEventRequest,
    ) -> Result<EventResponse, ApiError> {
        let changes = UpdateEventRecord {
            title: req.title,
            description: req.description.map(Some),
            start_time: req.start_time.as_deref().map(parse_dt).transpose()?,
            end_time: req.end_time.as_deref().map(parse_dt).transpose()?,
            all_day: req.all_day,
            location: req.location.map(Some),
            recurrence_rule: req.recurrence_rule.map(Some),
            updated_at: Utc::now().naive_utc(),
            timezone: req.timezone.map(Some),
            deleted_at: None,
        };
        let updated = self.repo.update(event_id, &user.user_id, changes)?;
        if let Some(emails) = req.attendees {
            self.attendees_repo.replace_for_event(event_id, &emails)?;
        }
        let attendees = self
            .attendees_repo
            .find_by_event(event_id)
            .unwrap_or_default();
        Ok(event_to_response(updated, attendees))
    }

    /// Soft-deletes. The attendees stay attached to the hidden row and go with it when the row
    /// is purged, by the same cascade that used to remove them at once.
    pub fn delete_event(&self, user: &AuthenticatedUser, event_id: &str) -> Result<(), ApiError> {
        self.repo
            .delete(event_id, &user.user_id, Utc::now().naive_utc())
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
            } else {
                let attendees = self
                    .attendees_repo
                    .find_by_event(&record.id)
                    .unwrap_or_default();
                events.push(event_to_response(record, attendees));
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

fn parse_dt(s: &str) -> Result<NaiveDateTime, ApiError> {
    s.parse::<chrono::DateTime<chrono::Utc>>()
        .map(|dt| dt.naive_utc())
        .or_else(|_| s.parse::<NaiveDateTime>())
        .map_err(|_| ApiError::bad_request(&format!("Invalid datetime: {}", s)))
}

fn event_to_response(
    r: crate::calendar::events::model::EventRecord,
    attendees: Vec<String>,
) -> EventResponse {
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::SqliteConnection;
    use diesel::r2d2::{ConnectionManager, Pool};
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

        let first = svc
            .changes(&ada, EventChangesQuery { since: None })
            .unwrap();
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
            .changes(&ada, EventChangesQuery { since: None })
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
        };
        repo.upsert_from_sync("ada", "google", record("Synced"))
            .unwrap();
        svc.delete_event(&ada, "g1").unwrap();

        repo.upsert_from_sync("ada", "google", record("Synced again"))
            .unwrap();
        assert_eq!(svc.get_event(&ada, "g1").unwrap().title, "Synced again");
    }
}
