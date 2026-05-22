use crate::drive::workspace::model::{
    NewWorkspaceSettingsRecord, UpdateWorkspaceSettingsRecord, WorkspaceSettingsRecord,
};
use crate::schema::workspace_settings;
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

const SINGLETON_ID: &str = "default";

pub struct WorkspaceRepository {
    pool: DbPool,
}

impl WorkspaceRepository {
    pub fn new(pool: DbPool) -> Self {
        WorkspaceRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    /// Get the singleton workspace settings. Creates default settings if none exist.
    pub fn get_or_create(&self) -> Result<WorkspaceSettingsRecord, ApiError> {
        let mut conn = self.get_conn()?;

        if let Some(record) = workspace_settings::table
            .filter(workspace_settings::id.eq(SINGLETON_ID))
            .select(WorkspaceSettingsRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB get workspace settings error: {:?}", e);
                ApiError::internal("Database error")
            })?
        {
            return Ok(record);
        }

        let new_record = NewWorkspaceSettingsRecord {
            id: SINGLETON_ID,
            allowed_domain: None,
            restrict_shares_to_domain: false,
            block_external_link_sharing: false,
            domain_only_links: false,
        };

        diesel::insert_into(workspace_settings::table)
            .values(&new_record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert workspace settings error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        workspace_settings::table
            .filter(workspace_settings::id.eq(SINGLETON_ID))
            .select(WorkspaceSettingsRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query workspace settings after insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update(
        &self,
        changeset: UpdateWorkspaceSettingsRecord,
    ) -> Result<WorkspaceSettingsRecord, ApiError> {
        let mut conn = self.get_conn()?;

        // Ensure it exists before updating
        self.get_or_create()?;

        diesel::update(workspace_settings::table.filter(workspace_settings::id.eq(SINGLETON_ID)))
            .set(&changeset)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update workspace settings error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        workspace_settings::table
            .filter(workspace_settings::id.eq(SINGLETON_ID))
            .select(WorkspaceSettingsRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query workspace settings after update error: {:?}", e);
                ApiError::internal("Database error")
            })
    }
}
