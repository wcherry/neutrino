#![allow(dead_code)]

use crate::docs::permissions::model::{NewPermissionRecord, PermissionRecord};
use crate::schema::{files, folders, permissions};
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct PermissionsRepository {
    pool: DbPool,
}

impl PermissionsRepository {
    pub fn new(pool: DbPool) -> Self {
        PermissionsRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn find_permission(
        &self,
        resource_type: &str,
        resource_id: &str,
        user_id: &str,
    ) -> Result<Option<PermissionRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        permissions::table
            .filter(permissions::resource_type.eq(resource_type))
            .filter(permissions::resource_id.eq(resource_id))
            .filter(permissions::user_id.eq(user_id))
            .select(PermissionRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find permission error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_file_folder_id(&self, file_id: &str) -> Result<Option<String>, ApiError> {
        let mut conn = self.get_conn()?;
        files::table
            .filter(files::id.eq(file_id))
            .select(files::folder_id)
            .first::<Option<String>>(&mut conn)
            .optional()
            .map(|opt| opt.flatten())
            .map_err(|e| {
                tracing::error!("DB get file folder_id error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_folder_parent_id(&self, folder_id: &str) -> Result<Option<String>, ApiError> {
        let mut conn = self.get_conn()?;
        folders::table
            .filter(folders::id.eq(folder_id))
            .select(folders::parent_id)
            .first::<Option<String>>(&mut conn)
            .optional()
            .map(|opt| opt.flatten())
            .map_err(|e| {
                tracing::error!("DB get folder parent_id error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn upsert_permission(
        &self,
        record: &NewPermissionRecord,
    ) -> Result<PermissionRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::sql_query(
            "INSERT OR REPLACE INTO permissions \
             (id, resource_type, resource_id, user_id, role, granted_by, user_email, user_name, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
        )
        .bind::<diesel::sql_types::Text, _>(record.id)
        .bind::<diesel::sql_types::Text, _>(record.resource_type)
        .bind::<diesel::sql_types::Text, _>(record.resource_id)
        .bind::<diesel::sql_types::Text, _>(record.user_id)
        .bind::<diesel::sql_types::Text, _>(record.role)
        .bind::<diesel::sql_types::Text, _>(record.granted_by)
        .bind::<diesel::sql_types::Text, _>(record.user_email)
        .bind::<diesel::sql_types::Text, _>(record.user_name)
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB upsert permission error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        permissions::table
            .filter(permissions::resource_type.eq(record.resource_type))
            .filter(permissions::resource_id.eq(record.resource_id))
            .filter(permissions::user_id.eq(record.user_id))
            .select(PermissionRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after upsert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }
}
