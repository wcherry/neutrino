use chrono::NaiveDateTime;
use diesel::prelude::*;
use crate::schema::{file_legal_holds, legal_holds, retention_policies};

#[derive(Debug, Queryable, Selectable, Clone)]
#[diesel(table_name = legal_holds)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct LegalHold {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_by: String,
    pub custodian_ids: String,
    pub is_active: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = legal_holds)]
pub struct NewLegalHold<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub created_by: &'a str,
    pub custodian_ids: &'a str,
    pub is_active: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Queryable, Selectable, Clone)]
#[diesel(table_name = retention_policies)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct RetentionPolicy {
    pub id: String,
    pub name: String,
    pub retain_for_days: i32,
    pub applies_to_mime_type: Option<String>,
    pub applies_to_user_id: Option<String>,
    pub is_active: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = retention_policies)]
pub struct NewRetentionPolicy<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub retain_for_days: i32,
    pub applies_to_mime_type: Option<&'a str>,
    pub applies_to_user_id: Option<&'a str>,
    pub is_active: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Queryable, Selectable, Clone)]
#[diesel(table_name = file_legal_holds)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct FileLegalHold {
    pub file_id: String,
    pub hold_id: String,
    pub applied_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = file_legal_holds)]
pub struct NewFileLegalHold<'a> {
    pub file_id: &'a str,
    pub hold_id: &'a str,
    pub applied_at: NaiveDateTime,
}
