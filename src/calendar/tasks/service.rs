use crate::calendar::events::dto::{CreateEventRequest, EventResponse, UpdateEventRequest};
use crate::calendar::events::service::EventsService;
use crate::calendar::tasks::{
    dto::{
        CreateTaskAttachmentRequest, CreateTaskListRequest, CreateTaskRequest,
        ListTaskAttachmentsResponse, ListTaskListsResponse, ReorderTasksRequest,
        ScheduleTaskRequest, TaskAttachmentResponse, TaskListResponse, TaskResponse,
        UpdateTaskRequest,
    },
    model::{
        NewTaskAttachmentRecord, NewTaskListMembershipRecord, NewTaskListRecord, NewTaskRecord,
        UpdateTaskRecord,
    },
    repository::TasksRepository,
};
use crate::shared::{ApiError, AuthenticatedUser};
use chrono::{NaiveDateTime, Utc};
use std::sync::Arc;
use uuid::Uuid;

pub struct TasksService {
    repo: Arc<TasksRepository>,
    /// Scheduling a task creates an ordinary calendar event, so this service owns the
    /// task's half of that link and the events service owns the event itself. Nothing in
    /// `events` knows about tasks — see the migration for why the link is one-directional.
    events: Arc<EventsService>,
}

impl TasksService {
    pub fn new(repo: Arc<TasksRepository>, events: Arc<EventsService>) -> Self {
        TasksService { repo, events }
    }

    // ── Task Lists ────────────────────────────────────────────────────────────

    pub fn list_task_lists(
        &self,
        user: &AuthenticatedUser,
    ) -> Result<ListTaskListsResponse, ApiError> {
        let records = self.repo.find_by_user(&user.user_id)?;
        let task_lists = records.into_iter().map(task_list_to_response).collect();
        Ok(ListTaskListsResponse { task_lists })
    }

    pub fn create_task_list(
        &self,
        user: &AuthenticatedUser,
        req: CreateTaskListRequest,
    ) -> Result<TaskListResponse, ApiError> {
        let now = Utc::now().naive_utc();
        let record = NewTaskListRecord {
            id: Uuid::new_v4().to_string(),
            user_id: user.user_id.clone(),
            name: req.name,
            color: req.color,
            created_at: now,
            updated_at: now,
        };
        let saved = self.repo.insert(record)?;
        Ok(task_list_to_response(saved))
    }

    // ── Tasks ─────────────────────────────────────────────────────────────────

    pub fn list_tasks(
        &self,
        user: &AuthenticatedUser,
        list_id: Option<&str>,
    ) -> Result<Vec<TaskResponse>, ApiError> {
        match list_id {
            Some(lid) => {
                self.repo.find_by_id(lid, &user.user_id)?;
                let records = self.repo.find_tasks_by_list_id(&user.user_id, lid)?;
                let lid_owned = lid.to_string();
                Ok(records
                    .into_iter()
                    .map(|r| task_to_response(r, Some(lid_owned.clone())))
                    .collect())
            }
            None => {
                let records = self
                    .repo
                    .find_all_tasks_with_list_id_by_user(&user.user_id)?;
                Ok(records
                    .into_iter()
                    .map(|(r, lid)| task_to_response(r, lid))
                    .collect())
            }
        }
    }

    pub fn create_task(
        &self,
        user: &AuthenticatedUser,
        req: CreateTaskRequest,
    ) -> Result<TaskResponse, ApiError> {
        let now = Utc::now().naive_utc();
        let record = NewTaskRecord {
            id: Uuid::new_v4().to_string(),
            user_id: user.user_id.clone(),
            title: req.title,
            notes: req.notes,
            done: false,
            due_date: req.due_date.as_deref().map(parse_dt).transpose()?,
            position: req.position.unwrap_or(0),
            created_at: now,
            updated_at: now,
        };
        let saved = self.repo.insert_task(record)?;
        Ok(task_to_response(saved, None))
    }

    pub fn update_task(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
        req: UpdateTaskRequest,
    ) -> Result<TaskResponse, ApiError> {
        let new_title = req.title.clone();
        let due_date = match req.due_date {
            None => None,
            Some(None) => Some(None),
            Some(Some(ref s)) => Some(Some(parse_dt(s)?)),
        };
        let changes = UpdateTaskRecord {
            title: req.title,
            notes: req.notes,
            done: req.done,
            due_date,
            position: req.position,
            updated_at: Utc::now().naive_utc(),
        };
        let updated = self.repo.update_task(task_id, &user.user_id, changes)?;

        // A scheduled task and its event show the same words in two places, so a
        // rename has to reach both or the calendar keeps showing the old title
        // with no way for the user to correct it — the event is not editable as
        // itself from the task editor.
        if let (Some(event_id), Some(title)) = (updated.event_id.as_deref(), new_title) {
            if let Err(e) = self.events.update_event(
                user,
                event_id,
                UpdateEventRequest {
                    title: Some(title),
                    description: None,
                    start_time: None,
                    end_time: None,
                    all_day: None,
                    location: None,
                    recurrence_rule: None,
                    attendees: None,
                    timezone: None,
                },
            ) {
                // The task is already saved. An event that has been deleted out
                // from under the link is the expected case here, and failing the
                // rename over it would make the task uneditable.
                tracing::warn!("Could not retitle event {} for task {}: {:?}", event_id, task_id, e);
            }
        }

        Ok(task_to_response(updated, None))
    }

    pub fn reorder_tasks(
        &self,
        user: &AuthenticatedUser,
        req: ReorderTasksRequest,
    ) -> Result<(), ApiError> {
        match req.list_id.as_deref() {
            Some(list_id) => {
                // Verify the list belongs to the user
                self.repo.find_by_id(list_id, &user.user_id)?;

                // Verify all requested task IDs belong to this list
                let list_tasks = self.repo.find_tasks_by_list_id(&user.user_id, list_id)?;
                let list_task_ids: std::collections::HashSet<&str> =
                    list_tasks.iter().map(|t| t.id.as_str()).collect();
                for task_id in &req.task_ids {
                    if !list_task_ids.contains(task_id.as_str()) {
                        return Err(ApiError::bad_request(&format!(
                            "Task {} is not in list {}",
                            task_id, list_id
                        )));
                    }
                }
            }
            None => {
                // No list to check membership against, so the only thing left to
                // verify is ownership — which `bulk_update_positions` filters on
                // anyway, but silently, and a reorder naming somebody else's task
                // should say so rather than write nothing.
                for task_id in &req.task_ids {
                    self.repo.find_task_by_id(task_id, &user.user_id)?;
                }
            }
        }

        let now = Utc::now().naive_utc();
        let updates: Vec<(String, i32)> = req
            .task_ids
            .into_iter()
            .enumerate()
            .map(|(i, id)| (id, i as i32))
            .collect();

        self.repo
            .bulk_update_positions(&user.user_id, &updates, now)
    }

    // ── List Membership ───────────────────────────────────────────────────────

    pub fn add_task_to_list(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
        list_id: &str,
    ) -> Result<(), ApiError> {
        // Verify ownership of both task and list
        self.repo.find_task_by_id(task_id, &user.user_id)?;
        self.repo.find_by_id(list_id, &user.user_id)?;
        // Idempotent: if membership already exists, succeed silently
        if self.repo.membership_exists(task_id, list_id)? {
            return Ok(());
        }
        self.repo.insert_membership(NewTaskListMembershipRecord {
            task_id: task_id.to_string(),
            list_id: list_id.to_string(),
        })?;
        Ok(())
    }

    // ── Calendar scheduling ───────────────────────────────────────────────────

    /// Put a task on the calendar, or move the event it is already on.
    ///
    /// Idempotent in the sense that matters: calling it twice does not leave two events
    /// behind. The event is a plain local event with the task's title, so it renders in
    /// Month, Week and Agenda with no view needing to know a task exists.
    pub fn schedule_task(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
        req: ScheduleTaskRequest,
    ) -> Result<EventResponse, ApiError> {
        let task = self.repo.find_task_by_id(task_id, &user.user_id)?;

        let start = parse_dt(&req.start_time)?;
        let end = parse_dt(&req.end_time)?;
        if end < start {
            return Err(ApiError::bad_request("endTime is before startTime"));
        }

        // An event id that no longer resolves means the event was deleted from
        // the calendar directly; treat the task as unscheduled and make a new
        // one rather than reporting a 404 the user cannot act on.
        if let Some(event_id) = task.event_id.as_deref() {
            let moved = self.events.update_event(
                user,
                event_id,
                UpdateEventRequest {
                    title: Some(task.title.clone()),
                    description: None,
                    start_time: Some(req.start_time.clone()),
                    end_time: Some(req.end_time.clone()),
                    all_day: Some(req.all_day),
                    location: None,
                    recurrence_rule: None,
                    attendees: None,
                    timezone: req.timezone.clone(),
                },
            );
            match moved {
                Ok(event) => return Ok(event),
                Err(e) => tracing::warn!(
                    "Task {} pointed at missing event {}; rescheduling: {:?}",
                    task_id,
                    event_id,
                    e
                ),
            }
        }

        let event = self.events.create_event(
            user,
            CreateEventRequest {
                title: task.title.clone(),
                description: task.notes.clone(),
                start_time: req.start_time,
                end_time: req.end_time,
                all_day: req.all_day,
                location: None,
                recurrence_rule: None,
                attendees: Vec::new(),
                timezone: req.timezone,
            },
        )?;
        self.repo.set_task_event(
            task_id,
            &user.user_id,
            Some(&event.id),
            Utc::now().naive_utc(),
        )?;
        Ok(event)
    }

    /// Take a task off the calendar, deleting the event it was scheduled as.
    pub fn unschedule_task(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
    ) -> Result<TaskResponse, ApiError> {
        let task = self.repo.find_task_by_id(task_id, &user.user_id)?;
        if let Some(event_id) = task.event_id.as_deref() {
            // Already gone from the calendar is the outcome asked for, so a
            // missing event is success, not a 404.
            if let Err(e) = self.events.delete_event(user, event_id) {
                tracing::warn!(
                    "Could not delete event {} while unscheduling task {}: {:?}",
                    event_id,
                    task_id,
                    e
                );
            }
        }
        let updated = self
            .repo
            .set_task_event(task_id, &user.user_id, None, Utc::now().naive_utc())?;
        Ok(task_to_response(updated, None))
    }

    // ── Attachments ───────────────────────────────────────────────────────────

    pub fn list_attachments(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
    ) -> Result<ListTaskAttachmentsResponse, ApiError> {
        self.repo.find_task_by_id(task_id, &user.user_id)?;
        let attachments = self
            .repo
            .find_attachments_by_task(task_id)?
            .into_iter()
            .map(task_attachment_to_response)
            .collect();
        Ok(ListTaskAttachmentsResponse { attachments })
    }

    pub fn create_attachment(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
        req: CreateTaskAttachmentRequest,
    ) -> Result<TaskAttachmentResponse, ApiError> {
        self.repo.find_task_by_id(task_id, &user.user_id)?;
        if req.file_id.is_none() && req.note.is_none() {
            return Err(ApiError::bad_request("Provide either fileId or note"));
        }
        let saved = self.repo.insert_attachment(NewTaskAttachmentRecord {
            id: Uuid::new_v4().to_string(),
            task_id: task_id.to_string(),
            file_id: req.file_id,
            name: req.name,
            note: req.note,
        })?;
        Ok(task_attachment_to_response(saved))
    }

    pub fn delete_attachment(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
        attachment_id: &str,
    ) -> Result<(), ApiError> {
        self.repo.find_task_by_id(task_id, &user.user_id)?;
        self.repo.delete_attachment(attachment_id, task_id)
    }
}

fn parse_dt(s: &str) -> Result<NaiveDateTime, ApiError> {
    s.parse::<chrono::DateTime<chrono::Utc>>()
        .map(|dt| dt.naive_utc())
        .or_else(|_| s.parse::<NaiveDateTime>())
        .map_err(|_| ApiError::bad_request(&format!("Invalid datetime: {}", s)))
}

fn task_list_to_response(r: crate::calendar::tasks::model::TaskListRecord) -> TaskListResponse {
    TaskListResponse {
        id: r.id,
        name: r.name,
        color: r.color,
        created_at: r.created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        updated_at: r.updated_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    }
}

fn task_to_response(
    r: crate::calendar::tasks::model::TaskRecord,
    list_id: Option<String>,
) -> TaskResponse {
    TaskResponse {
        id: r.id,
        title: r.title,
        notes: r.notes,
        done: r.done,
        due_date: r
            .due_date
            .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        position: r.position,
        list_id,
        event_id: r.event_id,
        created_at: r.created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        updated_at: r.updated_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    }
}

fn task_attachment_to_response(
    r: crate::calendar::tasks::model::TaskAttachmentRecord,
) -> TaskAttachmentResponse {
    TaskAttachmentResponse {
        id: r.id,
        task_id: r.task_id,
        file_id: r.file_id,
        name: r.name,
        note: r.note,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calendar::events::attendees::AttendeesRepository;
    use crate::calendar::events::repository::EventsRepository;
    use crate::shared::DbPool;
    use diesel::prelude::*;

    fn test_pool() -> DbPool {
        use crate::MIGRATIONS;
        use diesel::r2d2::{ConnectionManager, Pool};
        use diesel_migrations::MigrationHarness;

        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        pool
    }

    fn insert_user(pool: &DbPool, id: &str) {
        let mut conn = pool.get().expect("conn");
        diesel::sql_query(
            "INSERT INTO users (id, email, name, password_hash, created_at, role, totp_enabled) \
             VALUES (?, ?, ?, 'hash', datetime('now'), 'user', 0)",
        )
        .bind::<diesel::sql_types::Text, _>(id)
        .bind::<diesel::sql_types::Text, _>(format!("{id}@example.com"))
        .bind::<diesel::sql_types::Text, _>(id)
        .execute(&mut conn)
        .expect("insert user");
    }

    fn test_user(user_id: &str) -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: user_id.to_string(),
            email: format!("{user_id}@example.com"),
            token: "test-token".to_string(),
            is_admin: false,
        }
    }

    fn test_service() -> (TasksService, AuthenticatedUser, AuthenticatedUser) {
        let pool = test_pool();
        insert_user(&pool, "user-a");
        insert_user(&pool, "user-b");
        let events = Arc::new(EventsService::new(
            Arc::new(EventsRepository::new(pool.clone())),
            Arc::new(AttendeesRepository::new(pool.clone())),
        ));
        let service = TasksService::new(Arc::new(TasksRepository::new(pool)), events);
        (service, test_user("user-a"), test_user("user-b"))
    }

    fn new_task(service: &TasksService, user: &AuthenticatedUser, title: &str) -> TaskResponse {
        service
            .create_task(
                user,
                CreateTaskRequest {
                    title: title.to_string(),
                    notes: None,
                    due_date: None,
                    position: None,
                },
            )
            .expect("create task")
    }

    fn schedule_req() -> ScheduleTaskRequest {
        ScheduleTaskRequest {
            start_time: "2026-10-01T09:00:00Z".to_string(),
            end_time: "2026-10-01T10:00:00Z".to_string(),
            all_day: false,
            timezone: Some("UTC".to_string()),
        }
    }

    // ── Scheduling ────────────────────────────────────────────────────────────

    #[test]
    fn a_new_task_is_not_on_the_calendar() {
        let (service, user, _) = test_service();
        assert_eq!(new_task(&service, &user, "Clean ceiling fans").event_id, None);
    }

    #[test]
    fn scheduling_a_task_creates_an_event_carrying_its_title() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");

        let event = service
            .schedule_task(&user, &task.id, schedule_req())
            .expect("schedule");

        assert_eq!(event.title, "Clean ceiling fans");
        let listed = service.list_tasks(&user, None).expect("list");
        assert_eq!(listed[0].event_id.as_deref(), Some(event.id.as_str()));
    }

    #[test]
    fn scheduling_twice_moves_the_event_rather_than_creating_a_second_one() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");
        let first = service
            .schedule_task(&user, &task.id, schedule_req())
            .expect("schedule");

        let moved = service
            .schedule_task(
                &user,
                &task.id,
                ScheduleTaskRequest {
                    start_time: "2026-10-02T14:00:00Z".to_string(),
                    end_time: "2026-10-02T15:00:00Z".to_string(),
                    all_day: false,
                    timezone: Some("UTC".to_string()),
                },
            )
            .expect("reschedule");

        assert_eq!(moved.id, first.id, "the task keeps the one event it had");
        let events = service
            .events
            .list_events(
                &user,
                crate::calendar::events::dto::ListEventsQuery {
                    from: Some("2026-09-01T00:00:00Z".to_string()),
                    to: Some("2026-11-01T00:00:00Z".to_string()),
                },
            )
            .expect("list events");
        assert_eq!(events.events.len(), 1);
        assert!(events.events[0].start_time.starts_with("2026-10-02T14:00"));
    }

    #[test]
    fn unscheduling_deletes_the_event_and_clears_the_link() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");
        service
            .schedule_task(&user, &task.id, schedule_req())
            .expect("schedule");

        let cleared = service.unschedule_task(&user, &task.id).expect("unschedule");

        assert_eq!(cleared.event_id, None);
        let events = service
            .events
            .list_events(
                &user,
                crate::calendar::events::dto::ListEventsQuery {
                    from: Some("2026-09-01T00:00:00Z".to_string()),
                    to: Some("2026-11-01T00:00:00Z".to_string()),
                },
            )
            .expect("list events");
        assert!(events.events.is_empty());
    }

    #[test]
    fn unscheduling_a_task_that_was_never_scheduled_succeeds() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");
        assert_eq!(
            service
                .unschedule_task(&user, &task.id)
                .expect("unschedule")
                .event_id,
            None
        );
    }

    #[test]
    fn an_event_deleted_from_the_calendar_leaves_the_task_reschedulable() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");
        let first = service
            .schedule_task(&user, &task.id, schedule_req())
            .expect("schedule");

        // The user deletes the event from a calendar view; the task's link is
        // now stale, which is the one row that can be.
        service
            .events
            .delete_event(&user, &first.id)
            .expect("delete event");

        let again = service
            .schedule_task(&user, &task.id, schedule_req())
            .expect("reschedule after the event went missing");
        assert_ne!(again.id, first.id);
    }

    #[test]
    fn scheduling_rejects_an_end_before_its_start() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");
        let err = service
            .schedule_task(
                &user,
                &task.id,
                ScheduleTaskRequest {
                    start_time: "2026-10-01T10:00:00Z".to_string(),
                    end_time: "2026-10-01T09:00:00Z".to_string(),
                    all_day: false,
                    timezone: None,
                },
            )
            .expect_err("should reject");
        assert!(format!("{err:?}").contains("before"));
    }

    #[test]
    fn renaming_a_scheduled_task_retitles_its_event() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");
        let event = service
            .schedule_task(&user, &task.id, schedule_req())
            .expect("schedule");

        service
            .update_task(
                &user,
                &task.id,
                UpdateTaskRequest {
                    title: Some("Clean the ceiling fans".to_string()),
                    notes: None,
                    done: None,
                    due_date: None,
                    position: None,
                },
            )
            .expect("rename");

        let refreshed = service.events.get_event(&user, &event.id).expect("get event");
        assert_eq!(refreshed.title, "Clean the ceiling fans");
    }

    #[test]
    fn a_task_cannot_be_scheduled_by_another_user() {
        let (service, user_a, user_b) = test_service();
        let task = new_task(&service, &user_a, "Clean ceiling fans");
        assert!(service.schedule_task(&user_b, &task.id, schedule_req()).is_err());
    }

    // ── Attachments ───────────────────────────────────────────────────────────

    #[test]
    fn a_note_and_a_drive_file_both_attach_to_a_task() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");

        service
            .create_attachment(
                &user,
                &task.id,
                CreateTaskAttachmentRequest {
                    file_id: None,
                    name: None,
                    note: Some("Buy a longer duster".to_string()),
                },
            )
            .expect("note");
        service
            .create_attachment(
                &user,
                &task.id,
                CreateTaskAttachmentRequest {
                    file_id: Some("file-1".to_string()),
                    name: Some("Instructions.docx".to_string()),
                    note: None,
                },
            )
            .expect("file");

        let listed = service.list_attachments(&user, &task.id).expect("list");
        assert_eq!(listed.attachments.len(), 2);
    }

    #[test]
    fn an_attachment_that_is_neither_a_file_nor_a_note_is_rejected() {
        let (service, user, _) = test_service();
        let task = new_task(&service, &user, "Clean ceiling fans");
        assert!(service
            .create_attachment(
                &user,
                &task.id,
                CreateTaskAttachmentRequest { file_id: None, name: None, note: None },
            )
            .is_err());
    }

    #[test]
    fn attachments_are_not_readable_or_writable_by_another_user() {
        let (service, user_a, user_b) = test_service();
        let task = new_task(&service, &user_a, "Clean ceiling fans");
        let attachment = service
            .create_attachment(
                &user_a,
                &task.id,
                CreateTaskAttachmentRequest {
                    file_id: None,
                    name: None,
                    note: Some("private".to_string()),
                },
            )
            .expect("attach");

        assert!(service.list_attachments(&user_b, &task.id).is_err());
        assert!(service
            .delete_attachment(&user_b, &task.id, &attachment.id)
            .is_err());
        assert!(service
            .delete_attachment(&user_a, &task.id, &attachment.id)
            .is_ok());
    }

    // ── Patch semantics ───────────────────────────────────────────────────────

    #[test]
    fn omitting_notes_leaves_them_alone_while_null_clears_them() {
        let (service, user, _) = test_service();
        let task = service
            .create_task(
                &user,
                CreateTaskRequest {
                    title: "Clean ceiling fans".to_string(),
                    notes: Some("Use the long duster".to_string()),
                    due_date: Some("2026-10-01T00:00:00Z".to_string()),
                    position: None,
                },
            )
            .expect("create");

        // Absent fields: `serde_json` gives the same request the client sends.
        let untouched: UpdateTaskRequest =
            serde_json::from_str(r#"{"done":true}"#).expect("parse patch");
        let after = service.update_task(&user, &task.id, untouched).expect("patch");
        assert_eq!(after.notes.as_deref(), Some("Use the long duster"));
        assert!(after.due_date.is_some());
        assert!(after.done);

        let cleared: UpdateTaskRequest =
            serde_json::from_str(r#"{"notes":null,"dueDate":null}"#).expect("parse patch");
        let after = service.update_task(&user, &task.id, cleared).expect("patch");
        assert_eq!(after.notes, None);
        assert_eq!(after.due_date, None);
    }

    // ── Reorder without a list ────────────────────────────────────────────────

    #[test]
    fn reorder_without_a_list_rewrites_positions_across_every_task() {
        let (service, user, _) = test_service();
        let first = new_task(&service, &user, "First");
        let second = new_task(&service, &user, "Second");
        let third = new_task(&service, &user, "Third");

        service
            .reorder_tasks(
                &user,
                ReorderTasksRequest {
                    list_id: None,
                    task_ids: vec![third.id.clone(), first.id.clone(), second.id.clone()],
                },
            )
            .expect("reorder");

        let ordered: Vec<String> = service
            .list_tasks(&user, None)
            .expect("list")
            .into_iter()
            .map(|t| t.title)
            .collect();
        assert_eq!(ordered, vec!["Third", "First", "Second"]);
    }

    #[test]
    fn reorder_without_a_list_refuses_a_task_belonging_to_someone_else() {
        let (service, user_a, user_b) = test_service();
        let mine = new_task(&service, &user_a, "Mine");
        let theirs = new_task(&service, &user_b, "Theirs");

        assert!(service
            .reorder_tasks(
                &user_a,
                ReorderTasksRequest {
                    list_id: None,
                    task_ids: vec![theirs.id, mine.id],
                },
            )
            .is_err());
    }
}
