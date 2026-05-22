use crate::shared::{ApiError, DbPool};
use crate::schema::{task_list_memberships, task_lists, tasks};
use crate::calendar::tasks::model::{
    NewTaskListMembershipRecord, NewTaskListRecord, NewTaskRecord, TaskListMembershipRecord,
    TaskListRecord, TaskRecord, UpdateTaskListRecord, UpdateTaskRecord,
};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager};

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

    pub fn update(
        &self,
        id: &str,
        user_id: &str,
        changes: UpdateTaskListRecord,
    ) -> Result<TaskListRecord, ApiError> {
        let mut conn = self.get_conn()?;
        let affected = diesel::update(
            task_lists::table
                .filter(task_lists::id.eq(id).and(task_lists::user_id.eq(user_id))),
        )
        .set(&changes)
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update task_list error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if affected == 0 {
            return Err(ApiError::not_found("Task list not found"));
        }
        task_lists::table
            .filter(task_lists::id.eq(id))
            .select(TaskListRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get task_list after update error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete(&self, id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let affected = diesel::delete(
            task_lists::table
                .filter(task_lists::id.eq(id).and(task_lists::user_id.eq(user_id))),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete task_list error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if affected == 0 {
            return Err(ApiError::not_found("Task list not found"));
        }
        Ok(())
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
                task_list_memberships::table
                    .on(task_list_memberships::task_id.eq(tasks::id)),
            )
            .filter(tasks::user_id.eq(user_id))
            .order((tasks::position.asc(), tasks::created_at.asc()))
            .select((TaskRecord::as_select(), task_list_memberships::list_id.nullable()))
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
                task_list_memberships::table
                    .on(task_list_memberships::task_id.eq(tasks::id)),
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
        let affected = diesel::update(
            tasks::table.filter(tasks::id.eq(id).and(tasks::user_id.eq(user_id))),
        )
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

    pub fn bulk_insert_tasks_with_memberships(
        &self,
        task_records: Vec<NewTaskRecord>,
        membership_records: Vec<NewTaskListMembershipRecord>,
    ) -> Result<Vec<TaskRecord>, ApiError> {
        let ids: Vec<String> = task_records.iter().map(|r| r.id.clone()).collect();
        let mut conn = self.get_conn()?;
        conn.transaction::<Vec<TaskRecord>, diesel::result::Error, _>(|conn| {
            diesel::insert_into(tasks::table)
                .values(&task_records)
                .execute(conn)?;
            diesel::insert_into(task_list_memberships::table)
                .values(&membership_records)
                .execute(conn)?;
            tasks::table
                .filter(tasks::id.eq_any(&ids))
                .order((tasks::position.asc(), tasks::created_at.asc()))
                .select(TaskRecord::as_select())
                .load(conn)
        })
        .map_err(|e| {
            tracing::error!("DB bulk_insert_tasks_with_memberships error: {:?}", e);
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
                    tasks::table
                        .filter(tasks::id.eq(id).and(tasks::user_id.eq(user_id))),
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

    pub fn delete_task(&self, id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let affected = diesel::delete(
            tasks::table.filter(tasks::id.eq(id).and(tasks::user_id.eq(user_id))),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete task error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if affected == 0 {
            return Err(ApiError::not_found("Task not found"));
        }
        Ok(())
    }

    pub fn delete_memberships_by_list(&self, list_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(
            task_list_memberships::table
                .filter(task_list_memberships::list_id.eq(list_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete memberships by list error: {:?}", e);
            ApiError::internal("Database error")
        })?;
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

    pub fn delete_membership(&self, task_id: &str, list_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let affected = diesel::delete(
            task_list_memberships::table.filter(
                task_list_memberships::task_id
                    .eq(task_id)
                    .and(task_list_memberships::list_id.eq(list_id)),
            ),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete membership error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if affected == 0 {
            return Err(ApiError::not_found("Membership not found"));
        }
        Ok(())
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
