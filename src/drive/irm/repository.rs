use crate::drive::irm::model::{IrmPolicyRecord, NewIrmPolicyRecord, UpdateIrmPolicyRecord};
use crate::schema::irm_policies;
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct IrmRepository {
    pool: DbPool,
}

impl IrmRepository {
    pub fn new(pool: DbPool) -> Self {
        IrmRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn find_by_resource(
        &self,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<Option<IrmPolicyRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        irm_policies::table
            .filter(irm_policies::resource_type.eq(resource_type))
            .filter(irm_policies::resource_id.eq(resource_id))
            .select(IrmPolicyRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find IRM policy error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn upsert_policy(&self, record: &NewIrmPolicyRecord) -> Result<IrmPolicyRecord, ApiError> {
        let mut conn = self.get_conn()?;

        // Remove existing policy for this resource
        diesel::delete(
            irm_policies::table
                .filter(irm_policies::resource_type.eq(record.resource_type))
                .filter(irm_policies::resource_id.eq(record.resource_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete old IRM policy error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        diesel::insert_into(irm_policies::table)
            .values(record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert IRM policy error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        irm_policies::table
            .filter(irm_policies::id.eq(record.id))
            .select(IrmPolicyRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query IRM policy after insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    #[allow(dead_code)]
    pub fn update_policy(
        &self,
        resource_type: &str,
        resource_id: &str,
        changeset: UpdateIrmPolicyRecord,
    ) -> Result<IrmPolicyRecord, ApiError> {
        let mut conn = self.get_conn()?;

        diesel::update(
            irm_policies::table
                .filter(irm_policies::resource_type.eq(resource_type))
                .filter(irm_policies::resource_id.eq(resource_id)),
        )
        .set(&changeset)
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update IRM policy error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        irm_policies::table
            .filter(irm_policies::resource_type.eq(resource_type))
            .filter(irm_policies::resource_id.eq(resource_id))
            .select(IrmPolicyRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query IRM policy after update error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete_policy(&self, resource_type: &str, resource_id: &str) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(
            irm_policies::table
                .filter(irm_policies::resource_type.eq(resource_type))
                .filter(irm_policies::resource_id.eq(resource_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete IRM policy error: {:?}", e);
            ApiError::internal("Database error")
        })
    }
}
