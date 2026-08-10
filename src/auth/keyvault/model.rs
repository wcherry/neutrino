use chrono::NaiveDateTime;
use diesel::prelude::*;

/// A user's wrapped Curve25519 identity key.
///
/// `encrypted_identity` is the secret key under the user's master key (MK);
/// the MK is never stored here — only wrapped per-method in `UserKeyUnlock`.
#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::user_key_vaults)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct UserKeyVault {
    pub user_id: String,
    pub encrypted_identity: String,
    pub public_key: String,
    pub version: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::user_key_vaults)]
pub struct NewUserKeyVault<'a> {
    pub user_id: &'a str,
    pub encrypted_identity: &'a str,
    pub public_key: &'a str,
    pub version: i32,
}

/// One enrolled way to unlock the vault, holding the master key wrapped under
/// that method's key-encryption key.
#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::user_key_unlocks)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct UserKeyUnlock {
    pub id: String,
    pub user_id: String,
    pub method: String,
    pub label: String,
    pub encrypted_master_key: String,
    pub params: String,
    pub created_at: NaiveDateTime,
    pub last_used_at: Option<NaiveDateTime>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::user_key_unlocks)]
pub struct NewUserKeyUnlock<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub method: &'a str,
    pub label: &'a str,
    pub encrypted_master_key: &'a str,
    pub params: &'a str,
}

/// The unlock methods the client understands. Anything else is rejected at the
/// API boundary so a typo can't create an unlock row nothing can ever use.
pub const METHOD_PASSWORD: &str = "password";
pub const METHOD_PASSKEY: &str = "passkey";
pub const METHOD_RECOVERY: &str = "recovery";

pub fn is_valid_method(method: &str) -> bool {
    matches!(
        method,
        METHOD_PASSWORD | METHOD_PASSKEY | METHOD_RECOVERY
    )
}

/// `password` and `recovery` are singletons per user — re-adding replaces the
/// existing row rather than accumulating unusable copies.
pub fn is_singleton_method(method: &str) -> bool {
    matches!(method, METHOD_PASSWORD | METHOD_RECOVERY)
}
