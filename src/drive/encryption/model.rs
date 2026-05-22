use chrono::NaiveDateTime;
use diesel::prelude::*;

/// A per-user encrypted file DEK stored on the server.
/// The `encrypted_file_key` is the DEK sealed with the user's Curve25519
/// public key (libsodium `crypto_box_seal`), base64url-encoded.
#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::file_key_refs)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct FileKeyRef {
    pub id: String,
    pub file_id: String,
    pub user_id: String,
    pub encrypted_file_key: String,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::file_key_refs)]
pub struct NewFileKeyRef<'a> {
    pub id: &'a str,
    pub file_id: &'a str,
    pub user_id: &'a str,
    pub encrypted_file_key: &'a str,
}
