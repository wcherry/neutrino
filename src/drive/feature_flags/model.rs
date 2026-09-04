use diesel::prelude::*;

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::feature_flags)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct FeatureFlagRecord {
    pub key: String,
    pub enabled: i32,
    pub description: Option<String>,
    pub updated_at: String,
}
