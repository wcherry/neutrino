// ── search::model ────────────────────────────────────────────────────────────
//
// One row per user — the snapshot is whole-database, so an upload replaces the
// previous one rather than accumulating. `updated_at` is a plain `Text` column
// following the `custom_themes` / `custom_fonts` convention; see the
// migration's `up.sql`.

use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::search_index_snapshots)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct SearchSnapshotRecord {
    pub user_id: String,
    /// Optimistic-concurrency token, bumped by 1 on every accepted upload.
    pub version: i32,
    pub size_bytes: i64,
    pub wrapped_key: String,
    pub device_id: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::search_index_snapshots)]
pub struct NewSearchSnapshotRecord<'a> {
    pub user_id: &'a str,
    pub version: i32,
    pub size_bytes: i64,
    pub wrapped_key: &'a str,
    pub device_id: Option<&'a str>,
    pub updated_at: &'a str,
}
