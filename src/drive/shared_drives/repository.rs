use crate::drive::shared_drives::model::{SharedDrive, SharedDriveMember};
use crate::schema::{shared_drive_members, shared_drives};
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct SharedDrivesRepository {
    pool: DbPool,
}

impl SharedDrivesRepository {
    pub fn new(pool: DbPool) -> Self {
        SharedDrivesRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn list_for_user(&self, user_id: &str) -> Result<Vec<SharedDrive>, ApiError> {
        let mut conn = self.get_conn()?;
        // Get drives where user is a member
        let drive_ids: Vec<String> = shared_drive_members::table
            .filter(shared_drive_members::user_id.eq(user_id))
            .select(shared_drive_members::shared_drive_id)
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        shared_drives::table
            .filter(shared_drives::id.eq_any(drive_ids))
            .select(SharedDrive::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_member(
        &self,
        drive_id: &str,
        user_id: &str,
    ) -> Result<Option<SharedDriveMember>, ApiError> {
        let mut conn = self.get_conn()?;
        shared_drive_members::table
            .filter(shared_drive_members::shared_drive_id.eq(drive_id))
            .filter(shared_drive_members::user_id.eq(user_id))
            .select(SharedDriveMember::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn count_members(&self, drive_id: &str) -> Result<i64, ApiError> {
        let mut conn = self.get_conn()?;
        shared_drive_members::table
            .filter(shared_drive_members::shared_drive_id.eq(drive_id))
            .count()
            .get_result(&mut conn)
            .map_err(|e| {
                tracing::error!("DB count members error: {:?}", e);
                ApiError::internal("Database error")
            })
    }
}
