#![allow(dead_code)]

use crate::drive::compliance::model::{
    FileLegalHold, LegalHold, NewFileLegalHold, NewLegalHold, NewRetentionPolicy, RetentionPolicy,
};
use crate::schema::{file_legal_holds, legal_holds, retention_policies};
use crate::shared::ApiError;
use chrono::Utc;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct ComplianceRepository {
    pool: DbPool,
}

impl ComplianceRepository {
    pub fn new(pool: DbPool) -> Self {
        ComplianceRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    // Legal Holds
    pub fn create_hold(&self, hold: NewLegalHold) -> Result<LegalHold, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(legal_holds::table)
            .values(&hold)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert legal hold error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        legal_holds::table
            .filter(legal_holds::id.eq(hold.id))
            .select(LegalHold::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_hold_by_id(&self, id: &str) -> Result<Option<LegalHold>, ApiError> {
        let mut conn = self.get_conn()?;
        legal_holds::table
            .filter(legal_holds::id.eq(id))
            .select(LegalHold::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn list_holds(&self) -> Result<Vec<LegalHold>, ApiError> {
        let mut conn = self.get_conn()?;
        legal_holds::table
            .order(legal_holds::created_at.desc())
            .select(LegalHold::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list legal holds error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update_hold(
        &self,
        id: &str,
        name: Option<&str>,
        description: Option<Option<&str>>,
        custodian_ids: Option<&str>,
        is_active: Option<i32>,
    ) -> Result<LegalHold, ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().naive_utc();

        if let Some(n) = name {
            diesel::update(legal_holds::table.filter(legal_holds::id.eq(id)))
                .set((legal_holds::name.eq(n), legal_holds::updated_at.eq(now)))
                .execute(&mut conn)
                .map_err(|_| ApiError::internal("Database error"))?;
        }
        if let Some(d) = description {
            diesel::update(legal_holds::table.filter(legal_holds::id.eq(id)))
                .set((
                    legal_holds::description.eq(d),
                    legal_holds::updated_at.eq(now),
                ))
                .execute(&mut conn)
                .map_err(|_| ApiError::internal("Database error"))?;
        }
        if let Some(c) = custodian_ids {
            diesel::update(legal_holds::table.filter(legal_holds::id.eq(id)))
                .set((
                    legal_holds::custodian_ids.eq(c),
                    legal_holds::updated_at.eq(now),
                ))
                .execute(&mut conn)
                .map_err(|_| ApiError::internal("Database error"))?;
        }
        if let Some(a) = is_active {
            diesel::update(legal_holds::table.filter(legal_holds::id.eq(id)))
                .set((
                    legal_holds::is_active.eq(a),
                    legal_holds::updated_at.eq(now),
                ))
                .execute(&mut conn)
                .map_err(|_| ApiError::internal("Database error"))?;
        }

        legal_holds::table
            .filter(legal_holds::id.eq(id))
            .select(LegalHold::as_select())
            .first(&mut conn)
            .map_err(|_| ApiError::internal("Database error"))
    }

    pub fn delete_hold(&self, id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(legal_holds::table.filter(legal_holds::id.eq(id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete legal hold error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    pub fn apply_hold_to_file(&self, entry: NewFileLegalHold) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_or_ignore_into(file_legal_holds::table)
            .values(&entry)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert file legal hold error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    pub fn remove_hold_from_file(&self, file_id: &str, hold_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(
            file_legal_holds::table
                .filter(file_legal_holds::file_id.eq(file_id))
                .filter(file_legal_holds::hold_id.eq(hold_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete file legal hold error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        Ok(())
    }

    pub fn list_holds_for_file(&self, file_id: &str) -> Result<Vec<FileLegalHold>, ApiError> {
        let mut conn = self.get_conn()?;
        file_legal_holds::table
            .filter(file_legal_holds::file_id.eq(file_id))
            .select(FileLegalHold::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list file legal holds error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    // Retention Policies
    pub fn create_policy(&self, policy: NewRetentionPolicy) -> Result<RetentionPolicy, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(retention_policies::table)
            .values(&policy)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert retention policy error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        retention_policies::table
            .filter(retention_policies::id.eq(policy.id))
            .select(RetentionPolicy::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_policy_by_id(&self, id: &str) -> Result<Option<RetentionPolicy>, ApiError> {
        let mut conn = self.get_conn()?;
        retention_policies::table
            .filter(retention_policies::id.eq(id))
            .select(RetentionPolicy::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn list_policies(&self) -> Result<Vec<RetentionPolicy>, ApiError> {
        let mut conn = self.get_conn()?;
        retention_policies::table
            .order(retention_policies::created_at.desc())
            .select(RetentionPolicy::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list retention policies error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete_policy(&self, id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(retention_policies::table.filter(retention_policies::id.eq(id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete retention policy error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }
}
