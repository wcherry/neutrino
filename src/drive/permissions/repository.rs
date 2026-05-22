use crate::drive::permissions::model::{NewPermissionRecord, PermissionRecord};
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

    /// Insert or replace a permission for a user on a resource.
    pub fn upsert_permission(
        &self,
        record: &NewPermissionRecord,
    ) -> Result<PermissionRecord, ApiError> {
        let mut conn = self.get_conn()?;

        // Remove any existing permission for this user+resource first
        diesel::delete(
            permissions::table
                .filter(permissions::resource_type.eq(record.resource_type))
                .filter(permissions::resource_id.eq(record.resource_id))
                .filter(permissions::user_id.eq(record.user_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete old permission error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        diesel::insert_into(permissions::table)
            .values(record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert permission error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        permissions::table
            .filter(permissions::id.eq(record.id))
            .select(PermissionRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query permission after insert error: {:?}", e);
                ApiError::internal("Database error")
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

    pub fn list_permissions(
        &self,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<Vec<PermissionRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        permissions::table
            .filter(permissions::resource_type.eq(resource_type))
            .filter(permissions::resource_id.eq(resource_id))
            .select(PermissionRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list permissions error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update_permission_role(
        &self,
        resource_type: &str,
        resource_id: &str,
        user_id: &str,
        role: &str,
    ) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(
            permissions::table
                .filter(permissions::resource_type.eq(resource_type))
                .filter(permissions::resource_id.eq(resource_id))
                .filter(permissions::user_id.eq(user_id)),
        )
        .set(permissions::role.eq(role))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update permission role error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    pub fn delete_permission(
        &self,
        resource_type: &str,
        resource_id: &str,
        user_id: &str,
    ) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(
            permissions::table
                .filter(permissions::resource_type.eq(resource_type))
                .filter(permissions::resource_id.eq(resource_id))
                .filter(permissions::user_id.eq(user_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete permission error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    pub fn count_owners(&self, resource_type: &str, resource_id: &str) -> Result<i64, ApiError> {
        let mut conn = self.get_conn()?;
        permissions::table
            .filter(permissions::resource_type.eq(resource_type))
            .filter(permissions::resource_id.eq(resource_id))
            .filter(permissions::role.eq("owner"))
            .count()
            .get_result(&mut conn)
            .map_err(|e| {
                tracing::error!("DB count owners error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Returns the folder_id of a file (for inheritance walking).
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

    /// Returns the parent_id of a folder (for inheritance walking).
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

    /// Returns all resource IDs of the given type where the user has owner role.
    pub fn list_owned_resource_ids(
        &self,
        user_id: &str,
        resource_type: &str,
    ) -> Result<Vec<String>, ApiError> {
        let mut conn = self.get_conn()?;
        permissions::table
            .filter(permissions::user_id.eq(user_id))
            .filter(permissions::resource_type.eq(resource_type))
            .filter(permissions::role.eq("owner"))
            .select(permissions::resource_id)
            .load::<String>(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list owned resource IDs error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Returns all permissions for the current user on resources they do NOT own
    /// (for "shared with me" view). Returns (resource_type, resource_id, role).
    pub fn list_shared_with_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<crate::drive::permissions::model::PermissionRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        permissions::table
            .filter(permissions::user_id.eq(user_id))
            .filter(permissions::role.ne("owner"))
            .select(crate::drive::permissions::model::PermissionRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list shared with user error: {:?}", e);
                ApiError::internal("Database error")
            })
    }
}
