//! Storage for `signup_events`, and the admin queries over sign-ups.
//!
//! Every method takes its own connection and gives it back before returning,
//! so callers can chain them on a one-connection pool.

use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, PooledConnection};
use diesel::sql_types::{BigInt, Nullable, Text, Timestamp};

use crate::schema::{refresh_tokens, signup_events, users};
use crate::shared::{ApiError, DbPool};

#[derive(Insertable)]
#[diesel(table_name = signup_events)]
pub struct NewSignupEvent<'a> {
    pub id: &'a str,
    pub user_id: Option<&'a str>,
    pub ip: &'a str,
    pub email_domain: &'a str,
    pub human_verified: i32,
    pub created_at: NaiveDateTime,
}

/// A count of sign-ups grouped by one key.
#[derive(QueryableByName, Debug, Clone)]
pub struct GroupCount {
    #[diesel(sql_type = Text)]
    pub key: String,
    #[diesel(sql_type = BigInt)]
    pub total: i64,
    #[diesel(sql_type = BigInt)]
    pub unverified: i64,
}

/// An account matched by a bulk-delete filter.
#[derive(QueryableByName, Debug, Clone)]
pub struct MatchedUser {
    #[diesel(sql_type = Text)]
    pub id: String,
    #[diesel(sql_type = Text)]
    pub email: String,
    #[diesel(sql_type = Text)]
    pub name: String,
    #[diesel(sql_type = Timestamp)]
    pub created_at: NaiveDateTime,
    #[diesel(sql_type = Nullable<Timestamp>)]
    pub email_verified_at: Option<NaiveDateTime>,
    #[diesel(sql_type = Nullable<Text>)]
    pub ip: Option<String>,
}

/// Which accounts a bulk delete takes. Each `Some` narrows the match.
#[derive(Debug, Clone, Default)]
pub struct UserFilter {
    pub ip: Option<String>,
    pub email_domain: Option<String>,
    pub created_after: Option<NaiveDateTime>,
    pub created_before: Option<NaiveDateTime>,
    pub include_verified: bool,
}

#[derive(QueryableByName)]
struct Count {
    #[diesel(sql_type = BigInt)]
    n: i64,
}

fn db_err(context: &'static str) -> impl FnOnce(diesel::result::Error) -> ApiError {
    move |e| {
        tracing::error!("DB {} error: {:?}", context, e);
        ApiError::internal("Database error")
    }
}

/// `lower(domain of users.email)` in SQLite.
const DOMAIN_SQL: &str = "lower(substr(u.email, instr(u.email, '@') + 1))";

pub struct SignupGuardRepository {
    pool: DbPool,
}

impl SignupGuardRepository {
    pub fn new(pool: DbPool) -> Self {
        SignupGuardRepository { pool }
    }

    fn conn(&self) -> Result<PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert(&self, event: NewSignupEvent) -> Result<(), ApiError> {
        diesel::insert_into(signup_events::table)
            .values(&event)
            .execute(&mut self.conn()?)
            .map(|_| ())
            .map_err(db_err("signup event insert"))
    }

    pub fn delete(&self, id: &str) -> Result<(), ApiError> {
        diesel::delete(signup_events::table.filter(signup_events::id.eq(id)))
            .execute(&mut self.conn()?)
            .map(|_| ())
            .map_err(db_err("signup event delete"))
    }

    pub fn attach_user(&self, id: &str, user_id: &str) -> Result<(), ApiError> {
        diesel::update(signup_events::table.filter(signup_events::id.eq(id)))
            .set(signup_events::user_id.eq(user_id))
            .execute(&mut self.conn()?)
            .map(|_| ())
            .map_err(db_err("signup event update"))
    }

    /// Sign-ups at or after `since`, optionally from one IP and optionally only
    /// those not human-verified.
    pub fn count_since(
        &self,
        since: NaiveDateTime,
        ip: Option<&str>,
        unverified_only: bool,
    ) -> Result<i64, ApiError> {
        let mut q = signup_events::table
            .filter(signup_events::created_at.ge(since))
            .into_boxed();
        if let Some(ip) = ip {
            q = q.filter(signup_events::ip.eq(ip.to_string()));
        }
        if unverified_only {
            q = q.filter(signup_events::human_verified.eq(0));
        }
        q.count()
            .get_result(&mut self.conn()?)
            .map_err(db_err("signup event count"))
    }

    /// The busiest sign-up IPs since `since`.
    pub fn top_ips(&self, since: NaiveDateTime, limit: i64) -> Result<Vec<GroupCount>, ApiError> {
        diesel::sql_query(
            "SELECT e.ip AS key, COUNT(*) AS total, \
                    SUM(CASE WHEN u.email_verified_at IS NULL THEN 1 ELSE 0 END) AS unverified \
             FROM signup_events e JOIN users u ON u.id = e.user_id \
             WHERE e.created_at >= ? AND u.deleted_at IS NULL \
             GROUP BY e.ip ORDER BY total DESC LIMIT ?",
        )
        .bind::<Timestamp, _>(since)
        .bind::<BigInt, _>(limit)
        .load(&mut self.conn()?)
        .map_err(db_err("signup top ips"))
    }

    /// The busiest email domains among accounts created since `since`. Reads
    /// `users`, so it covers accounts made before sign-up events were kept.
    pub fn top_domains(
        &self,
        since: NaiveDateTime,
        limit: i64,
    ) -> Result<Vec<GroupCount>, ApiError> {
        diesel::sql_query(format!(
            "SELECT {DOMAIN_SQL} AS key, COUNT(*) AS total, \
                    SUM(CASE WHEN u.email_verified_at IS NULL THEN 1 ELSE 0 END) AS unverified \
             FROM users u WHERE u.created_at >= ? AND u.deleted_at IS NULL \
             GROUP BY key ORDER BY total DESC LIMIT ?"
        ))
        .bind::<Timestamp, _>(since)
        .bind::<BigInt, _>(limit)
        .load(&mut self.conn()?)
        .map_err(db_err("signup top domains"))
    }

    /// Live accounts created since `since`, and how many of them are unverified.
    pub fn created_since(&self, since: NaiveDateTime) -> Result<(i64, i64), ApiError> {
        let mut conn = self.conn()?;
        let total = users::table
            .filter(users::created_at.ge(since))
            .filter(users::deleted_at.is_null())
            .count()
            .get_result(&mut conn)
            .map_err(db_err("signup totals"))?;
        let unverified = users::table
            .filter(users::created_at.ge(since))
            .filter(users::deleted_at.is_null())
            .filter(users::email_verified_at.is_null())
            .count()
            .get_result(&mut conn)
            .map_err(db_err("signup totals"))?;
        Ok((total, unverified))
    }

    /// The SQL `WHERE` for a bulk-delete filter, and its bound values in order.
    /// Admins and `exclude_id` are never matched.
    fn filter_sql(filter: &UserFilter, exclude_id: &str) -> (String, Vec<FilterValue>) {
        let mut sql = String::from(
            "u.deleted_at IS NULL AND u.role != 'admin' AND u.id != ?",
        );
        let mut binds = vec![FilterValue::Text(exclude_id.to_string())];
        if !filter.include_verified {
            sql.push_str(" AND u.email_verified_at IS NULL");
        }
        if let Some(ip) = &filter.ip {
            sql.push_str(" AND e.ip = ?");
            binds.push(FilterValue::Text(ip.clone()));
        }
        if let Some(domain) = &filter.email_domain {
            sql.push_str(&format!(" AND {DOMAIN_SQL} = ?"));
            binds.push(FilterValue::Text(domain.to_ascii_lowercase()));
        }
        if let Some(after) = filter.created_after {
            sql.push_str(" AND u.created_at >= ?");
            binds.push(FilterValue::Time(after));
        }
        if let Some(before) = filter.created_before {
            sql.push_str(" AND u.created_at < ?");
            binds.push(FilterValue::Time(before));
        }
        (sql, binds)
    }

    /// How many live accounts match, and the first `sample` of them, newest first.
    pub fn match_users(
        &self,
        filter: &UserFilter,
        exclude_id: &str,
        sample: i64,
    ) -> Result<(i64, Vec<MatchedUser>), ApiError> {
        let (where_sql, binds) = Self::filter_sql(filter, exclude_id);
        let from = "FROM users u LEFT JOIN signup_events e ON e.user_id = u.id";
        let mut conn = self.conn()?;

        let count_q = format!("SELECT COUNT(*) AS n {from} WHERE {where_sql}");
        let n = bind_all(diesel::sql_query(count_q).into_boxed(), &binds)
            .get_result::<Count>(&mut conn)
            .map_err(db_err("bulk delete count"))?
            .n;

        let rows_q = format!(
            "SELECT u.id, u.email, u.name, u.created_at, u.email_verified_at, e.ip \
             {from} WHERE {where_sql} ORDER BY u.created_at DESC LIMIT ?"
        );
        let rows = bind_all(diesel::sql_query(rows_q).into_boxed(), &binds)
            .bind::<BigInt, _>(sample)
            .load::<MatchedUser>(&mut conn)
            .map_err(db_err("bulk delete match"))?;
        Ok((n, rows))
    }

    /// Soft-deletes every matching account and drops its refresh tokens, in one
    /// transaction. Returns how many were deleted.
    pub fn soft_delete_matching(
        &self,
        filter: &UserFilter,
        exclude_id: &str,
        now: NaiveDateTime,
    ) -> Result<usize, ApiError> {
        let (where_sql, binds) = Self::filter_sql(filter, exclude_id);
        let mut conn = self.conn()?;
        conn.transaction::<usize, diesel::result::Error, _>(|conn| {
            #[derive(QueryableByName)]
            struct Id {
                #[diesel(sql_type = Text)]
                id: String,
            }
            let q = format!(
                "SELECT u.id FROM users u LEFT JOIN signup_events e ON e.user_id = u.id \
                 WHERE {where_sql}"
            );
            let ids: Vec<String> = bind_all(diesel::sql_query(q).into_boxed(), &binds)
                .load::<Id>(conn)?
                .into_iter()
                .map(|r| r.id)
                .collect();
            for chunk in ids.chunks(500) {
                diesel::update(users::table.filter(users::id.eq_any(chunk)))
                    .set(users::deleted_at.eq(now))
                    .execute(conn)?;
                diesel::delete(refresh_tokens::table.filter(refresh_tokens::user_id.eq_any(chunk)))
                    .execute(conn)?;
            }
            Ok(ids.len())
        })
        .map_err(db_err("bulk delete"))
    }
}

enum FilterValue {
    Text(String),
    Time(NaiveDateTime),
}

fn bind_all<'a>(
    mut q: diesel::query_builder::BoxedSqlQuery<'a, diesel::sqlite::Sqlite, diesel::query_builder::SqlQuery>,
    binds: &[FilterValue],
) -> diesel::query_builder::BoxedSqlQuery<'a, diesel::sqlite::Sqlite, diesel::query_builder::SqlQuery> {
    for b in binds {
        q = match b {
            FilterValue::Text(s) => q.bind::<Text, _>(s.clone()),
            FilterValue::Time(t) => q.bind::<Timestamp, _>(*t),
        };
    }
    q
}
