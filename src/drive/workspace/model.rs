use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::workspace_settings)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct WorkspaceSettingsRecord {
    pub id: String,
    pub allowed_domain: Option<String>,
    pub restrict_shares_to_domain: bool,
    pub block_external_link_sharing: bool,
    pub domain_only_links: bool,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::workspace_settings)]
pub struct NewWorkspaceSettingsRecord<'a> {
    pub id: &'a str,
    pub allowed_domain: Option<&'a str>,
    pub restrict_shares_to_domain: bool,
    pub block_external_link_sharing: bool,
    pub domain_only_links: bool,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::workspace_settings)]
pub struct UpdateWorkspaceSettingsRecord {
    pub allowed_domain: Option<Option<String>>,
    pub restrict_shares_to_domain: Option<bool>,
    pub block_external_link_sharing: Option<bool>,
    pub domain_only_links: Option<bool>,
    pub updated_at: NaiveDateTime,
}
