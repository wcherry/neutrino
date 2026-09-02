use chrono::NaiveDateTime;
use diesel::prelude::*;

/// The single password policy row, keyed `'default'`.
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::password_policies)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct PasswordPolicyRecord {
    #[allow(dead_code)]
    pub id: String,
    /// Never below [`super::ABSOLUTE_MIN_LENGTH`].
    pub min_length: i32,
    pub require_uppercase: bool,
    pub require_lowercase: bool,
    pub require_number: bool,
    pub require_symbol: bool,
    /// Days a password stays valid. `0` means passwords never expire on age.
    pub max_age_days: i32,
    pub updated_at: NaiveDateTime,
    /// Characters a password may not contain, held as the characters
    /// themselves. Empty forbids nothing.
    pub forbidden_characters: String,
    /// Consecutive failed sign-ins before the account locks. `0` means never.
    pub lockout_threshold: i32,
    /// How many previous passwords a new one is checked against. `0` means the
    /// reuse check is off.
    pub history_count: i32,
}
