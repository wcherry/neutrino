use crate::shared::{ApiError, AuthenticatedUser};
use crate::calendar::tasks::{
    dto::{
        BulkCreateTasksRequest, BulkCreateTasksResponse, CreateTaskListRequest, CreateTaskRequest,
        ListTaskListsResponse, ReorderTasksRequest, TaskListResponse,
        TaskResponse, UpdateTaskListRequest, UpdateTaskRequest,
    },
    model::{
        NewTaskListMembershipRecord, NewTaskListRecord, NewTaskRecord, UpdateTaskListRecord,
        UpdateTaskRecord,
    },
    repository::TasksRepository,
};
use chrono::{NaiveDateTime, Utc};
use std::sync::Arc;
use uuid::Uuid;

pub struct TasksService {
    repo: Arc<TasksRepository>,
}

impl TasksService {
    pub fn new(repo: Arc<TasksRepository>) -> Self {
        TasksService { repo }
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

    pub fn get_task_list(
        &self,
        user: &AuthenticatedUser,
        list_id: &str,
    ) -> Result<TaskListResponse, ApiError> {
        let record = self.repo.find_by_id(list_id, &user.user_id)?;
        Ok(task_list_to_response(record))
    }

    pub fn update_task_list(
        &self,
        user: &AuthenticatedUser,
        list_id: &str,
        req: UpdateTaskListRequest,
    ) -> Result<TaskListResponse, ApiError> {
        let changes = UpdateTaskListRecord {
            name: req.name,
            color: req.color.map(Some),
            updated_at: Utc::now().naive_utc(),
        };
        let updated = self.repo.update(list_id, &user.user_id, changes)?;
        Ok(task_list_to_response(updated))
    }

    pub fn delete_task_list(
        &self,
        user: &AuthenticatedUser,
        list_id: &str,
    ) -> Result<(), ApiError> {
        // Verify the list belongs to the user
        self.repo.find_by_id(list_id, &user.user_id)?;
        // Remove all memberships pointing to this list (tasks themselves are preserved)
        self.repo.delete_memberships_by_list(list_id)?;
        self.repo.delete(list_id, &user.user_id)
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
                let records = self.repo.find_all_tasks_with_list_id_by_user(&user.user_id)?;
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

    pub fn bulk_create_tasks(
        &self,
        user: &AuthenticatedUser,
        req: BulkCreateTasksRequest,
    ) -> Result<BulkCreateTasksResponse, ApiError> {
        if req.tasks.is_empty() {
            return Err(ApiError::bad_request("tasks must not be empty"));
        }
        if req.tasks.len() > 200 {
            return Err(ApiError::bad_request("tasks must not exceed 200 per request"));
        }
        self.repo.find_by_id(&req.list_id, &user.user_id)?;

        let now = Utc::now().naive_utc();
        let list_id = req.list_id;
        let mut task_records = Vec::with_capacity(req.tasks.len());
        let mut membership_records = Vec::with_capacity(req.tasks.len());

        for (i, item) in req.tasks.into_iter().enumerate() {
            let id = Uuid::new_v4().to_string();
            task_records.push(NewTaskRecord {
                id: id.clone(),
                user_id: user.user_id.clone(),
                title: item.title,
                notes: item.notes,
                done: false,
                due_date: item.due_date.as_deref().map(parse_dt).transpose()?,
                position: i as i32,
                created_at: now,
                updated_at: now,
            });
            membership_records.push(NewTaskListMembershipRecord {
                task_id: id,
                list_id: list_id.clone(),
            });
        }

        let saved = self
            .repo
            .bulk_insert_tasks_with_memberships(task_records, membership_records)?;
        let tasks = saved.into_iter().map(|r| task_to_response(r, None)).collect();
        Ok(BulkCreateTasksResponse { tasks })
    }

    pub fn get_task(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
    ) -> Result<TaskResponse, ApiError> {
        let record = self.repo.find_task_by_id(task_id, &user.user_id)?;
        Ok(task_to_response(record, None))
    }

    pub fn update_task(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
        req: UpdateTaskRequest,
    ) -> Result<TaskResponse, ApiError> {
        let changes = UpdateTaskRecord {
            title: req.title,
            notes: req.notes.map(Some),
            done: req.done,
            due_date: req.due_date.as_deref().map(parse_dt).transpose()?.map(Some),
            position: req.position,
            updated_at: Utc::now().naive_utc(),
        };
        let updated = self.repo.update_task(task_id, &user.user_id, changes)?;
        Ok(task_to_response(updated, None))
    }

    pub fn delete_task(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
    ) -> Result<(), ApiError> {
        self.repo.delete_task(task_id, &user.user_id)
    }

    pub fn reorder_tasks(
        &self,
        user: &AuthenticatedUser,
        req: ReorderTasksRequest,
    ) -> Result<(), ApiError> {
        // Verify the list belongs to the user
        self.repo.find_by_id(&req.list_id, &user.user_id)?;

        // Verify all requested task IDs belong to this list
        let list_tasks = self.repo.find_tasks_by_list_id(&user.user_id, &req.list_id)?;
        let list_task_ids: std::collections::HashSet<&str> =
            list_tasks.iter().map(|t| t.id.as_str()).collect();
        for task_id in &req.task_ids {
            if !list_task_ids.contains(task_id.as_str()) {
                return Err(ApiError::bad_request(&format!(
                    "Task {} is not in list {}",
                    task_id, req.list_id
                )));
            }
        }

        let now = Utc::now().naive_utc();
        let updates: Vec<(String, i32)> = req
            .task_ids
            .into_iter()
            .enumerate()
            .map(|(i, id)| (id, i as i32))
            .collect();

        self.repo.bulk_update_positions(&user.user_id, &updates, now)
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

    pub fn remove_task_from_list(
        &self,
        user: &AuthenticatedUser,
        task_id: &str,
        list_id: &str,
    ) -> Result<(), ApiError> {
        // Verify ownership of both task and list
        self.repo.find_task_by_id(task_id, &user.user_id)?;
        self.repo.find_by_id(list_id, &user.user_id)?;
        self.repo.delete_membership(task_id, list_id)
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

fn task_to_response(r: crate::calendar::tasks::model::TaskRecord, list_id: Option<String>) -> TaskResponse {
    TaskResponse {
        id: r.id,
        title: r.title,
        notes: r.notes,
        done: r.done,
        due_date: r.due_date.map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        position: r.position,
        list_id,
        created_at: r.created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        updated_at: r.updated_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    }
}
