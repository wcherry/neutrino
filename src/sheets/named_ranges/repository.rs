use crate::schema::named_ranges;
use crate::shared::ApiError;
use crate::sheets::named_ranges::model::{
    NamedRangeRecord, NewNamedRangeRecord, UpdateNamedRangeRecord,
};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct NamedRangesRepository {
    pool: DbPool,
}

impl NamedRangesRepository {
    pub fn new(pool: DbPool) -> Self {
        NamedRangesRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert(&self, record: NewNamedRangeRecord) -> Result<NamedRangeRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(named_ranges::table)
            .values(&record)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert named_range error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        named_ranges::table
            .filter(named_ranges::id.eq(record.id))
            .select(NamedRangeRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after named_range insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_by_id(&self, id: &str) -> Result<NamedRangeRecord, ApiError> {
        let mut conn = self.get_conn()?;
        named_ranges::table
            .filter(named_ranges::id.eq(id))
            .select(NamedRangeRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Named range not found"),
                _ => {
                    tracing::error!("DB get named_range error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    #[allow(dead_code)]
    pub fn get_by_sheet_db_id(&self, sheet_db_id: &str) -> Result<Vec<NamedRangeRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        named_ranges::table
            .filter(named_ranges::sheet_db_id.eq(sheet_db_id))
            .select(NamedRangeRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list named_ranges error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Shift row bounds of all named ranges in the spreadsheet that are
    /// affected by a row insertion or deletion.
    ///
    /// `at_row` — the 0-based row index where the operation happened.
    /// `delta`  — positive = rows inserted, negative = rows deleted.
    ///
    /// Ranges whose `start_row >= at_row` are shifted entirely.
    /// Ranges that straddle `at_row` have their `end_row` adjusted.
    #[allow(dead_code)]
    pub fn shift_rows(&self, sheet_db_id: &str, at_row: i32, delta: i32) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;

        // Shift ranges that start at or after `at_row`.
        diesel::update(
            named_ranges::table
                .filter(named_ranges::sheet_db_id.eq(sheet_db_id))
                .filter(named_ranges::start_row.ge(at_row)),
        )
        .set((
            named_ranges::start_row.eq(named_ranges::start_row + delta),
            named_ranges::end_row.eq(named_ranges::end_row + delta),
        ))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB shift_rows (full shift) error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        // Expand/shrink ranges that straddle `at_row` (start < at_row <= end).
        diesel::update(
            named_ranges::table
                .filter(named_ranges::sheet_db_id.eq(sheet_db_id))
                .filter(named_ranges::start_row.lt(at_row))
                .filter(named_ranges::end_row.ge(at_row)),
        )
        .set(named_ranges::end_row.eq(named_ranges::end_row + delta))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB shift_rows (partial shift) error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(())
    }

    #[allow(dead_code)]
    pub fn update(
        &self,
        id: &str,
        changes: UpdateNamedRangeRecord,
    ) -> Result<NamedRangeRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(named_ranges::table.filter(named_ranges::id.eq(id)))
            .set(&changes)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update named_range error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        self.get_by_id(id)
    }
}
