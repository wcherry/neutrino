use crate::schema::{files, folders, share_links};
use crate::drive::sharing::model::{NewShareLinkRecord, ShareLinkRecord, UpdateShareLinkRecord};
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct SharingRepository {
    pool: DbPool,
}

impl SharingRepository {
    pub fn new(pool: DbPool) -> Self {
        SharingRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn upsert_share_link(
        &self,
        record: &NewShareLinkRecord,
    ) -> Result<ShareLinkRecord, ApiError> {
        let mut conn = self.get_conn()?;

        // Remove any existing link for this resource
        diesel::delete(
            share_links::table
                .filter(share_links::resource_type.eq(record.resource_type))
                .filter(share_links::resource_id.eq(record.resource_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete old share link error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        diesel::insert_into(share_links::table)
            .values(record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert share link error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        share_links::table
            .filter(share_links::id.eq(record.id))
            .select(ShareLinkRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query share link after insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_by_resource(
        &self,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<Option<ShareLinkRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        share_links::table
            .filter(share_links::resource_type.eq(resource_type))
            .filter(share_links::resource_id.eq(resource_id))
            .select(ShareLinkRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find share link error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_by_token(&self, token: &str) -> Result<Option<ShareLinkRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        share_links::table
            .filter(share_links::token.eq(token))
            .select(ShareLinkRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find share link by token error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update_share_link(
        &self,
        resource_type: &str,
        resource_id: &str,
        changeset: UpdateShareLinkRecord,
    ) -> Result<ShareLinkRecord, ApiError> {
        let mut conn = self.get_conn()?;

        diesel::update(
            share_links::table
                .filter(share_links::resource_type.eq(resource_type))
                .filter(share_links::resource_id.eq(resource_id)),
        )
        .set(&changeset)
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update share link error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        share_links::table
            .filter(share_links::resource_type.eq(resource_type))
            .filter(share_links::resource_id.eq(resource_id))
            .select(ShareLinkRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query share link after update error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete_share_link(
        &self,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(
            share_links::table
                .filter(share_links::resource_type.eq(resource_type))
                .filter(share_links::resource_id.eq(resource_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete share link error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    /// Returns the MIME type of a file resource (None if not a file or not found).
    pub fn get_file_mime_type(&self, file_id: &str) -> Result<Option<String>, ApiError> {
        let mut conn = self.get_conn()?;
        files::table
            .filter(files::id.eq(file_id))
            .select(files::mime_type)
            .first::<String>(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB get file mime_type error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Resolve resource name for a given resource_type and resource_id.
    pub fn get_resource_name(
        &self,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<Option<String>, ApiError> {
        let mut conn = self.get_conn()?;
        match resource_type {
            "file" => files::table
                .filter(files::id.eq(resource_id))
                .select(files::name)
                .first::<String>(&mut conn)
                .optional()
                .map_err(|e| {
                    tracing::error!("DB get file name error: {:?}", e);
                    ApiError::internal("Database error")
                }),
            "folder" => folders::table
                .filter(folders::id.eq(resource_id))
                .select(folders::name)
                .first::<String>(&mut conn)
                .optional()
                .map_err(|e| {
                    tracing::error!("DB get folder name error: {:?}", e);
                    ApiError::internal("Database error")
                }),
            _ => Ok(None),
        }
    }
}
