// ── preferences::model ────────────────────────────────────────────────────────

use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::user_preferences)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct PreferenceRecord {
    pub user_id: String,
    pub key: String,
    /// The value as JSON text, validated against `catalog::PLAIN` before it was stored.
    pub value: String,
    pub updated_at: String,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::user_preferences)]
pub struct NewPreferenceRecord<'a> {
    pub user_id: &'a str,
    pub key: &'a str,
    pub value: &'a str,
    pub updated_at: &'a str,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::user_preference_vault)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct VaultRecord {
    pub user_id: String,
    /// Sealed in the browser to the user's own public key; opaque here.
    pub blob: String,
    /// Also the vault's version: a write names the one it was based on.
    pub updated_at: String,
}
