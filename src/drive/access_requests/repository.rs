use crate::drive::access_requests::model::{AccessRequestRecord, NewAccessRequestRecord};
use crate::schema::access_requests;
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct AccessRequestsRepository {
    pool: DbPool,
}

impl AccessRequestsRepository {
    pub fn new(pool: DbPool) -> Self {
        AccessRequestsRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn create(
        &self,
        record: &NewAccessRequestRecord,
    ) -> Result<AccessRequestRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(access_requests::table)
            .values(record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert access request error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        access_requests::table
            .filter(access_requests::id.eq(record.id))
            .select(AccessRequestRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query access request after insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<AccessRequestRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        access_requests::table
            .filter(access_requests::id.eq(id))
            .select(AccessRequestRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find access request error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// List pending requests for a specific resource.
    #[allow(dead_code)]
    pub fn list_for_resource(
        &self,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<Vec<AccessRequestRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        access_requests::table
            .filter(access_requests::resource_type.eq(resource_type))
            .filter(access_requests::resource_id.eq(resource_id))
            .filter(access_requests::status.eq("pending"))
            .select(AccessRequestRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list access requests error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// List all pending requests for resources owned by a user (by matching resource IDs in permissions).
    pub fn list_pending_for_user_resources(
        &self,
        owner_resource_ids: &[String],
        owner_resource_type: &str,
    ) -> Result<Vec<AccessRequestRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        access_requests::table
            .filter(access_requests::resource_type.eq(owner_resource_type))
            .filter(access_requests::resource_id.eq_any(owner_resource_ids))
            .filter(access_requests::status.eq("pending"))
            .select(AccessRequestRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list pending access requests error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update_status(
        &self,
        id: &str,
        status: &str,
    ) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(access_requests::table.filter(access_requests::id.eq(id)))
            .set((
                access_requests::status.eq(status),
                access_requests::updated_at.eq(diesel::dsl::now),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update access request status error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Check if a pending request already exists for this requester on this resource.
    pub fn find_pending(
        &self,
        resource_type: &str,
        resource_id: &str,
        requester_id: &str,
    ) -> Result<Option<AccessRequestRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        access_requests::table
            .filter(access_requests::resource_type.eq(resource_type))
            .filter(access_requests::resource_id.eq(resource_id))
            .filter(access_requests::requester_id.eq(requester_id))
            .filter(access_requests::status.eq("pending"))
            .select(AccessRequestRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find pending access request error: {:?}", e);
                ApiError::internal("Database error")
            })
    }
}
