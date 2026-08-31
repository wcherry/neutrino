use chrono::NaiveDateTime;
use diesel::prelude::*;

/// The single retention policy row, keyed `'default'`.
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::version_retention_settings)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct VersionRetentionRecord {
    #[allow(dead_code)]
    pub id: String,
    /// Whether the worker prunes at all. Off leaves every version in place.
    pub enabled: bool,
    /// Versions older than this many days are eligible for deletion.
    pub retention_days: i32,
    /// How many of the newest versions are kept whatever their age. Read
    /// together with `retention_days`: age only decides among the versions
    /// this number has not already spoken for.
    pub min_versions: i32,
    pub updated_at: NaiveDateTime,
}
