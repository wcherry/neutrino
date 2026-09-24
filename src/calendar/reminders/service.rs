use crate::calendar::recurrence::{self, Completion};
use crate::calendar::reminders::{
    dto::{
        CreateReminderRequest, ListRemindersQuery, ListRemindersResponse, ReminderResponse,
        UpdateReminderRequest,
    },
    model::{NewReminderRecord, UpdateReminderRecord},
    repository::RemindersRepository,
};
use crate::shared::{ApiError, AuthenticatedUser};
use chrono::{NaiveDateTime, Utc};
use chrono_tz::Tz;
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

fn parse_dt(s: &str) -> Result<NaiveDateTime, ApiError> {
    s.parse::<chrono::DateTime<chrono::Utc>>()
        .map(|dt| dt.naive_utc())
        .or_else(|_| s.parse::<NaiveDateTime>())
        .map_err(|_| ApiError::bad_request(&format!("Invalid datetime: {}", s)))
}

fn reminder_to_response(r: crate::calendar::reminders::model::ReminderRecord) -> ReminderResponse {
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
