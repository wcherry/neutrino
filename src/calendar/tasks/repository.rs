use crate::calendar::tasks::model::{
    NewTaskAttachmentRecord, NewTaskListMembershipRecord, NewTaskListRecord, NewTaskRecord,
    TaskAttachmentRecord, TaskListMembershipRecord, TaskListRecord, TaskRecord, TaskTagRecord,
    UpdateTaskRecord,
};
use crate::schema::{task_attachments, task_list_memberships, task_lists, task_tags, tasks};
use crate::shared::{ApiError, DbPool};
use diesel::prelude::*;
use diesel::r2d2::ConnectionManager;

pub struct TasksRepository {
    pool: DbPool,
}

impl TasksRepository {
    pub fn new(pool: DbPool) -> Self {
        TasksRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    // ── Task Lists ────────────────────────────────────────────────────────────

    pub fn insert(&self, record: NewTaskListRecord) -> Result<TaskListRecord, ApiError> {
        let id = record.id.clone();
        let mut conn = self.get_conn()?;
        diesel::insert_into(task_lists::table)
            .values(&record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert task_list error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        task_lists::table
            .filter(task_lists::id.eq(&id))
            .select(TaskListRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after task_list insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_by_user(&self, user_id: &str) -> Result<Vec<TaskListRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        task_lists::table
            .filter(task_lists::user_id.eq(user_id))
            .order(task_lists::name.asc())
            .select(TaskListRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list task_lists error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_by_id(&self, id: &str, user_id: &str) -> Result<TaskListRecord, ApiError> {
        let mut conn = self.get_conn()?;
        task_lists::table
            .filter(task_lists::id.eq(id).and(task_lists::user_id.eq(user_id)))
            .select(TaskListRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Task list not found"),
                _ => {
                    tracing::error!("DB get task_list error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    // ── Tasks ─────────────────────────────────────────────────────────────────

    pub fn insert_task(&self, record: NewTaskRecord) -> Result<TaskRecord, ApiError> {
        let id = record.id.clone();
        let mut conn = self.get_conn()?;
        diesel::insert_into(tasks::table)
            .values(&record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert task error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        tasks::table
            .filter(tasks::id.eq(&id))
            .select(TaskRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after task insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    #[allow(dead_code)]
    pub fn find_all_tasks_by_user(&self, user_id: &str) -> Result<Vec<TaskRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        tasks::table
            .filter(tasks::user_id.eq(user_id))
            .order((tasks::position.asc(), tasks::created_at.asc()))
            .select(TaskRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list all tasks error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_all_tasks_with_list_id_by_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<(TaskRecord, Option<String>)>, ApiError> {
        let mut conn = self.get_conn()?;
        tasks::table
            .left_join(
                task_list_memberships::table.on(task_list_memberships::task_id.eq(tasks::id)),
            )
            .filter(tasks::user_id.eq(user_id))
            .order((tasks::position.asc(), tasks::created_at.asc()))
            .select((
                TaskRecord::as_select(),
                task_list_memberships::list_id.nullable(),
            ))
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list all tasks with list_id error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_tasks_by_list_id(
        &self,
        user_id: &str,
        list_id: &str,
    ) -> Result<Vec<TaskRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        tasks::table
            .inner_join(
                task_list_memberships::table.on(task_list_memberships::task_id.eq(tasks::id)),
            )
            .filter(
                tasks::user_id
                    .eq(user_id)
                    .and(task_list_memberships::list_id.eq(list_id)),
            )
            .order((tasks::position.asc(), tasks::created_at.asc()))
            .select(TaskRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list tasks by list error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_task_by_id(&self, id: &str, user_id: &str) -> Result<TaskRecord, ApiError> {
        let mut conn = self.get_conn()?;
        tasks::table
            .filter(tasks::id.eq(id).and(tasks::user_id.eq(user_id)))
            .select(TaskRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Task not found"),
                _ => {
                    tracing::error!("DB get task error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn update_task(
        &self,
        id: &str,
        user_id: &str,
        changes: UpdateTaskRecord,
    ) -> Result<TaskRecord, ApiError> {
        let mut conn = self.get_conn()?;
        let affected =
            diesel::update(tasks::table.filter(tasks::id.eq(id).and(tasks::user_id.eq(user_id))))
                .set(&changes)
                .execute(&mut conn)
                .map_err(|e| {
                    tracing::error!("DB update task error: {:?}", e);
                    ApiError::internal("Database error")
                })?;
        if affected == 0 {
            return Err(ApiError::not_found("Task not found"));
        }
        tasks::table
            .filter(tasks::id.eq(id))
            .select(TaskRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get task after update error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn bulk_update_positions(
        &self,
        user_id: &str,
        updates: &[(String, i32)],
        now: chrono::NaiveDateTime,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<(), diesel::result::Error, _>(|conn| {
            for (id, pos) in updates {
                diesel::update(
                    tasks::table.filter(tasks::id.eq(id).and(tasks::user_id.eq(user_id))),
                )
                .set((tasks::position.eq(pos), tasks::updated_at.eq(now)))
                .execute(conn)?;
            }
            Ok(())
        })
        .map_err(|e| {
            tracing::error!("DB bulk_update_positions error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    /// Point a task at the calendar event it is scheduled as, or clear the link with
    /// `None`. Separate from `update_task` because `UpdateTaskRecord`'s fields are all
    /// "absent means leave alone", which has no way to say "set this back to NULL".
    pub fn set_task_event(
        &self,
        task_id: &str,
        user_id: &str,
        event_id: Option<&str>,
        now: chrono::NaiveDateTime,
    ) -> Result<TaskRecord, ApiError> {
        let mut conn = self.get_conn()?;
        let affected = diesel::update(
            tasks::table.filter(tasks::id.eq(task_id).and(tasks::user_id.eq(user_id))),
        )
        .set((
            tasks::event_id.eq(event_id.map(|s| s.to_string())),
            tasks::updated_at.eq(now),
        ))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB set task event error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if affected == 0 {
            return Err(ApiError::not_found("Task not found"));
        }
        tasks::table
            .filter(tasks::id.eq(task_id))
            .select(TaskRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get task after set event error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    // ── Task Tags ─────────────────────────────────────────────────────────────

    /// Every tag on every task of `user_id`, for building a listing without a query per task.
    pub fn find_tags_by_user(&self, user_id: &str) -> Result<Vec<TaskTagRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        task_tags::table
            .inner_join(tasks::table)
            .filter(tasks::user_id.eq(user_id))
            .order((task_tags::task_id.asc(), task_tags::tag.asc()))
            .select(TaskTagRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list task tags error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_tags_by_task(&self, task_id: &str) -> Result<Vec<String>, ApiError> {
        let mut conn = self.get_conn()?;
        task_tags::table
            .filter(task_tags::task_id.eq(task_id))
            .order(task_tags::tag.asc())
            .select(task_tags::tag)
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list tags for task error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Make `tags` the task's whole tag set. The caller normalises and de-duplicates them.
    pub fn replace_tags(&self, task_id: &str, tags: &[String]) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<(), diesel::result::Error, _>(|conn| {
            diesel::delete(task_tags::table.filter(task_tags::task_id.eq(task_id)))
                .execute(conn)?;
            let rows: Vec<TaskTagRecord> = tags
                .iter()
                .map(|tag| TaskTagRecord {
                    task_id: task_id.to_string(),
                    tag: tag.clone(),
                })
                .collect();
            diesel::insert_into(task_tags::table)
                .values(&rows)
                .execute(conn)?;
            Ok(())
        })
        .map_err(|e| {
            tracing::error!("DB replace task tags error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    // ── Task Attachments ──────────────────────────────────────────────────────

    pub fn find_attachments_by_task(
        &self,
        task_id: &str,
    ) -> Result<Vec<TaskAttachmentRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        task_attachments::table
            .filter(task_attachments::task_id.eq(task_id))
            .select(TaskAttachmentRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list task attachments error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn insert_attachment(
        &self,
        record: NewTaskAttachmentRecord,
    ) -> Result<TaskAttachmentRecord, ApiError> {
        let id = record.id.clone();
        let mut conn = self.get_conn()?;
        diesel::insert_into(task_attachments::table)
            .values(&record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert task attachment error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        task_attachments::table
            .filter(task_attachments::id.eq(&id))
            .select(TaskAttachmentRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after task attachment insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete_attachment(&self, attachment_id: &str, task_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let affected = diesel::delete(
            task_attachments::table.filter(
                task_attachments::id
                    .eq(attachment_id)
                    .and(task_attachments::task_id.eq(task_id)),
            ),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete task attachment error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if affected == 0 {
            return Err(ApiError::not_found("Attachment not found"));
        }
        Ok(())
    }

    // ── Task List Memberships ─────────────────────────────────────────────────

    pub fn insert_membership(
        &self,
        record: NewTaskListMembershipRecord,
    ) -> Result<TaskListMembershipRecord, ApiError> {
        let task_id = record.task_id.clone();
        let list_id = record.list_id.clone();
        let mut conn = self.get_conn()?;
        diesel::insert_into(task_list_memberships::table)
            .values(&record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert membership error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        task_list_memberships::table
            .filter(
                task_list_memberships::task_id
                    .eq(&task_id)
                    .and(task_list_memberships::list_id.eq(&list_id)),
            )
            .select(TaskListMembershipRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after membership insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn membership_exists(&self, task_id: &str, list_id: &str) -> Result<bool, ApiError> {
        let mut conn = self.get_conn()?;
        let count: i64 = task_list_memberships::table
            .filter(
                task_list_memberships::task_id
                    .eq(task_id)
                    .and(task_list_memberships::list_id.eq(list_id)),
            )
            .count()
            .get_result(&mut conn)
            .map_err(|e| {
                tracing::error!("DB membership exists check error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(count > 0)
    }
}
