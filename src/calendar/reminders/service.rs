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
        linked_task_id: r.linked_task_id,
        created_at: r.created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        updated_at: r.updated_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calendar::reminders::dto::ListRemindersQuery;
    use crate::shared::DbPool;
    use diesel::prelude::*;

    fn test_pool() -> DbPool {
        use crate::MIGRATIONS;
        use diesel::r2d2::{ConnectionManager, Pool};
        use diesel_migrations::MigrationHarness;
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        pool
    }

    fn test_user(id: &str) -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: id.to_string(),
            email: format!("{id}@example.com"),
            token: "test-token".to_string(),
            is_admin: false,
        }
    }

    fn test_service() -> (RemindersService, AuthenticatedUser, AuthenticatedUser) {
        let pool = test_pool();
        // `reminders.linked_task_id` is a real foreign key and this binary
        // enforces them, so a task reminder needs a task that exists.
        insert_task(&pool, "task-1", "user-a");
        insert_task(&pool, "task-2", "user-a");
        let service = RemindersService::new(Arc::new(RemindersRepository::new(pool)));
        (service, test_user("user-a"), test_user("user-b"))
    }

    fn insert_task(pool: &DbPool, id: &str, user_id: &str) {
        let mut conn = pool.get().expect("conn");
        diesel::sql_query(
            "INSERT INTO tasks (id, user_id, title, done, position, created_at, updated_at) \
             VALUES (?, ?, 'A task', 0, 0, datetime('now'), datetime('now'))",
        )
        .bind::<diesel::sql_types::Text, _>(id)
        .bind::<diesel::sql_types::Text, _>(user_id)
        .execute(&mut conn)
        .expect("insert task");
    }

    fn create(
        service: &RemindersService,
        user: &AuthenticatedUser,
        title: &str,
        event: Option<&str>,
        task: Option<&str>,
    ) -> ReminderResponse {
        service
            .create_reminder(
                user,
                CreateReminderRequest {
                    title: title.to_string(),
                    due_time: "2026-09-24T18:00:00Z".to_string(),
                    recurrence_rule: None,
                    linked_event_id: event.map(str::to_string),
                    linked_task_id: task.map(str::to_string),
                },
            )
            .expect("create reminder")
    }

    fn unfiltered() -> ListRemindersQuery {
        ListRemindersQuery { event_id: None, task_id: None }
    }

    /// The module had no tests at all, so nothing proved the read path still
    /// worked after `linked_task_id` was added to the record — which is the
    /// first thing to check when the sidebar shows nothing.
    #[test]
    fn a_created_reminder_comes_back_from_the_unfiltered_list() {
        let (service, user, _) = test_service();
        create(&service, &user, "Water the plants", None, None);

        let listed = service.list_reminders(&user, unfiltered()).expect("list");

        assert_eq!(listed.reminders.len(), 1);
        assert_eq!(listed.reminders[0].title, "Water the plants");
        assert_eq!(listed.reminders[0].linked_event_id, None);
        assert_eq!(listed.reminders[0].linked_task_id, None);
    }

    #[test]
    fn the_unfiltered_list_returns_standalone_event_and_task_reminders_alike() {
        let (service, user, _) = test_service();
        create(&service, &user, "Standalone", None, None);
        create(&service, &user, "On an event", Some("evt-1"), None);
        create(&service, &user, "On a task", None, Some("task-1"));

        // The server does not decide what the sidebar shows — it returns
        // everything and the client filters, which is why a reminder that
        // belongs to something still has to come back here.
        assert_eq!(service.list_reminders(&user, unfiltered()).expect("list").reminders.len(), 3);
    }

    #[test]
    fn filtering_by_task_returns_only_that_tasks_reminders() {
        let (service, user, _) = test_service();
        create(&service, &user, "Standalone", None, None);
        create(&service, &user, "On task 1", None, Some("task-1"));
        create(&service, &user, "On task 2", None, Some("task-2"));

        let listed = service
            .list_reminders(&user, ListRemindersQuery { event_id: None, task_id: Some("task-1".into()) })
            .expect("list");

        assert_eq!(listed.reminders.len(), 1);
        assert_eq!(listed.reminders[0].title, "On task 1");
    }

    #[test]
    fn filtering_by_event_returns_only_that_events_reminders() {
        let (service, user, _) = test_service();
        create(&service, &user, "Standalone", None, None);
        create(&service, &user, "On an event", Some("evt-1"), None);

        let listed = service
            .list_reminders(&user, ListRemindersQuery { event_id: Some("evt-1".into()), task_id: None })
            .expect("list");

        assert_eq!(listed.reminders.len(), 1);
        assert_eq!(listed.reminders[0].title, "On an event");
    }

    #[test]
    fn a_reminder_cannot_claim_both_an_event_and_a_task() {
        let (service, user, _) = test_service();
        assert!(service
            .create_reminder(
                &user,
                CreateReminderRequest {
                    title: "Confused".to_string(),
                    due_time: "2026-09-24T18:00:00Z".to_string(),
                    recurrence_rule: None,
                    linked_event_id: Some("evt-1".to_string()),
                    linked_task_id: Some("task-1".to_string()),
                },
            )
            .is_err());
    }

    #[test]
    fn one_users_reminders_are_not_listed_for_another() {
        let (service, user_a, user_b) = test_service();
        create(&service, &user_a, "Mine", None, None);

        assert_eq!(service.list_reminders(&user_b, unfiltered()).expect("list").reminders.len(), 0);
        assert_eq!(service.list_reminders(&user_a, unfiltered()).expect("list").reminders.len(), 1);
    }
}
