use chrono::NaiveDateTime;
use diesel::prelude::*;

use crate::schema::email_verifications;

/// One row of `email_verifications`. Timestamps are naive UTC.
#[derive(Debug, Clone, PartialEq, Queryable, Selectable)]
#[diesel(table_name = email_verifications)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct EmailVerificationRecord {
    pub id: String,
    pub user_id: String,
    /// The address the link was sent to. A link only verifies the account
    /// while this is still its address.
    pub email: String,
    /// SHA-256 of the token, lower-case hex. The token itself is never stored.
    pub token_hash: String,
    pub created_at: NaiveDateTime,
    pub expires_at: NaiveDateTime,
    pub used_at: Option<NaiveDateTime>,
    /// Set when a newer link replaced this one.
    pub revoked_at: Option<NaiveDateTime>,
}

/// A row to insert into `email_verifications`.
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = email_verifications)]
pub struct NewEmailVerification {
    pub id: String,
    pub user_id: String,
    pub email: String,
    pub token_hash: String,
    pub created_at: NaiveDateTime,
    pub expires_at: NaiveDateTime,
}
