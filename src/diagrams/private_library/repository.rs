use crate::diagrams::private_library::model::{
    NewThirdPartyLibraryRecord, ThirdPartyLibraryRecord,
};
use crate::schema::diagram_third_party_libraries;
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct PrivateLibraryRepository {
    pool: DbPool,
}

impl PrivateLibraryRepository {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    fn conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool
            .get()
            .map_err(|_| ApiError::internal("DB connection unavailable"))
    }

    pub fn list(&self) -> Result<Vec<ThirdPartyLibraryRecord>, ApiError> {
        let mut conn = self.conn()?;
        diagram_third_party_libraries::table
            .order(diagram_third_party_libraries::created_at.asc())
            .select(ThirdPartyLibraryRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("list private libraries: {:?}", e);
                ApiError::internal("DB error")
            })
    }

    pub fn get_by_id(&self, id: &str) -> Result<ThirdPartyLibraryRecord, ApiError> {
        let mut conn = self.conn()?;
        diagram_third_party_libraries::table
            .filter(diagram_third_party_libraries::id.eq(id))
            .select(ThirdPartyLibraryRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Library not found"),
                _ => {
                    tracing::error!("get private library: {:?}", e);
                    ApiError::internal("DB error")
                }
            })
    }

    pub fn url_exists(&self, url: &str) -> Result<bool, ApiError> {
        let mut conn = self.conn()?;
        let count: i64 = diagram_third_party_libraries::table
            .filter(diagram_third_party_libraries::url.eq(url))
            .count()
            .get_result(&mut conn)
            .map_err(|_| ApiError::internal("DB error"))?;
        Ok(count > 0)
    }

    pub fn insert(
        &self,
        rec: NewThirdPartyLibraryRecord,
    ) -> Result<ThirdPartyLibraryRecord, ApiError> {
        let id = rec.id.to_string();
        let mut conn = self.conn()?;
        diesel::insert_into(diagram_third_party_libraries::table)
            .values(&rec)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("insert private library: {:?}", e);
                ApiError::internal("DB error")
            })?;
        drop(conn);
        self.get_by_id(&id)
    }

    pub fn delete(&self, id: &str) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        let rows = diesel::delete(
            diagram_third_party_libraries::table.filter(diagram_third_party_libraries::id.eq(id)),
        )
        .execute(&mut conn)
        .map_err(|_| ApiError::internal("DB error"))?;
        if rows == 0 {
            return Err(ApiError::not_found("Library not found"));
        }
        Ok(())
    }
}
