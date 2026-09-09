//! Reads against the app's SQLite file.
//!
//! Every query here is a `SELECT`. The tool never writes: recovering a file
//! must not be able to damage the account it is recovering from, and a
//! read-only process is the cheapest way to guarantee that.

use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::schema::{file_key_refs, file_versions, files, user_public_keys, users};

pub struct FileRow {
    pub id: String,
    pub owner_id: String,
    /// The name as the server knows it. Uploads send the real filename
    /// alongside the ciphertext, so this is usually right — but
    /// `encrypted_metadata` is the authoritative copy and the only one the
    /// server could not have altered.
    pub name: String,
    pub size_bytes: i64,
    pub mime_type: String,
    pub storage_path: String,
    pub encrypted_metadata: Option<String>,
    pub deleted_at: Option<NaiveDateTime>,
}

pub struct KeyRef {
    pub user_id: String,
    pub encrypted_file_key: String,
    pub key_version: i32,
}

pub struct VersionRow {
    pub id: String,
    pub version_number: i32,
    pub size_bytes: i64,
    pub storage_path: String,
    pub label: Option<String>,
    pub created_at: NaiveDateTime,
}

pub struct PublicKeyRow {
    pub version: i32,
    pub public_key: String,
    pub retired_at: Option<NaiveDateTime>,
}

pub fn connect(database_url: &str) -> Result<SqliteConnection, String> {
    let mut conn = SqliteConnection::establish(database_url)
        .map_err(|e| format!("cannot open the database at {database_url}: {e}"))?;
    // The app may well be running against this same file. Wait rather than
    // failing the moment a writer holds the lock.
    diesel::sql_query("PRAGMA busy_timeout = 5000")
        .execute(&mut conn)
        .map_err(|e| format!("cannot configure the database connection: {e}"))?;
    Ok(conn)
}

pub fn find_file(conn: &mut SqliteConnection, file_id: &str) -> Result<FileRow, String> {
    files::table
        .filter(files::id.eq(file_id))
        .select((
            files::id,
            files::user_id,
            files::name,
            files::size_bytes,
            files::mime_type,
            files::storage_path,
            files::encrypted_metadata,
            files::deleted_at,
        ))
        .first::<(
            String,
            String,
            String,
            i64,
            String,
            String,
            Option<String>,
            Option<NaiveDateTime>,
        )>(conn)
        .optional()
        .map_err(|e| format!("querying files: {e}"))?
        .map(
            |(id, owner_id, name, size_bytes, mime_type, storage_path, encrypted_metadata, deleted_at)| {
                FileRow {
                    id,
                    owner_id,
                    name,
                    size_bytes,
                    mime_type,
                    storage_path,
                    encrypted_metadata,
                    deleted_at,
                }
            },
        )
        .ok_or_else(|| format!("no file with id {file_id}"))
}

/// Every key ref on a file — the owner's and each person it is shared with.
///
/// A shared file has one sealed DEK per recipient, so which key opens it
/// depends on whose kit is in hand. Listing them all is what lets the tool say
/// "this kit belongs to none of the people who can open this file" instead of
/// reporting a decryption failure.
pub fn key_refs_for_file(
    conn: &mut SqliteConnection,
    file_id: &str,
) -> Result<Vec<KeyRef>, String> {
    file_key_refs::table
        .filter(file_key_refs::file_id.eq(file_id))
        .select((
            file_key_refs::user_id,
            file_key_refs::encrypted_file_key,
            file_key_refs::key_version,
        ))
        .load::<(String, String, i32)>(conn)
        .map_err(|e| format!("querying file_key_refs: {e}"))
        .map(|rows| {
            rows.into_iter()
                .map(|(user_id, encrypted_file_key, key_version)| KeyRef {
                    user_id,
                    encrypted_file_key,
                    key_version,
                })
                .collect()
        })
}

pub fn versions_for_file(
    conn: &mut SqliteConnection,
    file_id: &str,
) -> Result<Vec<VersionRow>, String> {
    file_versions::table
        .filter(file_versions::file_id.eq(file_id))
        .order(file_versions::version_number.desc())
        .select((
            file_versions::id,
            file_versions::version_number,
            file_versions::size_bytes,
            file_versions::storage_path,
            file_versions::label,
            file_versions::created_at,
        ))
        .load::<(String, i32, i64, String, Option<String>, NaiveDateTime)>(conn)
        .map_err(|e| format!("querying file_versions: {e}"))
        .map(|rows| {
            rows.into_iter()
                .map(
                    |(id, version_number, size_bytes, storage_path, label, created_at)| VersionRow {
                        id,
                        version_number,
                        size_bytes,
                        storage_path,
                        label,
                        created_at,
                    },
                )
                .collect()
        })
}

/// The public halves the server holds for a user, newest last.
///
/// Only ever used to *check* a key, never to supply one: a public key from the
/// server is untrusted input, and the whole point of the client-only key
/// architecture is that the server cannot produce the secret. Comparing the
/// kit's derived public key against this row is how the tool tells "wrong kit"
/// from "damaged blob" before it tries to decrypt anything.
pub fn public_keys_for_user(
    conn: &mut SqliteConnection,
    user_id: &str,
) -> Result<Vec<PublicKeyRow>, String> {
    user_public_keys::table
        .filter(user_public_keys::user_id.eq(user_id))
        .order(user_public_keys::version.asc())
        .select((
            user_public_keys::version,
            user_public_keys::public_key,
            user_public_keys::retired_at,
        ))
        .load::<(i32, String, Option<NaiveDateTime>)>(conn)
        .map_err(|e| format!("querying user_public_keys: {e}"))
        .map(|rows| {
            rows.into_iter()
                .map(|(version, public_key, retired_at)| PublicKeyRow {
                    version,
                    public_key,
                    retired_at,
                })
                .collect()
        })
}

pub fn email_for_user(conn: &mut SqliteConnection, user_id: &str) -> Option<String> {
    users::table
        .filter(users::id.eq(user_id))
        .select(users::email)
        .first::<String>(conn)
        .ok()
}
