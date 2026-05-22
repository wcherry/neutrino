use crate::shared::ApiError;
use crate::schema::{shared_drive_members, shared_drives};
use crate::drive::shared_drives::model::{NewSharedDrive, NewSharedDriveMember, SharedDrive, SharedDriveMember};
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

    pub fn create(&self, drive: NewSharedDrive) -> Result<SharedDrive, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(shared_drives::table)
            .values(&drive)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert shared drive error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        shared_drives::table
            .filter(shared_drives::id.eq(drive.id))
            .select(SharedDrive::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query error after insert: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<SharedDrive>, ApiError> {
        let mut conn = self.get_conn()?;
        shared_drives::table
            .filter(shared_drives::id.eq(id))
            .select(SharedDrive::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database error")
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

    pub fn update_name_description(
        &self,
        id: &str,
        name: Option<&str>,
        description: Option<Option<&str>>,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let now = chrono::Utc::now().naive_utc();
        if let Some(n) = name {
            diesel::update(shared_drives::table.filter(shared_drives::id.eq(id)))
                .set((shared_drives::name.eq(n), shared_drives::updated_at.eq(now)))
                .execute(&mut conn)
                .map_err(|e| {
                    tracing::error!("DB update error: {:?}", e);
                    ApiError::internal("Database error")
                })?;
        }
        if let Some(desc) = description {
            diesel::update(shared_drives::table.filter(shared_drives::id.eq(id)))
                .set((shared_drives::description.eq(desc), shared_drives::updated_at.eq(now)))
                .execute(&mut conn)
                .map_err(|e| {
                    tracing::error!("DB update error: {:?}", e);
                    ApiError::internal("Database error")
                })?;
        }
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(shared_drives::table.filter(shared_drives::id.eq(id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    pub fn add_member(&self, member: NewSharedDriveMember) -> Result<SharedDriveMember, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(shared_drive_members::table)
            .values(&member)
            .execute(&mut conn)
            .map_err(|e| {
                if let diesel::result::Error::DatabaseError(
                    diesel::result::DatabaseErrorKind::UniqueViolation,
                    _,
                ) = e
                {
                    return ApiError::conflict("User is already a member of this drive");
                }
                tracing::error!("DB insert member error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        shared_drive_members::table
            .filter(shared_drive_members::id.eq(member.id))
            .select(SharedDriveMember::as_select())
            .first(&mut conn)
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

    pub fn list_members(&self, drive_id: &str) -> Result<Vec<SharedDriveMember>, ApiError> {
        let mut conn = self.get_conn()?;
        shared_drive_members::table
            .filter(shared_drive_members::shared_drive_id.eq(drive_id))
            .select(SharedDriveMember::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update_member_role(
        &self,
        drive_id: &str,
        user_id: &str,
        role: &str,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(
            shared_drive_members::table
                .filter(shared_drive_members::shared_drive_id.eq(drive_id))
                .filter(shared_drive_members::user_id.eq(user_id)),
        )
        .set(shared_drive_members::role.eq(role))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update member role error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        Ok(())
    }

    pub fn remove_member(&self, drive_id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(
            shared_drive_members::table
                .filter(shared_drive_members::shared_drive_id.eq(drive_id))
                .filter(shared_drive_members::user_id.eq(user_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete member error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        Ok(())
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

    pub fn count_managers(&self, drive_id: &str) -> Result<i64, ApiError> {
        let mut conn = self.get_conn()?;
        shared_drive_members::table
            .filter(shared_drive_members::shared_drive_id.eq(drive_id))
            .filter(shared_drive_members::role.eq("manager"))
            .count()
            .get_result(&mut conn)
            .map_err(|e| {
                tracing::error!("DB count managers error: {:?}", e);
                ApiError::internal("Database error")
            })
    }
}
