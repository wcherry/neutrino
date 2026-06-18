use crate::schema::sheets;
use crate::shared::ApiError;
use crate::sheets::sheets::model::{NewSheetRecord, SheetRecord, UpdateSheetRecord};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct SheetsRepository {
    pool: DbPool,
}

impl SheetsRepository {
    pub fn new(pool: DbPool) -> Self {
        SheetsRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert_sheet(&self, new_sheet: NewSheetRecord) -> Result<SheetRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(sheets::table)
            .values(&new_sheet)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert sheet error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        sheets::table
            .filter(sheets::file_id.eq(new_sheet.file_id))
            .select(SheetRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after sheet insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_sheet(&self, file_id: &str) -> Result<SheetRecord, ApiError> {
        let mut conn = self.get_conn()?;
        sheets::table
            .filter(sheets::file_id.eq(file_id))
            .select(SheetRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Spreadsheet not found"),
                _ => {
                    tracing::error!("DB get sheet error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn update_sheet(
        &self,
        file_id: &str,
        changes: UpdateSheetRecord,
    ) -> Result<SheetRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(sheets::table.filter(sheets::file_id.eq(file_id)))
            .set(&changes)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update sheet error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        self.get_sheet(file_id)
    }
}
