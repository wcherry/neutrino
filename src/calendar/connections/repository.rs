use crate::calendar::connections::model::{
    ConnectionRecord, NewConnectionRecord, UpdateConnectionTokens, UpdateSyncCursor,
};
use crate::schema::calendar_connections;
use crate::shared::ApiError;
use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct ConnectionsRepository {
    pool: DbPool,
}

impl ConnectionsRepository {
    pub fn new(pool: DbPool) -> Self {
        ConnectionsRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn upsert(&self, record: NewConnectionRecord) -> Result<ConnectionRecord, ApiError> {
        let mut conn = self.get_conn()?;

        // Delete existing connection for this user+provider if any (SQLite lacks UPSERT on unique index cleanly)
        diesel::delete(
            calendar_connections::table.filter(
                calendar_connections::user_id
                    .eq(&record.user_id)
                    .and(calendar_connections::provider.eq(&record.provider)),
            ),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete old connection error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        let id = record.id.clone();
        diesel::insert_into(calendar_connections::table)
            .values(&record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert connection error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        self.find_by_id_internal(&id, &mut conn)
    }

    pub fn find_by_user(&self, user_id: &str) -> Result<Vec<ConnectionRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        calendar_connections::table
            .filter(calendar_connections::user_id.eq(user_id))
            .order(calendar_connections::created_at.asc())
            .select(ConnectionRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list connections error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_by_id(&self, id: &str, user_id: &str) -> Result<ConnectionRecord, ApiError> {
        let mut conn = self.get_conn()?;
        calendar_connections::table
            .filter(
                calendar_connections::id
                    .eq(id)
                    .and(calendar_connections::user_id.eq(user_id)),
            )
            .select(ConnectionRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Connection not found"),
                _ => {
                    tracing::error!("DB get connection error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    #[allow(dead_code)]
    pub fn find_by_user_provider(
        &self,
        user_id: &str,
        provider: &str,
    ) -> Result<Option<ConnectionRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        calendar_connections::table
            .filter(
                calendar_connections::user_id
                    .eq(user_id)
                    .and(calendar_connections::provider.eq(provider)),
            )
            .select(ConnectionRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find connection by provider error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update_tokens(
        &self,
        id: &str,
        access_token: String,
        refresh_token: Option<String>,
        expires_at: Option<NaiveDateTime>,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let changes = UpdateConnectionTokens {
            access_token,
            refresh_token,
            expires_at,
            updated_at: chrono::Utc::now().naive_utc(),
        };
        diesel::update(calendar_connections::table.filter(calendar_connections::id.eq(id)))
            .set(&changes)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update connection tokens error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    pub fn update_sync_cursor(&self, id: &str, cursor: Option<String>) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let changes = UpdateSyncCursor {
            sync_cursor: cursor,
            updated_at: chrono::Utc::now().naive_utc(),
        };
        diesel::update(calendar_connections::table.filter(calendar_connections::id.eq(id)))
            .set(&changes)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update sync cursor error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    pub fn delete(&self, id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let affected = diesel::delete(
            calendar_connections::table.filter(
                calendar_connections::id
                    .eq(id)
                    .and(calendar_connections::user_id.eq(user_id)),
            ),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete connection error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if affected == 0 {
            return Err(ApiError::not_found("Connection not found"));
        }
        Ok(())
    }

    fn find_by_id_internal(
        &self,
        id: &str,
        conn: &mut diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>,
    ) -> Result<ConnectionRecord, ApiError> {
        calendar_connections::table
            .filter(calendar_connections::id.eq(id))
            .select(ConnectionRecord::as_select())
            .first(conn)
            .map_err(|e| {
                tracing::error!("DB query after connection insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }
}
