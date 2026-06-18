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
        let records = if let Some(event_id) = query.event_id {
            self.repo.find_by_event(&user.user_id, &event_id)?
        } else {
            self.repo.find_by_user(&user.user_id)?
        };
        let reminders = records.into_iter().map(reminder_to_response).collect();
        Ok(ListRemindersResponse { reminders })
    }

    pub fn create_reminder(
        &self,
        user: &AuthenticatedUser,
        req: CreateReminderRequest,
    ) -> Result<ReminderResponse, ApiError> {
        let now = Utc::now().naive_utc();
        let record = NewReminderRecord {
            id: Uuid::new_v4().to_string(),
            user_id: user.user_id.clone(),
            title: req.title,
            due_time: parse_dt(&req.due_time)?,
            completed: false,
            recurrence_rule: req.recurrence_rule,
            linked_event_id: req.linked_event_id,
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
        let changes = UpdateReminderRecord {
            title: req.title,
            due_time: req.due_time.as_deref().map(parse_dt).transpose()?,
            completed: req.completed,
            recurrence_rule: req.recurrence_rule.map(Some),
            notified_at: None,
            updated_at: Utc::now().naive_utc(),
        };
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
        created_at: r.created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        updated_at: r.updated_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    }
}
