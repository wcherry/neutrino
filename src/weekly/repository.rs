//! Storage for the weekly email: product updates, the per-week send record,
//! and the reads that fill an email. Every method takes its own connection
//! and gives it back before returning.

use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, PooledConnection};
use diesel::sql_types::{BigInt, Text, Timestamp};

use super::model::{NewProductUpdate, ProductUpdateRecord, Recipient, TeamActivity};
use crate::schema::{notifications, product_updates, user_profiles, user_quotas, users, weekly_emails};
use crate::shared::{ApiError, DbPool};

pub struct WeeklyRepository {
    pool: DbPool,
}

/// id, email, name, and the two email settings (`None` without a profile row).
type RecipientRow = (String, String, String, Option<i32>, Option<i32>);

/// An account without a profile row has the defaults, which are on.
fn recipient_of((id, email, name, general, updates): RecipientRow) -> Recipient {
    Recipient {
        id,
        email,
        name,
        general: general.unwrap_or(1) != 0,
        updates: updates.unwrap_or(1) != 0,
    }
}

fn db_err(context: &'static str) -> impl FnOnce(diesel::result::Error) -> ApiError {
    move |e| {
        tracing::error!("DB {} error: {:?}", context, e);
        ApiError::internal("Database error")
    }
}

impl WeeklyRepository {
    pub fn new(pool: DbPool) -> Self {
        WeeklyRepository { pool }
    }

    fn conn(&self) -> Result<PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    // ── Product updates ──────────────────────────────────────────────────────

    /// Every update, drafts first, then newest published first.
    pub fn list_updates(&self) -> Result<Vec<ProductUpdateRecord>, ApiError> {
        let mut rows: Vec<ProductUpdateRecord> = product_updates::table
            .select(ProductUpdateRecord::as_select())
            .load(&mut self.conn()?)
            .map_err(db_err("product update list"))?;
        rows.sort_by(|a, b| match (a.published_at, b.published_at) {
            (None, None) => b.updated_at.cmp(&a.updated_at),
            (None, Some(_)) => std::cmp::Ordering::Less,
            (Some(_), None) => std::cmp::Ordering::Greater,
            (Some(x), Some(y)) => y.cmp(&x),
        });
        Ok(rows)
    }

    pub fn find_update(&self, id: &str) -> Result<Option<ProductUpdateRecord>, ApiError> {
        product_updates::table
            .filter(product_updates::id.eq(id))
            .select(ProductUpdateRecord::as_select())
            .first(&mut self.conn()?)
            .optional()
            .map_err(db_err("product update lookup"))
    }

    pub fn insert_update(&self, row: &NewProductUpdate) -> Result<(), ApiError> {
        diesel::insert_into(product_updates::table)
            .values(row)
            .execute(&mut self.conn()?)
            .map(|_| ())
            .map_err(db_err("product update insert"))
    }

    pub fn edit_update(
        &self,
        id: &str,
        title: &str,
        body: &str,
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        diesel::update(product_updates::table.filter(product_updates::id.eq(id)))
            .set((
                product_updates::title.eq(title),
                product_updates::body.eq(body),
                product_updates::updated_at.eq(now),
            ))
            .execute(&mut self.conn()?)
            .map(|_| ())
            .map_err(db_err("product update edit"))
    }

    /// Stamp `published_at`, or clear it to take the update back to a draft.
    pub fn set_published(&self, id: &str, at: Option<NaiveDateTime>) -> Result<(), ApiError> {
        diesel::update(product_updates::table.filter(product_updates::id.eq(id)))
            .set(product_updates::published_at.eq(at))
            .execute(&mut self.conn()?)
            .map(|_| ())
            .map_err(db_err("product update publish"))
    }

    pub fn delete_update(&self, id: &str) -> Result<usize, ApiError> {
        diesel::delete(product_updates::table.filter(product_updates::id.eq(id)))
            .execute(&mut self.conn()?)
            .map_err(db_err("product update delete"))
    }

    /// Updates published in `[from, to)`, oldest first.
    pub fn published_between(
        &self,
        from: NaiveDateTime,
        to: NaiveDateTime,
    ) -> Result<Vec<ProductUpdateRecord>, ApiError> {
        product_updates::table
            .filter(product_updates::published_at.ge(from))
            .filter(product_updates::published_at.lt(to))
            .order(product_updates::published_at.asc())
            .select(ProductUpdateRecord::as_select())
            .load(&mut self.conn()?)
            .map_err(db_err("product updates published"))
    }

    // ── Recipients and the send record ───────────────────────────────────────

    /// Live, enabled accounts with "General" or "Product updates" email on.
    pub fn recipients(&self) -> Result<Vec<Recipient>, ApiError> {
        let rows: Vec<RecipientRow> = users::table
            .left_join(user_profiles::table)
            .filter(users::deleted_at.is_null())
            .filter(users::disabled_at.is_null())
            .select((
                users::id,
                users::email,
                users::name,
                user_profiles::email_general.nullable(),
                user_profiles::email_updates.nullable(),
            ))
            .load(&mut self.conn()?)
            .map_err(db_err("weekly recipients"))?;
        Ok(rows
            .into_iter()
            .map(recipient_of)
            .filter(|r| r.general || r.updates)
            .collect())
    }

    pub fn recipient(&self, user_id: &str) -> Result<Option<Recipient>, ApiError> {
        let row: Option<RecipientRow> = users::table
            .left_join(user_profiles::table)
            .filter(users::id.eq(user_id))
            .filter(users::deleted_at.is_null())
            .select((
                users::id,
                users::email,
                users::name,
                user_profiles::email_general.nullable(),
                user_profiles::email_updates.nullable(),
            ))
            .first(&mut self.conn()?)
            .optional()
            .map_err(db_err("weekly recipient"))?;
        Ok(row.map(recipient_of))
    }

    /// Claim `week` for the user. `false` when it was claimed already — by an
    /// earlier run, or by another instance running now.
    pub fn claim_week(&self, user_id: &str, week: &str, now: NaiveDateTime) -> Result<bool, ApiError> {
        diesel::insert_or_ignore_into(weekly_emails::table)
            .values((
                weekly_emails::user_id.eq(user_id),
                weekly_emails::week.eq(week),
                weekly_emails::sent_at.eq(now),
            ))
            .execute(&mut self.conn()?)
            .map(|n| n == 1)
            .map_err(db_err("weekly claim"))
    }

    /// Accounts already claimed for `week`.
    pub fn claimed(&self, week: &str) -> Result<Vec<String>, ApiError> {
        weekly_emails::table
            .filter(weekly_emails::week.eq(week))
            .select(weekly_emails::user_id)
            .load(&mut self.conn()?)
            .map_err(db_err("weekly claimed"))
    }

    // ── What fills an email ──────────────────────────────────────────────────

    /// The user's notifications created in `[from, to)`: event type and payload.
    pub fn notifications_between(
        &self,
        user_id: &str,
        from: NaiveDateTime,
        to: NaiveDateTime,
    ) -> Result<Vec<(String, serde_json::Value)>, ApiError> {
        let rows: Vec<(String, String)> = notifications::table
            .filter(notifications::recipient_id.eq(user_id))
            .filter(notifications::created_at.ge(from))
            .filter(notifications::created_at.lt(to))
            .order(notifications::created_at.asc())
            .select((notifications::event_type, notifications::payload))
            .load(&mut self.conn()?)
            .map_err(db_err("weekly notifications"))?;
        Ok(rows
            .into_iter()
            .map(|(t, p)| (t, serde_json::from_str(&p).unwrap_or(serde_json::Value::Null)))
            .collect())
    }

    /// Bytes used and the quota, if the account has a usage row.
    pub fn storage(&self, user_id: &str) -> Result<Option<(i64, Option<i64>)>, ApiError> {
        user_quotas::table
            .filter(user_quotas::user_id.eq(user_id))
            .select((user_quotas::used_bytes, user_quotas::quota_bytes))
            .first(&mut self.conn()?)
            .optional()
            .map_err(db_err("weekly storage"))
    }

    /// Changes other people made in `[from, to)` to the files of each live Team
    /// Space the user belongs to. Teams with no changes are left out.
    pub fn team_activity(
        &self,
        user_id: &str,
        from: NaiveDateTime,
        to: NaiveDateTime,
    ) -> Result<Vec<TeamActivity>, ApiError> {
        #[derive(QueryableByName)]
        struct Row {
            #[diesel(sql_type = Text)]
            team_id: String,
            #[diesel(sql_type = Text)]
            team_name: String,
            #[diesel(sql_type = BigInt)]
            changes: i64,
            #[diesel(sql_type = BigInt)]
            people: i64,
            #[diesel(sql_type = BigInt)]
            files: i64,
        }
        let rows: Vec<Row> = diesel::sql_query(
            "SELECT t.id AS team_id, t.name AS team_name, \
                    COUNT(*) AS changes, \
                    COUNT(DISTINCT l.user_id) AS people, \
                    COUNT(DISTINCT l.file_id) AS files \
             FROM team_members m \
             JOIN teams t ON t.id = m.team_id \
             JOIN files f ON f.team_id = t.id \
             JOIN file_activity_log l ON l.file_id = f.id \
             WHERE m.user_id = ? \
               AND t.deleted_at IS NULL AND t.archived_at IS NULL \
               AND l.user_id <> ? \
               AND l.created_at >= ? AND l.created_at < ? \
             GROUP BY t.id, t.name \
             ORDER BY changes DESC, t.name ASC",
        )
        .bind::<Text, _>(user_id)
        .bind::<Text, _>(user_id)
        .bind::<Timestamp, _>(from)
        .bind::<Timestamp, _>(to)
        .load(&mut self.conn()?)
        .map_err(db_err("weekly team activity"))?;
        Ok(rows
            .into_iter()
            .map(|r| TeamActivity {
                team_id: r.team_id,
                team_name: r.team_name,
                changes: r.changes,
                people: r.people,
                files: r.files,
            })
            .collect())
    }
}
