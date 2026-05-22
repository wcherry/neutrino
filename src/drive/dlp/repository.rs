use crate::shared::ApiError;
use crate::drive::dlp::model::{DlpRule, DlpViolation, NewDlpRule, NewDlpViolation};
use crate::schema::{dlp_rules, dlp_violations};
use chrono::Utc;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct DlpRepository {
    pool: DbPool,
}

impl DlpRepository {
    pub fn new(pool: DbPool) -> Self {
        DlpRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn create_rule(&self, rule: NewDlpRule) -> Result<DlpRule, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(dlp_rules::table)
            .values(&rule)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert dlp rule error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        dlp_rules::table
            .filter(dlp_rules::id.eq(rule.id))
            .select(DlpRule::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_rule_by_id(&self, id: &str) -> Result<Option<DlpRule>, ApiError> {
        let mut conn = self.get_conn()?;
        dlp_rules::table
            .filter(dlp_rules::id.eq(id))
            .select(DlpRule::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB query error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn list_rules(&self) -> Result<Vec<DlpRule>, ApiError> {
        let mut conn = self.get_conn()?;
        dlp_rules::table
            .order(dlp_rules::created_at.desc())
            .select(DlpRule::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list dlp rules error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn list_active_rules(&self) -> Result<Vec<DlpRule>, ApiError> {
        let mut conn = self.get_conn()?;
        dlp_rules::table
            .filter(dlp_rules::is_active.eq(1))
            .select(DlpRule::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list active dlp rules error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete_rule(&self, id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(dlp_rules::table.filter(dlp_rules::id.eq(id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete dlp rule error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    pub fn create_violation(&self, violation: NewDlpViolation) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(dlp_violations::table)
            .values(&violation)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert dlp violation error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    pub fn list_violations(
        &self,
        file_id_filter: Option<&str>,
        page: i64,
        page_size: i64,
    ) -> Result<(Vec<DlpViolation>, i64), ApiError> {
        let mut conn = self.get_conn()?;
        let offset = (page - 1) * page_size;

        let mut query = dlp_violations::table
            .filter(dlp_violations::dismissed_at.is_null())
            .order(dlp_violations::matched_at.desc())
            .into_boxed();

        if let Some(fid) = file_id_filter {
            query = query.filter(dlp_violations::file_id.eq(fid.to_string()));
        }

        let items = query
            .limit(page_size)
            .offset(offset)
            .select(DlpViolation::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list violations error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        let mut count_query = dlp_violations::table
            .filter(dlp_violations::dismissed_at.is_null())
            .into_boxed();
        if let Some(fid) = file_id_filter {
            count_query = count_query.filter(dlp_violations::file_id.eq(fid.to_string()));
        }

        let total: i64 = count_query
            .count()
            .get_result(&mut conn)
            .map_err(|e| {
                tracing::error!("DB count violations error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok((items, total))
    }

    pub fn dismiss_violation(&self, id: &str, dismissed_by: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().naive_utc();
        diesel::update(dlp_violations::table.filter(dlp_violations::id.eq(id)))
            .set((
                dlp_violations::dismissed_at.eq(now),
                dlp_violations::dismissed_by.eq(dismissed_by),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB dismiss violation error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }
}
