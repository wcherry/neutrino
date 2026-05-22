use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::irm_policies)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct IrmPolicyRecord {
    pub id: String,
    pub resource_type: String,
    pub resource_id: String,
    pub restrict_download_viewer: bool,
    pub restrict_download_commenter: bool,
    pub restrict_download_editor: bool,
    pub restrict_print_copy_viewer: bool,
    pub restrict_print_copy_commenter: bool,
    pub restrict_print_copy_editor: bool,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::irm_policies)]
pub struct NewIrmPolicyRecord<'a> {
    pub id: &'a str,
    pub resource_type: &'a str,
    pub resource_id: &'a str,
    pub restrict_download_viewer: bool,
    pub restrict_download_commenter: bool,
    pub restrict_download_editor: bool,
    pub restrict_print_copy_viewer: bool,
    pub restrict_print_copy_commenter: bool,
    pub restrict_print_copy_editor: bool,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::irm_policies)]
pub struct UpdateIrmPolicyRecord {
    pub restrict_download_viewer: bool,
    pub restrict_download_commenter: bool,
    pub restrict_download_editor: bool,
    pub restrict_print_copy_viewer: bool,
    pub restrict_print_copy_commenter: bool,
    pub restrict_print_copy_editor: bool,
    pub updated_at: NaiveDateTime,
}
