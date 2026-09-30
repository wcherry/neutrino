use crate::calendar::recurrence::{self, Completion};
use crate::calendar::reminders::{
    dto::{
        CreateReminderRequest, ListRemindersQuery, ListRemindersResponse,
        ReminderOccurrenceRequest, ReminderOccurrenceResponse, ReminderResponse,
        SkipReminderRequest, SkipReminderResponse, UpdateReminderRequest,
    },
    model::{NewReminderRecord, ReminderRecord, UpdateReminderRecord},
    repository::RemindersRepository,
};
use crate::schema::reminders;
use crate::shared::{ApiError, AuthenticatedUser};
use chrono::{NaiveDateTime, Utc};
use chrono_tz::Tz;
use diesel::prelude::*;
use std::sync::Arc;
use uuid::Uuid;

pub struct RemindersService {
    repo: Arc<RemindersRepository>,
}

impl RemindersService {
    pub fn new(repo: Arc<RemindersRepository>) -> Self {
        RemindersService { repo }
    }

    pub fn list_reminders(
        &self,
        user: &AuthenticatedUser,
        query: ListRemindersQuery,
    ) -> Result<ListRemindersResponse, ApiError> {
        let records = match (query.event_id, query.task_id) {
            (Some(event_id), _) => self.repo.find_by_event(&user.user_id, &event_id)?,
            (None, Some(task_id)) => self.repo.find_by_task(&user.user_id, &task_id)?,
            (None, None) => self.repo.find_by_user(&user.user_id)?,
        };
        let reminders = records.into_iter().map(reminder_to_response).collect();
        Ok(ListRemindersResponse { reminders })
    }

    pub fn create_reminder(
        &self,
        user: &AuthenticatedUser,
        req: CreateReminderRequest,
    ) -> Result<ReminderResponse, ApiError> {
        // One owner at most: the sidebar's standalone Reminders section is
        // everything with neither link, so a reminder claiming both would be
        // listed under an event *and* inside a task and hidden from that list.
        if req.linked_event_id.is_some() && req.linked_task_id.is_some() {
            return Err(ApiError::bad_request(
                "A reminder can link to an event or a task, not both",
            ));
        }
        let now = Utc::now().naive_utc();
        let record = NewReminderRecord {
            id: Uuid::new_v4().to_string(),
            user_id: user.user_id.clone(),
            title: req.title,
            due_time: parse_dt(&req.due_time)?,
            completed: false,
            recurrence_rule: req.recurrence_rule,
            linked_event_id: req.linked_event_id,
            linked_task_id: req.linked_task_id,
            created_at: now,
            updated_at: now,
        };
        let saved = self.repo.insert(record)?;
        Ok(reminder_to_response(saved))
    }

    pub fn get_reminder(
        &self,
        user: &AuthenticatedUser,
        reminder_id: &str,
    ) -> Result<ReminderResponse, ApiError> {
        let record = self.repo.find_by_id(reminder_id, &user.user_id)?;
        Ok(reminder_to_response(record))
    }

    pub fn delete_reminder(
        &self,
        user: &AuthenticatedUser,
        reminder_id: &str,
    ) -> Result<(), ApiError> {
        self.repo.delete(reminder_id, &user.user_id)
    }

    pub fn update_reminder(
        &self,
        user: &AuthenticatedUser,
        reminder_id: &str,
        req: UpdateReminderRequest,
    ) -> Result<ReminderResponse, ApiError> {
        let timezone = match req.timezone.as_deref() {
            Some(name) => Some(
                name.parse::<Tz>()
                    .map_err(|_| ApiError::bad_request(format!("Unknown time zone: {name}")))?,
            ),
            None => None,
        };
        let due_time = req.due_time.as_deref().map(parse_dt).transpose()?;
        let mut changes = UpdateReminderRecord {
            title: req.title,
            due_time,
            completed: req.completed,
            // An empty rule removes it, stored as NULL like a reminder that never had one.
            recurrence_rule: req
                .recurrence_rule
                .clone()
                .map(|r| Some(r).filter(|r| !r.is_empty())),
            // A new due time is a new reminder as far as delivery goes: without this, one that
            // already fired would never fire again at the time it was moved to.
            notified_at: due_time.map(|_| None),
            updated_at: Utc::now().naive_utc(),
        };

        if req.completed == Some(true) {
            let existing = self.repo.find_by_id(reminder_id, &user.user_id)?;
            // Completing one already done is not a second completion; it must not skip ahead.
            if !existing.completed {
                let rule = req
                    .recurrence_rule
                    .or(existing.recurrence_rule)
                    .unwrap_or_default();
                let due = due_time.unwrap_or(existing.due_time).and_utc();
                if let Some(Completion::Advance {
                    due: next,
                    rule: next_rule,
                }) = recurrence::complete(due, &rule, timezone.unwrap_or(Tz::UTC))
                {
                    changes.due_time = Some(next.naive_utc());
                    changes.completed = Some(false);
                    changes.notified_at = Some(None);
                    changes.recurrence_rule = Some(Some(next_rule));
                }
            }
        }

        let updated = self.repo.update(reminder_id, &user.user_id, changes)?;
        Ok(reminder_to_response(updated))
    }
}

impl RemindersService {
    /// "Delete this reminder" for a recurring one: moves it on to its next occurrence, or
    /// deletes it when its rule is used up.
    pub fn skip_reminder(
        &self,
        user: &AuthenticatedUser,
        reminder_id: &str,
        req: SkipReminderRequest,
    ) -> Result<SkipReminderResponse, ApiError> {
        let tz = parse_zone(req.timezone.as_deref())?;
        let series = self.repo.transaction(|conn| {
            let reminder = find_recurring(conn, reminder_id, &user.user_id)?;
            skip(conn, &reminder, tz)
        })?;
        Ok(SkipReminderResponse {
            series: series.map(reminder_to_response),
        })
    }

    /// "Edit this reminder" for a recurring one: the current occurrence becomes a one-off
    /// reminder with the changes, linked as the series is, and the series moves on as
    /// `skip_reminder` moves it.
    pub fn edit_reminder_occurrence(
        &self,
        user: &AuthenticatedUser,
        reminder_id: &str,
        req: ReminderOccurrenceRequest,
    ) -> Result<ReminderOccurrenceResponse, ApiError> {
        let tz = parse_zone(req.timezone.as_deref())?;
        let due = req.due_time.as_deref().map(parse_dt).transpose()?;
        let now = Utc::now().naive_utc();
        let (one_off, series) = self.repo.transaction(|conn| {
            let reminder = find_recurring(conn, reminder_id, &user.user_id)?;
            let one_off = NewReminderRecord {
                id: Uuid::new_v4().to_string(),
                user_id: reminder.user_id.clone(),
                title: req.title.clone().unwrap_or_else(|| reminder.title.clone()),
                due_time: due.unwrap_or(reminder.due_time),
                completed: false,
                recurrence_rule: None,
                linked_event_id: reminder.linked_event_id.clone(),
                linked_task_id: reminder.linked_task_id.clone(),
                created_at: now,
                updated_at: now,
            };
            let id = one_off.id.clone();
            diesel::insert_into(reminders::table)
                .values(&one_off)
                .execute(conn)?;
            let one_off = reminders::table
                .filter(reminders::id.eq(&id))
                .select(ReminderRecord::as_select())
                .first(conn)?;
            Ok((one_off, skip(conn, &reminder, tz)?))
        })?;
        Ok(ReminderOccurrenceResponse {
            reminder: reminder_to_response(one_off),
            series: series.map(reminder_to_response),
        })
    }
}

fn parse_zone(name: Option<&str>) -> Result<Tz, ApiError> {
    match name {
        Some(name) => name
            .parse::<Tz>()
            .map_err(|_| ApiError::bad_request(format!("Unknown time zone: {name}"))),
        None => Ok(Tz::UTC),
    }
}

fn find_recurring(
    conn: &mut SqliteConnection,
    reminder_id: &str,
    user_id: &str,
) -> Result<ReminderRecord, ApiError> {
    let reminder = reminders::table
        .filter(
            reminders::id
                .eq(reminder_id)
                .and(reminders::user_id.eq(user_id)),
        )
        .select(ReminderRecord::as_select())
        .first(conn)
        .optional()?
        .ok_or_else(|| ApiError::not_found("Reminder not found"))?;
    if reminder
        .recurrence_rule
        .as_deref()
        .unwrap_or_default()
        .is_empty()
    {
        return Err(ApiError::bad_request("Not a repeating reminder"));
    }
    Ok(reminder)
}

/// Moves `reminder` on past its current occurrence, as completing it would, but deletes it
/// rather than marking it done once its rule is used up: a skipped occurrence isn't a done
/// one. Returns it moved, or `None` when deleted.
fn skip(
    conn: &mut SqliteConnection,
    reminder: &ReminderRecord,
    tz: Tz,
) -> Result<Option<ReminderRecord>, ApiError> {
    let rule = reminder.recurrence_rule.clone().unwrap_or_default();
    match recurrence::complete(reminder.due_time.and_utc(), &rule, tz) {
        Some(Completion::Advance { due, rule }) => {
            let changes = UpdateReminderRecord {
                title: None,
                due_time: Some(due.naive_utc()),
                completed: Some(false),
                recurrence_rule: Some(Some(rule)),
                notified_at: Some(None),
                updated_at: Utc::now().naive_utc(),
            };
            diesel::update(reminders::table.filter(reminders::id.eq(&reminder.id)))
                .set(&changes)
                .execute(conn)?;
            Ok(Some(
                reminders::table
                    .filter(reminders::id.eq(&reminder.id))
                    .select(ReminderRecord::as_select())
                    .first(conn)?,
            ))
        }
        Some(Completion::Finished) | None => {
            diesel::delete(reminders::table.filter(reminders::id.eq(&reminder.id)))
                .execute(conn)?;
            Ok(None)
        }
    }
}

fn parse_dt(s: &str) -> Result<NaiveDateTime, ApiError> {
    s.parse::<chrono::DateTime<chrono::Utc>>()
        .map(|dt| dt.naive_utc())
        .or_else(|_| s.parse::<NaiveDateTime>())
        .map_err(|_| ApiError::bad_request(&format!("Invalid datetime: {}", s)))
}

fn reminder_to_response(r: ReminderRecord) -> ReminderResponse {
    ReminderResponse {
        id: r.id,
        title: r.title,
        due_time: r.due_time.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        completed: r.completed,
        recurrence_rule: r.recurrence_rule,
        linked_event_id: r.linked_event_id,
        linked_task_id: r.linked_task_id,
        created_at: r.created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        updated_at: r.updated_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel_migrations::MigrationHarness;

    fn service() -> RemindersService {
        // One connection, so the `:memory:` database persists across calls.
        let pool = Pool::builder()
            .max_size(1)
            .build(ConnectionManager::<SqliteConnection>::new(":memory:"))
            .expect("pool");
        pool.get()
            .unwrap()
            .run_pending_migrations(crate::MIGRATIONS)
            .expect("migrations");
        RemindersService::new(Arc::new(RemindersRepository::new(pool)))
    }

    fn ada() -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: "ada".into(),
            email: "ada@example.com".into(),
            token: String::new(),
            is_admin: false,
        }
    }

    fn daily(svc: &RemindersService, rule: Option<&str>) -> ReminderResponse {
        svc.create_reminder(
            &ada(),
            CreateReminderRequest {
                title: "Water plants".into(),
                due_time: "2026-10-05T09:00:00Z".into(),
                recurrence_rule: rule.map(str::to_string),
                linked_event_id: Some("ev1".into()),
                linked_task_id: None,
            },
        )
        .unwrap()
    }

    fn skip_req() -> SkipReminderRequest {
        SkipReminderRequest {
            timezone: Some("UTC".into()),
        }
    }

    #[test]
    fn skipping_moves_a_repeating_reminder_on_and_deletes_it_when_its_rule_runs_out() {
        let svc = service();
        let reminder = daily(&svc, Some("FREQ=DAILY;COUNT=2"));

        let skipped = svc.skip_reminder(&ada(), &reminder.id, skip_req()).unwrap();
        let series = skipped.series.expect("still repeating");
        assert_eq!(series.due_time, "2026-10-06T09:00:00Z");
        assert_eq!(
            series.recurrence_rule.as_deref(),
            Some("FREQ=DAILY;COUNT=1")
        );
        assert!(!series.completed);

        let last = svc.skip_reminder(&ada(), &reminder.id, skip_req()).unwrap();
        assert!(last.series.is_none());
        assert!(
            svc.get_reminder(&ada(), &reminder.id).is_err(),
            "deleted, not marked done"
        );
    }

    #[test]
    fn editing_one_occurrence_makes_a_one_off_and_moves_the_series_on() {
        let svc = service();
        let reminder = daily(&svc, Some("FREQ=DAILY"));

        let result = svc
            .edit_reminder_occurrence(
                &ada(),
                &reminder.id,
                ReminderOccurrenceRequest {
                    title: Some("Water the ferns".into()),
                    due_time: Some("2026-10-05T12:00:00Z".into()),
                    timezone: Some("UTC".into()),
                },
            )
            .unwrap();

        assert_eq!(result.reminder.title, "Water the ferns");
        assert_eq!(result.reminder.due_time, "2026-10-05T12:00:00Z");
        assert_eq!(result.reminder.recurrence_rule, None);
        assert_eq!(result.reminder.linked_event_id.as_deref(), Some("ev1"));
        let series = result.series.expect("still repeating");
        assert_eq!(series.id, reminder.id);
        assert_eq!(series.title, "Water plants");
        assert_eq!(series.due_time, "2026-10-06T09:00:00Z");
    }

    #[test]
    fn only_a_repeating_reminder_has_occurrences() {
        let svc = service();
        let once = daily(&svc, None);
        assert!(svc.skip_reminder(&ada(), &once.id, skip_req()).is_err());
        assert!(svc
            .edit_reminder_occurrence(&ada(), &once.id, ReminderOccurrenceRequest::default())
            .is_err());
        assert!(svc.skip_reminder(&ada(), "missing", skip_req()).is_err());
        assert!(svc
            .skip_reminder(
                &ada(),
                &daily(&svc, Some("FREQ=DAILY")).id,
                SkipReminderRequest {
                    timezone: Some("Mars/Olympus".into())
                }
            )
            .is_err());
    }
}
