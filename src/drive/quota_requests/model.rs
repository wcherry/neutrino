use chrono::NaiveDateTime;
use diesel::prelude::*;

/// One user's ask for a bigger storage limit, and what was decided about it.
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::quota_requests)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct QuotaRequestRecord {
    pub id: String,
    pub user_id: String,
    /// The new *total* limit asked for, not an increment — so the row still
    /// means the same thing after the quota moves.
    pub requested_bytes: i64,
    pub reason: Option<String>,
    /// `pending`, `approved` or `denied`.
    pub status: String,
    /// What the admin actually gave, which may be less than was asked for.
    /// `None` until approved.
    pub granted_bytes: Option<i64>,
    pub decision_note: Option<String>,
    /// The admin who decided. Written for the audit trail and read by nothing
    /// yet — the queue shows the decision, not who made it.
    #[allow(dead_code)]
    pub decided_by: Option<String>,
    pub decided_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::quota_requests)]
pub struct NewQuotaRequest<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub requested_bytes: i64,
    pub reason: Option<&'a str>,
    pub status: &'a str,
    pub created_at: NaiveDateTime,
}
