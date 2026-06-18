use crate::drawing::drawing::model::{DrawingRecord, NewDrawingRecord, UpdateDrawingRecord};
use crate::schema::drawings;
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct DrawingRepository {
    pool: DbPool,
}

impl DrawingRepository {
    pub fn new(pool: DbPool) -> Self {
        DrawingRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert_drawing(&self, new_drawing: NewDrawingRecord) -> Result<DrawingRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(drawings::table)
            .values(&new_drawing)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert drawing error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        drawings::table
            .filter(drawings::file_id.eq(new_drawing.file_id))
            .select(DrawingRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after drawing insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_drawing(&self, file_id: &str) -> Result<DrawingRecord, ApiError> {
        let mut conn = self.get_conn()?;
        drawings::table
            .filter(drawings::file_id.eq(file_id))
            .select(DrawingRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Drawing not found"),
                _ => {
                    tracing::error!("DB get drawing error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn update_drawing(
        &self,
        file_id: &str,
        changes: UpdateDrawingRecord,
    ) -> Result<DrawingRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(drawings::table.filter(drawings::file_id.eq(file_id)))
            .set(&changes)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update drawing error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        self.get_drawing(file_id)
    }
}
